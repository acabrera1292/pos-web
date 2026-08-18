const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const path = require("path");
const crypto = require("crypto");

const app = express();
app.use(cors());
app.use(express.json({ limit: "6mb" }));

// Serve frontend
app.use(express.static(path.join(__dirname, "../frontend")));

const dbPath = process.env.DATABASE_PATH || path.join(__dirname, "database.sqlite");
const db = new sqlite3.Database(dbPath);

// ---------- UTIL ----------

function getETLocalISO() {
  const etString = new Date().toLocaleString("sv-SE", {
    timeZone: "America/New_York",
    hour12: false,
  });
  return etString.replace(" ", "T");
}

// ---------- CREACIÓN DE TABLAS ----------

db.serialize(() => {
  db.run(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    company TEXT,
    role TEXT DEFAULT 'Admin',
    active INTEGER DEFAULT 1
  )
`);

// Si la base ya existía, intenta añadir la columna role (la ignoramos si ya existe).
db.run(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'Admin'`, (err) => {
  if (err && !String(err.message).includes("duplicate column")) {
    console.error("Error añadiendo columna role:", err.message);
  }
});

  db.run(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      code TEXT,
      name TEXT,
      quantity INTEGER,
      price REAL,
      taxRate REAL DEFAULT 15,
      company TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      productId INTEGER,
      code TEXT,
      name TEXT,
      quantity INTEGER,
      price REAL,
      total REAL,
      date TEXT,
      paymentType TEXT,
      invoiceId INTEGER,
      company TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS invoices (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      invoiceType TEXT NOT NULL,
      clientId INTEGER,
      buyerIdType TEXT,
      buyerIdNumber TEXT,
      buyerName TEXT NOT NULL,
      buyerAddress TEXT,
      buyerEmail TEXT,
      subtotal REAL NOT NULL,
      taxAmount REAL NOT NULL,
      total REAL NOT NULL,
      paymentType TEXT NOT NULL,
      invoiceNumber TEXT,
      status TEXT DEFAULT 'CONFIGURATION_REQUIRED',
      sriMessage TEXT,
      date TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sri_settings (
      company TEXT PRIMARY KEY,
      environment TEXT DEFAULT 'TEST',
      ruc TEXT,
      legalName TEXT,
      commercialName TEXT,
      mainAddress TEXT,
      establishmentAddress TEXT,
      establishmentCode TEXT DEFAULT '001',
      emissionPoint TEXT DEFAULT '001',
      nextSequence INTEGER DEFAULT 1,
      accountingRequired TEXT DEFAULT 'NO',
      specialTaxpayerNumber TEXT,
      taxRegime TEXT,
      senderEmail TEXT,
      adminCopyEmail TEXT,
      certificateConfigured INTEGER DEFAULT 0,
      certificateValidated INTEGER DEFAULT 0
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sri_certificates (
      company TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      certificateEncrypted TEXT NOT NULL,
      passwordEncrypted TEXT NOT NULL,
      installedAt TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS client_intake_tokens (
      company TEXT PRIMARY KEY,
      tokenHash TEXT NOT NULL UNIQUE,
      active INTEGER DEFAULT 1,
      createdAt TEXT NOT NULL
    )
  `);

    db.run(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT,
      idType TEXT,           -- "Cedula" o "RUC"
      idNumber TEXT,         -- número de identificación
      razonSocial TEXT,      -- nombre legal
      nombreComercial TEXT,  -- opcional
      ciudad TEXT,
      direccion TEXT,
      email TEXT,
      telefono TEXT,
      celular TEXT
    )
  `);

});

// Migración por si la BD es vieja: asegurar columna 'active'
db.run("ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1", (err) => {
  if (err) {
    if (!String(err.message).includes("duplicate column")) {
      console.error("Error agregando columna 'active':", err.message);
    }
  } else {
    console.log("Columna 'active' agregada a 'users'.");
  }
});

const SECRET = process.env.JWT_SECRET || "pos-secret";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "posmaster";

// ---------- AUTH ----------

// Registro de nueva tienda/usuario (lo usará solo admin.html)
app.post("/auth/register", async (req, res) => {
  const { username, password, company, role } = req.body;

  // Solo 2 roles permitidos, por defecto Admin
  const userRole = role === "Usuario" ? "Usuario" : "Admin";

  try {
    const hashed = await bcrypt.hash(password, 10);
    db.run(
      "INSERT INTO users (username, password, company, role) VALUES (?, ?, ?, ?)",
      [username, hashed, company, userRole],
      function (err) {
        if (err) {
          console.error("Error insertando usuario:", err.message);
          return res.status(500).json({ error: err.message });
        }
        res.json({ msg: "Usuario creado", id: this.lastID });
      }
    );
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});


// Login normal del cliente
app.post("/auth/login", (req, res) => {
  const { username, password } = req.body;

  db.get(
    `SELECT * FROM users WHERE username = ?`,
    [username],
    async (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user) return res.status(401).json({ error: "Usuario no existe" });

      if (!user.active) {
        return res.status(403).json({ error: "Tienda / usuario inactivo" });
      }

      const ok = await bcrypt.compare(password, user.password);
      if (!ok) return res.status(401).json({ error: "Contraseña incorrecta" });

      const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: "12h" });

      res.json({
        token,
        company: user.company,
        role: user.role || "Admin"
      });
    }
  );
});

function requireAdmin(req, res, next) {
  if (req.query.secret !== ADMIN_SECRET) {
    return res.status(403).json({ error: "No autorizado" });
  }
  next();
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.get(sql, params, (err, row) => err ? reject(err) : resolve(row));
  });
}

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function money(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function certificateEncryptionKey() {
  const secret = process.env.SRI_CERT_ENCRYPTION_KEY;
  return secret ? crypto.createHash("sha256").update(secret, "utf8").digest() : null;
}

function encryptCertificateValue(value) {
  const key = certificateEncryptionKey();
  if (!key) throw new Error("SRI_CERT_ENCRYPTION_KEY no está configurada en el servidor.");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), encrypted.toString("base64")].join(":");
}

function hashIntakeToken(token) {
  return crypto.createHash("sha256").update(String(token), "utf8").digest("hex");
}

function normalizeClientPayload(input = {}) {
  return {
    idType: ["Cedula", "RUC", "Pasaporte"].includes(input.idType) ? input.idType : "Cedula",
    idNumber: String(input.idNumber || "").trim(),
    razonSocial: String(input.razonSocial || "").trim(),
    nombreComercial: String(input.nombreComercial || "").trim(),
    ciudad: String(input.ciudad || "").trim(),
    direccion: String(input.direccion || "").trim(),
    email: String(input.email || "").trim().toLowerCase(),
    telefono: String(input.telefono || "").trim(),
    celular: String(input.celular || "").trim()
  };
}

function validateClientPayload(client) {
  if (!client.idNumber || !client.razonSocial) return "Identificación y nombre son obligatorios.";
  if (client.idType === "Cedula" && !/^\d{10}$/.test(client.idNumber)) return "La cédula debe contener 10 dígitos.";
  if (client.idType === "RUC" && !/^\d{13}$/.test(client.idNumber)) return "El RUC debe contener 13 dígitos.";
  if (client.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(client.email)) return "El correo electrónico no es válido.";
  return null;
}

function requireAuthenticatedUser(req, res, next) {
  const authorization = req.get("Authorization") || "";
  const [scheme, token] = authorization.split(" ");

  if (scheme !== "Bearer" || !token) {
    return res.status(401).json({ error: "Inicia sesión para continuar." });
  }

  let payload;
  try {
    payload = jwt.verify(token, SECRET);
  } catch {
    return res.status(401).json({ error: "La sesión no es válida o expiró." });
  }

  db.get(
    "SELECT id, username, company, role, active FROM users WHERE id = ?",
    [payload.id],
    (err, user) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!user || !user.active) {
        return res.status(401).json({ error: "Usuario no autorizado." });
      }

      req.user = user;
      next();
    }
  );
}

function requireUserAdmin(req, res, next) {
  requireCompanyUser(req, res, () => {
    if (req.user.role !== "Admin") {
      return res.status(403).json({ error: "Solo un administrador puede realizar esta acción." });
    }
    next();
  });
}

function requireCompanyUser(req, res, next) {
  requireAuthenticatedUser(req, res, () => {
    if (req.params.company && req.params.company !== req.user.company) {
      return res.status(403).json({ error: "No puedes modificar otra tienda." });
    }
    next();
  });
}

app.get("/settings/sri/:company", requireCompanyUser, async (req, res) => {
  try {
    const settings = await dbGet(
      "SELECT * FROM sri_settings WHERE company = ?",
      [req.params.company]
    );
    res.json(settings || {
      company: req.params.company,
      environment: "TEST",
      establishmentCode: "001",
      emissionPoint: "001",
      nextSequence: 1,
      accountingRequired: "NO",
      certificateConfigured: 0
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/settings/sri/:company", requireUserAdmin, async (req, res) => {
  const { company } = req.params;
  const values = req.body;
  const environment = values.environment === "PRODUCTION" ? "PRODUCTION" : "TEST";

  try {
    const existing = await dbGet("SELECT certificateConfigured, certificateValidated FROM sri_settings WHERE company = ?", [company]);
    const certificateConfigured = existing?.certificateConfigured ? 1 : 0;
    const certificateValidated = existing?.certificateValidated ? 1 : 0;
    if (environment === "PRODUCTION" && !certificateValidated) {
      return res.status(400).json({ error: "La firma debe validarse con el SRI antes de activar Producción." });
    }
    await dbRun(
      `INSERT INTO sri_settings
       (company, environment, ruc, legalName, commercialName, mainAddress,
        establishmentAddress, establishmentCode, emissionPoint, nextSequence,
        accountingRequired, specialTaxpayerNumber, taxRegime, senderEmail,
        adminCopyEmail, certificateConfigured, certificateValidated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(company) DO UPDATE SET
         environment=excluded.environment, ruc=excluded.ruc,
         legalName=excluded.legalName, commercialName=excluded.commercialName,
         mainAddress=excluded.mainAddress,
         establishmentAddress=excluded.establishmentAddress,
         establishmentCode=excluded.establishmentCode,
         emissionPoint=excluded.emissionPoint,
         nextSequence=excluded.nextSequence,
         accountingRequired=excluded.accountingRequired,
         specialTaxpayerNumber=excluded.specialTaxpayerNumber,
         taxRegime=excluded.taxRegime, senderEmail=excluded.senderEmail,
         adminCopyEmail=excluded.adminCopyEmail,
         certificateConfigured=excluded.certificateConfigured,
         certificateValidated=excluded.certificateValidated`,
      [
        company, environment, values.ruc || "", values.legalName || "",
        values.commercialName || "", values.mainAddress || "",
        values.establishmentAddress || "", values.establishmentCode || "001",
        values.emissionPoint || "001", Math.max(1, Number(values.nextSequence) || 1),
        values.accountingRequired === "SI" ? "SI" : "NO",
        values.specialTaxpayerNumber || "", values.taxRegime || "",
        values.senderEmail || "", values.adminCopyEmail || "",
        certificateConfigured, certificateValidated
      ]
    );
    res.json({ saved: true, environment });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/settings/sri/:company/certificate", requireUserAdmin, async (req, res) => {
  const { company } = req.params;
  const { filename, certificateBase64, password } = req.body || {};
  if (!filename || !/\.(p12|pfx)$/i.test(filename)) {
    return res.status(400).json({ error: "Selecciona un certificado .p12 o .pfx." });
  }
  if (!certificateBase64 || !password) {
    return res.status(400).json({ error: "El certificado y su contraseña son obligatorios." });
  }

  try {
    const certificate = Buffer.from(certificateBase64, "base64");
    if (!certificate.length || certificate.length > 5 * 1024 * 1024) {
      return res.status(400).json({ error: "El certificado debe pesar menos de 5 MB." });
    }
    const certificateEncrypted = encryptCertificateValue(certificate);
    const passwordEncrypted = encryptCertificateValue(Buffer.from(password, "utf8"));
    const installedAt = getETLocalISO();
    await dbRun(
      `INSERT INTO sri_certificates
       (company, filename, certificateEncrypted, passwordEncrypted, installedAt)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(company) DO UPDATE SET filename=excluded.filename,
         certificateEncrypted=excluded.certificateEncrypted,
         passwordEncrypted=excluded.passwordEncrypted, installedAt=excluded.installedAt`,
      [company, path.basename(filename), certificateEncrypted, passwordEncrypted, installedAt]
    );
    await dbRun(
      `INSERT INTO sri_settings (company, certificateConfigured, certificateValidated)
       VALUES (?, 1, 0)
       ON CONFLICT(company) DO UPDATE SET certificateConfigured=1, certificateValidated=0, environment='TEST'`,
      [company]
    );
    res.json({ configured: true, validated: false, filename: path.basename(filename), installedAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/settings/sri/:company/certificate", requireUserAdmin, async (req, res) => {
  try {
    await dbRun("DELETE FROM sri_certificates WHERE company = ?", [req.params.company]);
    await dbRun(
      "UPDATE sri_settings SET certificateConfigured = 0, certificateValidated = 0, environment = 'TEST' WHERE company = ?",
      [req.params.company]
    );
    res.json({ removed: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/settings/client-intake/:company", requireUserAdmin, async (req, res) => {
  try {
    const row = await dbGet("SELECT active, createdAt FROM client_intake_tokens WHERE company = ?", [req.params.company]);
    res.json({ configured: Boolean(row), active: Boolean(row?.active), createdAt: row?.createdAt || null });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/settings/client-intake/:company/token", requireUserAdmin, async (req, res) => {
  try {
    const token = crypto.randomBytes(32).toString("base64url");
    const createdAt = getETLocalISO();
    await dbRun(
      `INSERT INTO client_intake_tokens (company, tokenHash, active, createdAt)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(company) DO UPDATE SET tokenHash=excluded.tokenHash, active=1, createdAt=excluded.createdAt`,
      [req.params.company, hashIntakeToken(token), createdAt]
    );
    res.json({ token, createdAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/settings/client-intake/:company/token", requireUserAdmin, async (req, res) => {
  try {
    await dbRun("DELETE FROM client_intake_tokens WHERE company = ?", [req.params.company]);
    res.json({ disabled: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/public/client-intake/:token", async (req, res) => {
  try {
    const row = await dbGet(
      `SELECT t.company, s.commercialName, s.legalName
       FROM client_intake_tokens t
       LEFT JOIN sri_settings s ON s.company = t.company
       WHERE t.tokenHash = ? AND t.active = 1`,
      [hashIntakeToken(req.params.token)]
    );
    if (!row) return res.status(404).json({ error: "Este enlace no es válido o fue desactivado." });
    res.json({ storeName: row.commercialName || row.legalName || row.company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/public/client-intake/:token", async (req, res) => {
  try {
    const tokenRow = await dbGet(
      "SELECT company FROM client_intake_tokens WHERE tokenHash = ? AND active = 1",
      [hashIntakeToken(req.params.token)]
    );
    if (!tokenRow) return res.status(404).json({ error: "Este enlace no es válido o fue desactivado." });
    const client = normalizeClientPayload(req.body);
    const validationError = validateClientPayload(client);
    if (validationError) return res.status(400).json({ error: validationError });
    const duplicate = await dbGet(
      "SELECT id FROM clients WHERE company = ? AND idNumber = ?",
      [tokenRow.company, client.idNumber]
    );
    if (duplicate) return res.status(409).json({ error: "Ya existe un cliente con esta identificación." });
    const result = await dbRun(
      `INSERT INTO clients
       (company, idType, idNumber, razonSocial, nombreComercial, ciudad, direccion, email, telefono, celular)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [tokenRow.company, client.idType, client.idNumber, client.razonSocial,
        client.nombreComercial, client.ciudad, client.direccion, client.email,
        client.telefono, client.celular]
    );
    res.json({ saved: true, id: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET lista de tiendas (una fila por company)
app.get("/admin/tiendas", requireAdmin, (req, res) => {
  db.all(
    `
    SELECT MIN(id) AS id, company, MIN(active) AS active
    FROM users
    GROUP BY company
    ORDER BY company
    `,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Cambiar estado de una tienda (activa/inactiva todas sus cuentas)
app.post("/admin/tiendas/estado", requireAdmin, (req, res) => {
  const { company, active } = req.body;
  const val = active ? 1 : 0;

  db.run(
    "UPDATE users SET active = ? WHERE company = ?",
    [val, company],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ updated: this.changes });
    }
  );
});

// Eliminar tienda completa (usuarios, productos, ventas)
app.delete("/admin/tiendas/:company", requireAdmin, (req, res) => {
  const company = req.params.company;

  db.serialize(() => {
    db.run("DELETE FROM users     WHERE company = ?", [company]);
    db.run("DELETE FROM products  WHERE company = ?", [company]);
    db.run("DELETE FROM sales     WHERE company = ?", [company]);
  });

  res.json({ ok: true });
});

// Lista de todos los usuarios
app.get("/admin/usuarios", requireAdmin, (req, res) => {
  db.all(
    `
    SELECT id, username, company, role, active
    FROM users
    ORDER BY company, username
    `,
    [],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Crear usuario para una tienda
app.post("/admin/usuarios", requireAdmin, async (req, res) => {
  const { username, password, company, role } = req.body;

  try {
    const hashed = await bcrypt.hash(password, 10);

    db.run(
      `
      INSERT INTO users (username, password, company, role, active)
      VALUES (?, ?, ?, ?, 1)
      `,
      [username, hashed, company, role || "Admin"],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
      }
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Eliminar usuario
app.delete("/admin/usuarios/:id", requireAdmin, (req, res) => {
  db.run("DELETE FROM users WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
  });
});


// ---------- CAMBIO DE CONTRASEÑA (CLIENTE) ----------
app.post("/auth/change-password", (req, res) => {
  const { username, oldPassword, newPassword } = req.body;

  if (!username || !oldPassword || !newPassword) {
    return res.status(400).json({ error: "Datos incompletos." });
  }

  // Solo para depurar: ver qué llega
  console.log("POST /auth/change-password", username);

  db.get(
    "SELECT * FROM users WHERE username = ?",
    [username],
    async (err, user) => {
      if (err) {
        console.error(err);
        return res.status(500).json({ error: err.message });
      }

      if (!user) {
        return res.status(404).json({ error: "Usuario no encontrado." });
      }

      const ok = await bcrypt.compare(oldPassword, user.password);
      if (!ok) {
        return res
          .status(401)
          .json({ error: "Contraseña actual incorrecta." });
      }

      try {
        const hashed = await bcrypt.hash(newPassword, 10);
        db.run(
          "UPDATE users SET password = ? WHERE id = ?",
          [hashed, user.id],
          function (err2) {
            if (err2) {
              console.error(err2);
              return res.status(500).json({ error: err2.message });
            }
            return res.json({ msg: "Contraseña actualizada." });
          }
        );
      } catch (e) {
        console.error(e);
        return res.status(500).json({ error: e.message });
      }
    }
  );
});


// ---------- PRODUCTS (por empresa) ----------

app.get("/products/:company", (req, res) => {
  db.all(
    "SELECT * FROM products WHERE company = ?",
    [req.params.company],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Crear producto (NO permite códigos duplicados por compañía)
app.post("/products/:company", (req, res) => {
  const { code, name, quantity, price } = req.body;
  const company = req.params.company;

  if (!code) {
    return res.status(400).json({ error: "El código es obligatorio." });
  }

  // ¿Ya existe ese código para esta compañía?
  db.get(
    "SELECT id FROM products WHERE company = ? AND code = ?",
    [company, code],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (row) {
        // ya existe
        return res
          .status(409)
          .json({ error: "Ya existe un producto con este código." });
      }

      // crear nuevo
      db.run(
        "INSERT INTO products (code, name, quantity, price, company) VALUES (?, ?, ?, ?, ?)",
        [code, name, quantity, price, company],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ id: this.lastID });
        }
      );
    }
  );
});

// Importar productos (CSV): si el código ya existe, ACTUALIZA; si no, inserta
app.post("/products/import/:company", (req, res) => {
  const { code, name, quantity, price } = req.body;
  const company = req.params.company;

  if (!code) {
    return res.status(400).json({ error: "El código es obligatorio." });
  }

  db.get(
    "SELECT id FROM products WHERE company = ? AND code = ?",
    [company, code],
    (err, row) => {
      if (err) {
        return res.status(500).json({ error: err.message });
      }

      if (row) {
        // Actualizar producto existente (puedes ajustar la lógica si prefieres sumar cantidades)
        db.run(
          "UPDATE products SET name = ?, quantity = ?, price = ? WHERE id = ?",
          [name, quantity, price, row.id],
          function (err2) {
            if (err2) return res.status(500).json({ error: err2.message });
            return res.json({ updated: this.changes, mode: "update" });
          }
        );
      } else {
        // Insertar nuevo
        db.run(
          "INSERT INTO products (code, name, quantity, price, company) VALUES (?, ?, ?, ?, ?)",
          [code, name, quantity, price, company],
          function (err2) {
            if (err2) return res.status(500).json({ error: err2.message });
            return res.json({ id: this.lastID, mode: "insert" });
          }
        );
      }
    }
  );
});


app.put("/products/:company/:id", requireCompanyUser, (req, res) => {
  const { code, name, quantity, price } = req.body;
  const { company, id } = req.params;

  if (req.user.role !== "Admin") {
    return db.run(
      "UPDATE products SET code = ?, name = ? WHERE id = ? AND company = ?",
      [code, name, id, company],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ updated: this.changes });
      }
    );
  }

  db.run(
    "UPDATE products SET code = ?, name = ?, quantity = ?, price = ? WHERE id = ? AND company = ?",
    [code, name, quantity, price, id, company],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ updated: this.changes });
    }
  );
});

app.delete("/products/:company/:id", requireUserAdmin, (req, res) => {
  const { company, id } = req.params;

  db.run(
    "DELETE FROM products WHERE id = ? AND company = ?",
    [id, company],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ deleted: this.changes });
    }
  );
});

// ---------- SALES (ventas) ----------

app.post("/sales/:company", requireCompanyUser, async (req, res) => {
  const { company } = req.params;
  const { items, cash, paymentType, invoiceType, clientId } = req.body;
  const date = getETLocalISO();
  const payType = paymentType || "Efectivo";

  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: "Carrito vacío" });
  }

  const type = invoiceType === "FACTURA" ? "FACTURA" : "CONSUMIDOR_FINAL";

  try {
    const client = type === "FACTURA"
      ? await dbGet("SELECT * FROM clients WHERE id = ? AND company = ?", [clientId, company])
      : null;
    if (type === "FACTURA" && !client) {
      return res.status(400).json({ error: "Selecciona un cliente para la factura." });
    }

    const lines = [];
    let subtotal = 0;
    let taxAmount = 0;
    let total = 0;
    for (const item of items) {
      const product = await dbGet(
        "SELECT * FROM products WHERE id = ? AND company = ?",
        [item.id, company]
      );
      if (!product) return res.status(400).json({ error: `Producto no encontrado: ${item.code}` });
      const quantity = Math.max(1, Number(item.quantity) || 1);
      if (quantity > product.quantity) {
        return res.status(400).json({ error: `Inventario insuficiente para ${product.name}.` });
      }
      const rate = Number(product.taxRate ?? 15);
      const gross = money(Number(product.price) * quantity);
      const base = rate > 0 ? money(gross / (1 + rate / 100)) : gross;
      const tax = money(gross - base);
      subtotal = money(subtotal + base);
      taxAmount = money(taxAmount + tax);
      total = money(total + gross);
      lines.push({ product, quantity, gross });
    }

    const settings = await dbGet("SELECT * FROM sri_settings WHERE company = ?", [company]);
    const sequence = settings?.nextSequence || 1;
    const establishment = settings?.establishmentCode || "001";
    const emissionPoint = settings?.emissionPoint || "001";
    const invoiceNumber = `${establishment}-${emissionPoint}-${String(sequence).padStart(9, "0")}`;
    const issuerConfigured = Boolean(settings?.ruc && settings?.legalName && settings?.mainAddress);
    const configured = issuerConfigured && Boolean(settings?.certificateValidated);
    const status = configured
      ? "PENDING_SRI"
      : settings?.certificateConfigured ? "CERTIFICATE_PENDING_VALIDATION" : "CONFIGURATION_REQUIRED";

    await dbRun("BEGIN IMMEDIATE TRANSACTION");
    const invoice = await dbRun(
      `INSERT INTO invoices
       (company, invoiceType, clientId, buyerIdType, buyerIdNumber, buyerName,
        buyerAddress, buyerEmail, subtotal, taxAmount, total, paymentType,
        invoiceNumber, status, sriMessage, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        company, type, client?.id || null, client?.idType || "07",
        client?.idNumber || "9999999999999",
        client?.razonSocial || "CONSUMIDOR FINAL", client?.direccion || "",
        client?.email || "", subtotal, taxAmount, total, payType,
        invoiceNumber, status,
        configured ? "Pendiente de firma y envío al SRI." : "Complete la configuración SRI.",
        date
      ]
    );

    for (const line of lines) {
      await dbRun(
        `INSERT INTO sales
         (productId, code, name, quantity, price, total, date, paymentType, invoiceId, company)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [line.product.id, line.product.code, line.product.name, line.quantity,
          line.product.price, line.gross, date, payType, invoice.lastID, company]
      );
      await dbRun(
        "UPDATE products SET quantity = quantity - ? WHERE id = ? AND company = ?",
        [line.quantity, line.product.id, company]
      );
    }

    await dbRun(
      `INSERT INTO sri_settings (company, nextSequence)
       VALUES (?, ?)
       ON CONFLICT(company) DO UPDATE SET nextSequence = ?`,
      [company, sequence + 1, sequence + 1]
    );
    await dbRun("COMMIT");

    res.json({
      msg: "Venta registrada",
      invoiceId: invoice.lastID,
      invoiceNumber,
      status,
      subtotal,
      taxAmount,
      total,
      cash,
      paymentType: payType
    });
  } catch (err) {
    try { await dbRun("ROLLBACK"); } catch {}
    res.status(500).json({ error: err.message });
  }
});

app.get("/sales/:company", (req, res) => {
  db.all(
    "SELECT * FROM sales WHERE company = ? ORDER BY date DESC",
    [req.params.company],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// ---------- CLIENTES (por empresa) ----------

// Listar clientes de una tienda
app.get("/clients/:company", (req, res) => {
  const { company } = req.params;

  db.all(
    `SELECT * 
     FROM clients 
     WHERE company = ? 
     ORDER BY razonSocial`,
    [company],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// Crear cliente nuevo
app.post("/clients/:company", (req, res) => {
  const { company } = req.params;
  const {
    idType,
    idNumber,
    razonSocial,
    nombreComercial,
    ciudad,
    direccion,
    email,
    telefono,
    celular,
  } = req.body;

  if (!idType || !idNumber || !razonSocial) {
    return res
      .status(400)
      .json({ error: "Tipo de identificación, número y razón social son obligatorios." });
  }

  // Evitar duplicados por compañía + número de identificación
  db.get(
    "SELECT id FROM clients WHERE company = ? AND idNumber = ?",
    [company, idNumber],
    (err, row) => {
      if (err) return res.status(500).json({ error: err.message });

      if (row) {
        return res
          .status(409)
          .json({ error: "Ya existe un cliente con ese número de identificación." });
      }

      db.run(
        `INSERT INTO clients
         (company, idType, idNumber, razonSocial, nombreComercial,
          ciudad, direccion, email, telefono, celular)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          company,
          idType,
          idNumber,
          razonSocial,
          nombreComercial || "",
          ciudad || "",
          direccion || "",
          email || "",
          telefono || "",
          celular || "",
        ],
        function (err2) {
          if (err2) return res.status(500).json({ error: err2.message });
          res.json({ id: this.lastID });
        }
      );
    }
  );
});

// Actualizar cliente existente
app.put("/clients/:company/:id", (req, res) => {
  const { company, id } = req.params;
  const {
    idType,
    idNumber,
    razonSocial,
    nombreComercial,
    ciudad,
    direccion,
    email,
    telefono,
    celular,
  } = req.body;

  if (!idType || !idNumber || !razonSocial) {
    return res
      .status(400)
      .json({ error: "Tipo de identificación, número y razón social son obligatorios." });
  }

  db.run(
    `UPDATE clients
     SET idType = ?, idNumber = ?, razonSocial = ?, nombreComercial = ?,
         ciudad = ?, direccion = ?, email = ?, telefono = ?, celular = ?
     WHERE id = ? AND company = ?`,
    [
      idType,
      idNumber,
      razonSocial,
      nombreComercial || "",
      ciudad || "",
      direccion || "",
      email || "",
      telefono || "",
      celular || "",
      id,
      company,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ updated: this.changes });
    }
  );
});

// Eliminar cliente
app.delete("/clients/:company/:id", (req, res) => {
  const { company, id } = req.params;

  db.run(
    "DELETE FROM clients WHERE id = ? AND company = ?",
    [id, company],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ deleted: this.changes });
    }
  );
});


// ✅ Route for frontend (Render needs this)
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "../frontend/index.html"));
});

app.post("/clients/import/:company", requireUserAdmin, async (req, res) => {
  const rows = Array.isArray(req.body?.clients) ? req.body.clients : [];
  if (!rows.length) return res.status(400).json({ error: "El archivo no contiene clientes." });
  if (rows.length > 5000) return res.status(400).json({ error: "Importa un máximo de 5,000 clientes por archivo." });

  const summary = { inserted: 0, updated: 0, skipped: 0, errors: [] };
  try {
    await dbRun("BEGIN IMMEDIATE TRANSACTION");
    for (let index = 0; index < rows.length; index += 1) {
      const client = normalizeClientPayload(rows[index]);
      const validationError = validateClientPayload(client);
      if (validationError) {
        summary.skipped += 1;
        if (summary.errors.length < 20) summary.errors.push({ row: index + 2, error: validationError });
        continue;
      }
      const existing = await dbGet(
        "SELECT id FROM clients WHERE company = ? AND idNumber = ?",
        [req.params.company, client.idNumber]
      );
      if (existing) {
        await dbRun(
          `UPDATE clients SET idType=?, razonSocial=?, nombreComercial=?, ciudad=?,
           direccion=?, email=?, telefono=?, celular=? WHERE id=? AND company=?`,
          [client.idType, client.razonSocial, client.nombreComercial, client.ciudad,
            client.direccion, client.email, client.telefono, client.celular,
            existing.id, req.params.company]
        );
        summary.updated += 1;
      } else {
        await dbRun(
          `INSERT INTO clients
           (company, idType, idNumber, razonSocial, nombreComercial, ciudad, direccion, email, telefono, celular)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [req.params.company, client.idType, client.idNumber, client.razonSocial,
            client.nombreComercial, client.ciudad, client.direccion, client.email,
            client.telefono, client.celular]
        );
        summary.inserted += 1;
      }
    }
    await dbRun("COMMIT");
    res.json(summary);
  } catch (err) {
    try { await dbRun("ROLLBACK"); } catch {}
    res.status(500).json({ error: err.message });
  }
});

function addColumnIfMissing(table, definition) {
  db.run(`ALTER TABLE ${table} ADD COLUMN ${definition}`, err => {
    if (err && !String(err.message).includes("duplicate column")) {
      console.error(`Error updating ${table}:`, err.message);
    }
  });
}

addColumnIfMissing("products", "taxRate REAL DEFAULT 15");
addColumnIfMissing("sales", "invoiceId INTEGER");
addColumnIfMissing("sri_settings", "certificateValidated INTEGER DEFAULT 0");

app.delete("/sales/:company/:id", requireUserAdmin, (req, res) => {
  const { company, id } = req.params;

  db.get(
    "SELECT id, productId, quantity FROM sales WHERE id = ? AND company = ?",
    [id, company],
    (err, sale) => {
      if (err) return res.status(500).json({ error: err.message });
      if (!sale) return res.status(404).json({ error: "Venta no encontrada." });

      db.serialize(() => {
        db.run("BEGIN TRANSACTION");
        db.run(
          "UPDATE products SET quantity = quantity + ? WHERE id = ? AND company = ?",
          [sale.quantity, sale.productId, company]
        );
        db.run(
          "DELETE FROM sales WHERE id = ? AND company = ?",
          [id, company],
          function (deleteErr) {
            if (deleteErr) {
              db.run("ROLLBACK");
              return res.status(500).json({ error: deleteErr.message });
            }

            db.run("COMMIT", (commitErr) => {
              if (commitErr) return res.status(500).json({ error: commitErr.message });
              res.json({ deleted: this.changes });
            });
          }
        );
      });
    }
  );
});

app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
});
