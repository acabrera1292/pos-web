const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const path = require("path");
const crypto = require("crypto");
const { createDatabase } = require("./database");

const app = express();
app.use(cors());
app.use(express.json({ limit: "6mb" }));

// Serve frontend
app.use(express.static(path.join(__dirname, "../frontend")));

const dataStore = createDatabase();
const db = {
  serialize(work) { work(); },
  get(sql, params, callback) {
    if (typeof params === "function") { callback = params; params = []; }
    dataStore.get(sql, params || []).then(row => callback?.(null, row)).catch(err => callback?.(err));
  },
  all(sql, params, callback) {
    if (typeof params === "function") { callback = params; params = []; }
    dataStore.all(sql, params || []).then(rows => callback?.(null, rows)).catch(err => callback?.(err));
  },
  run(sql, params, callback) {
    if (typeof params === "function") { callback = params; params = []; }
    dataStore.run(sql, params || []).then(result => callback?.call(result, null)).catch(err => callback?.(err));
  }
};

// ---------- UTIL ----------

function getETLocalISO() {
  const etString = new Date().toLocaleString("sv-SE", {
    timeZone: "America/New_York",
    hour12: false,
  });
  return etString.replace(" ", "T");
}

// ---------- CREACIÓN DE TABLAS ----------

if (!dataStore.postgres) db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT UNIQUE,
    password TEXT,
    company TEXT,
    role TEXT DEFAULT 'Admin',
    active INTEGER DEFAULT 1,
    fullName TEXT DEFAULT '',
    mustChangePassword INTEGER DEFAULT 0
  )
`);

  db.run(`
    CREATE TABLE IF NOT EXISTS store_licenses (
      company TEXT PRIMARY KEY,
      active INTEGER DEFAULT 1,
      expiresAt TEXT,
      userLimit INTEGER DEFAULT 3,
      businessType TEXT DEFAULT 'SHOP',
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS password_reset_codes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      userId INTEGER NOT NULL,
      codeHash TEXT NOT NULL,
      expiresAt TEXT NOT NULL,
      usedAt TEXT,
      createdAt TEXT NOT NULL
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
    CREATE TABLE IF NOT EXISTS client_intake_submissions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      clientId INTEGER NOT NULL,
      createdAt TEXT NOT NULL,
      claimedAt TEXT
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

  db.run(`
    CREATE TABLE IF NOT EXISTS restaurant_tables (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      name TEXT NOT NULL,
      capacity INTEGER DEFAULT 4,
      active INTEGER DEFAULT 1,
      createdAt TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS restaurant_servers (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      name TEXT NOT NULL,
      active INTEGER DEFAULT 1,
      createdAt TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS restaurant_table_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      tableId INTEGER NOT NULL,
      restaurantServerId INTEGER,
      serverUserId INTEGER NOT NULL,
      serverName TEXT NOT NULL,
      guests INTEGER NOT NULL,
      status TEXT DEFAULT 'OCCUPIED',
      openedAt TEXT NOT NULL,
      closedAt TEXT,
      durationMinutes INTEGER
    )
  `);

  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_open_table_session
          ON restaurant_table_sessions(tableId) WHERE closedAt IS NULL`);

});

// Migración por si la BD es vieja: asegurar columna 'active'
if (!dataStore.postgres) db.run("ALTER TABLE users ADD COLUMN active INTEGER DEFAULT 1", (err) => {
  if (err) {
    if (!String(err.message).includes("duplicate column")) {
      console.error("Error agregando columna 'active':", err.message);
    }
  } else {
    console.log("Columna 'active' agregada a 'users'.");
  }
});

if (!dataStore.postgres) db.run("ALTER TABLE restaurant_table_sessions ADD COLUMN restaurantServerId INTEGER", (err) => {
  if (err && !String(err.message).includes("duplicate column")) {
    console.error("Error agregando restaurantServerId:", err.message);
  }
});

const SECRET = process.env.JWT_SECRET || "pos-secret";
const ADMIN_SECRET = process.env.ADMIN_SECRET || "posmaster";

const BUSINESS_TYPES = Object.freeze({
  SHOP: Object.freeze({
    label: "Tienda",
    modules: Object.freeze(["inventario", "pos", "ventas", "clientes", "usuarios", "config"])
  }),
  RESTAURANT: Object.freeze({
    label: "Restaurante",
    modules: Object.freeze(["inventario", "pos", "ventas", "clientes", "usuarios", "config", "mesas", "meseros", "cocina", "reloj"])
  })
});

function normalizeBusinessType(value) {
  const type = String(value || "SHOP").trim().toUpperCase();
  return BUSINESS_TYPES[type] ? type : "SHOP";
}

// ---------- AUTH ----------

// Registro de nueva tienda/usuario (lo usará solo admin.html)
app.post("/auth/register", requireAdmin, async (req, res) => {
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

      const license = await dbGet("SELECT * FROM store_licenses WHERE company = ?", [user.company]);
      if (license && !license.active) {
        return res.status(403).json({ error: "La licencia de esta tienda está inactiva." });
      }
      const today = getETLocalISO().slice(0, 10);
      if (license?.expiresAt && license.expiresAt < today) {
        return res.status(403).json({ error: "La licencia de esta tienda expiró. Contacta al administrador." });
      }

      if (user.mustChangePassword) {
        const setupToken = jwt.sign({ id: user.id, purpose: "create-password" }, SECRET, { expiresIn: "15m" });
        return res.json({ passwordChangeRequired: true, setupToken, username: user.username });
      }

      const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: "12h" });

      res.json({
        token,
        company: user.company,
        username: user.username,
        role: user.role || "Admin",
        businessType: normalizeBusinessType(license?.businessType),
        enabledModules: BUSINESS_TYPES[normalizeBusinessType(license?.businessType)].modules
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
  return dataStore.get(sql, params);
}

function dbRun(sql, params = []) {
  return dataStore.run(sql, params);
}

function resetCodeHash(userId, code) {
  return crypto.createHash("sha256").update(`${userId}:${code}:${SECRET}`).digest("hex");
}

async function sendTransactionalEmail(to, subject, html) {
  const apiKey = process.env.SENDGRID_API_KEY;
  const from = process.env.SENDGRID_FROM_EMAIL || process.env.EMAIL_FROM;
  if (!apiKey || !from) throw new Error("Configura SENDGRID_API_KEY y SENDGRID_FROM_EMAIL en Render.");
  const response = await fetch("https://api.sendgrid.com/v3/mail/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ personalizations: [{ to: [{ email: to }] }], from: { email: from, name: "POS Simple" }, subject, content: [{ type: "text/html", value: html }] })
  });
  if (!response.ok) throw new Error(`SendGrid rechazó el correo (${response.status}).`);
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
    "SELECT id, username, company, role, active, fullName FROM users WHERE id = ?",
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

function requireRestaurantStore(req, res, next) {
  requireCompanyUser(req, res, async () => {
    try {
      const license = await dbGet("SELECT businessType FROM store_licenses WHERE company = ?", [req.user.company]);
      if (normalizeBusinessType(license?.businessType) !== "RESTAURANT") {
        return res.status(403).json({ error: "El módulo Mesas está disponible únicamente para restaurantes." });
      }
      next();
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
}

function requireRestaurantAdmin(req, res, next) {
  requireRestaurantStore(req, res, () => {
    if (req.user.role !== "Admin") {
      return res.status(403).json({ error: "Solo un administrador puede configurar las mesas." });
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

if (!dataStore.postgres) for (const migration of [
  "ALTER TABLE users ADD COLUMN fullName TEXT DEFAULT ''",
  "ALTER TABLE users ADD COLUMN mustChangePassword INTEGER DEFAULT 0"
]) {
  db.run(migration, err => {
    if (err && !String(err.message).includes("duplicate column")) {
      console.error("Error actualizando users:", err.message);
    }
  });
}

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
    await dbRun(
      "INSERT INTO client_intake_submissions (company, clientId, createdAt) VALUES (?, ?, ?)",
      [tokenRow.company, result.lastID, getETLocalISO()]
    );
    res.json({ saved: true, id: result.lastID });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/client-intake/claim/:company", requireCompanyUser, async (req, res) => {
  try {
    const client = await dataStore.transaction(async () => {
      const submission = await dbGet(
        `SELECT id, clientId FROM client_intake_submissions
         WHERE company = ? AND claimedAt IS NULL ORDER BY id ASC LIMIT 1`,
        [req.params.company]
      );
      if (!submission) return null;
      await dbRun(
        "UPDATE client_intake_submissions SET claimedAt = ? WHERE id = ? AND claimedAt IS NULL",
        [getETLocalISO(), submission.id]
      );
      return dbGet("SELECT * FROM clients WHERE id = ? AND company = ?", [submission.clientId, req.params.company]);
    });
    res.json({ client });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET lista de tiendas (una fila por company)
app.get("/admin/tiendas", requireAdmin, (req, res) => {
  db.all(
    `
    SELECT MIN(u.id) AS id, u.company,
           COALESCE(MAX(l.active), MIN(u.active), 1) AS active,
           MAX(l.expiresAt) AS expiresAt,
           COALESCE(MAX(l.userLimit), CASE WHEN COUNT(u.id) < 3 THEN 3 ELSE CAST(COUNT(u.id) AS INTEGER) END) AS userLimit,
           CAST(COUNT(u.id) AS INTEGER) AS userCount,
           COALESCE(MAX(l.businessType), 'SHOP') AS businessType,
           MAX(l.createdAt) AS createdAt, MAX(l.updatedAt) AS updatedAt
    FROM users u
    LEFT JOIN store_licenses l ON l.company = u.company
    GROUP BY u.company
    ORDER BY u.company
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

  const now = getETLocalISO();
  db.run(
    `INSERT INTO store_licenses (company, active, userLimit, createdAt, updatedAt)
     VALUES (?, ?, 3, ?, ?)
     ON CONFLICT(company) DO UPDATE SET active=excluded.active, updatedAt=excluded.updatedAt`,
    [company, val, now, now],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ updated: this.changes });
    }
  );
});

// Eliminar tienda completa (usuarios, productos, ventas)
app.delete("/admin/tiendas/:company", requireAdmin, async (req, res) => {
  const company = req.params.company;
  const tables = ["restaurant_table_sessions", "restaurant_servers", "restaurant_tables", "client_intake_submissions", "client_intake_tokens", "sri_certificates",
    "sri_settings", "invoices", "clients", "sales", "products", "users", "store_licenses"];
  try {
    await dataStore.transaction(async () => {
      await dbRun("DELETE FROM password_reset_codes WHERE userId IN (SELECT id FROM users WHERE company = ?)", [company]);
      for (const table of tables) await dbRun(`DELETE FROM ${table} WHERE company = ?`, [company]);
    });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Lista de todos los usuarios
app.get("/admin/usuarios", requireAdmin, (req, res) => {
  db.all(
    `
    SELECT id, username, fullName, company, role, active, mustChangePassword
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
  const { username, password, company, role, fullName } = req.body;
  if (!String(fullName || "").trim() || !/^\S+@\S+\.\S+$/.test(String(username || "").trim()) || String(password || "").length < 8) {
    return res.status(400).json({ error: "Completa el nombre, un correo válido y una contraseña temporal de al menos 8 caracteres." });
  }

  try {
    const license = await dbGet("SELECT * FROM store_licenses WHERE company = ?", [company]);
    const count = await dbGet("SELECT COUNT(*) AS total FROM users WHERE company = ?", [company]);
    if (license && !license.active) return res.status(403).json({ error: "La licencia de la tienda está inactiva." });
    if (license?.expiresAt && license.expiresAt < getETLocalISO().slice(0, 10)) return res.status(403).json({ error: "La licencia de la tienda está vencida." });
    if (license && count.total >= license.userLimit) return res.status(409).json({ error: `Límite alcanzado: ${count.total} de ${license.userLimit} usuarios.` });
    const hashed = await bcrypt.hash(password, 10);

    db.run(
      `
      INSERT INTO users (username, password, company, role, active, fullName, mustChangePassword)
      VALUES (?, ?, ?, ?, 1, ?, 1)
      `,
      [String(username).trim().toLowerCase(), hashed, company, role === "Usuario" ? "Usuario" : "Admin", String(fullName || "").trim()],
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
  db.run("DELETE FROM password_reset_codes WHERE userId = ?", [req.params.id], err => {
    if (err) return res.status(500).json({ error: err.message });
    db.run("DELETE FROM users WHERE id = ?", [req.params.id], function (err) {
    if (err) return res.status(500).json({ error: err.message });
    res.json({ deleted: this.changes });
    });
  });
});


// ---------- CAMBIO DE CONTRASEÑA (CLIENTE) ----------
app.post("/auth/change-password", (req, res) => {
  const { username, oldPassword, newPassword } = req.body;

  if (!username || !oldPassword || !newPassword) {
    return res.status(400).json({ error: "Datos incompletos." });
  }
  if (String(newPassword).length < 8) return res.status(400).json({ error: "La nueva contraseña debe tener al menos 8 caracteres." });

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
          "UPDATE users SET password = ?, mustChangePassword = 0 WHERE id = ?",
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

    const invoice = await dataStore.transaction(async () => {
      const createdInvoice = await dbRun(
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
            line.product.price, line.gross, date, payType, createdInvoice.lastID, company]
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
      return createdInvoice;
    });

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
    res.status(500).json({ error: err.message });
  }
});

app.put("/admin/usuarios/:id/password", requireAdmin, async (req, res) => {
  const password = String(req.body.password || "");
  if (password.length < 8) return res.status(400).json({ error: "La contraseña temporal debe tener al menos 8 caracteres." });
  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await dbRun("UPDATE users SET password = ?, mustChangePassword = 1 WHERE id = ?", [hashed, req.params.id]);
    if (!result.changes) return res.status(404).json({ error: "Usuario no encontrado." });
    res.json({ updated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/admin/tiendas", requireAdmin, async (req, res) => {
  const { company, username, password, expiresAt, userLimit, fullName } = req.body;
  const businessType = normalizeBusinessType(req.body.businessType);
  if (!company || !String(fullName || "").trim() || !/^\S+@\S+\.\S+$/.test(String(username || "").trim()) || String(password || "").length < 8) return res.status(400).json({ error: "Completa tienda, nombre del Admin, correo válido y contraseña temporal de al menos 8 caracteres." });
  const limit = Math.max(1, Number(userLimit) || 1);
  const now = getETLocalISO();
  try {
    const existing = await dbGet("SELECT id FROM users WHERE company = ? OR username = ?", [company, username]);
    if (existing) return res.status(409).json({ error: "La tienda o el usuario ya existe." });
    const hashed = await bcrypt.hash(password, 10);
    const user = await dataStore.transaction(async () => {
      const createdUser = await dbRun("INSERT INTO users (username, password, company, role, active, fullName, mustChangePassword) VALUES (?, ?, ?, 'Admin', 1, ?, 1)", [String(username).trim().toLowerCase(), hashed, company, String(fullName || "").trim()]);
      await dbRun("INSERT INTO store_licenses (company, active, expiresAt, userLimit, businessType, createdAt, updatedAt) VALUES (?, 1, ?, ?, ?, ?, ?)", [company, expiresAt || null, limit, businessType, now, now]);
      return createdUser;
    });
    res.json({ id: user.lastID, company });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/store/users", requireUserAdmin, async (req, res) => {
  try {
    const rows = await new Promise((resolve, reject) => db.all(
      "SELECT id, username, fullName, role, active, mustChangePassword FROM users WHERE company = ? ORDER BY fullName, username",
      [req.user.company], (err, data) => err ? reject(err) : resolve(data)
    ));
    const license = await dbGet("SELECT userLimit FROM store_licenses WHERE company = ?", [req.user.company]);
    res.json({ users: rows, userLimit: Number(license?.userLimit || 1), currentUserId: req.user.id });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/store/context", requireCompanyUser, async (req, res) => {
  try {
    const license = await dbGet("SELECT businessType FROM store_licenses WHERE company = ?", [req.user.company]);
    const businessType = normalizeBusinessType(license?.businessType);
    res.json({
      company: req.user.company,
      businessType,
      businessTypeLabel: BUSINESS_TYPES[businessType].label,
      enabledModules: BUSINESS_TYPES[businessType].modules
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/store/users", requireUserAdmin, async (req, res) => {
  const username = String(req.body.username || "").trim().toLowerCase();
  const fullName = String(req.body.fullName || "").trim();
  const password = String(req.body.password || "");
  const role = req.body.role === "Usuario" ? "Usuario" : "Admin";
  if (!fullName || !/^\S+@\S+\.\S+$/.test(username) || password.length < 8) {
    return res.status(400).json({ error: "Completa el nombre, un correo válido y una contraseña temporal de al menos 8 caracteres." });
  }
  try {
    const license = await dbGet("SELECT * FROM store_licenses WHERE company = ?", [req.user.company]);
    const count = await dbGet("SELECT COUNT(*) AS total FROM users WHERE company = ?", [req.user.company]);
    if (license && count.total >= license.userLimit) {
      return res.status(409).json({ error: "Has alcanzado el límite de tu licencia. Contacta a POS Simple para comprar usuarios adicionales." });
    }
    const hashed = await bcrypt.hash(password, 10);
    const result = await dbRun("INSERT INTO users (username, password, company, role, active, fullName, mustChangePassword) VALUES (?, ?, ?, ?, 1, ?, 1)", [username, hashed, req.user.company, role, fullName]);
    res.json({ id: result.lastID });
  } catch (err) {
    const duplicate = String(err.message).includes("UNIQUE");
    res.status(duplicate ? 409 : 500).json({ error: duplicate ? "Ese correo ya está registrado." : err.message });
  }
});

app.put("/store/users/:id/temporary-password", requireUserAdmin, async (req, res) => {
  const password = String(req.body.password || "");
  if (password.length < 8) return res.status(400).json({ error: "La contraseña temporal debe tener al menos 8 caracteres." });
  try {
    const hashed = await bcrypt.hash(password, 10);
    const result = await dbRun("UPDATE users SET password = ?, mustChangePassword = 1 WHERE id = ? AND company = ?", [hashed, req.params.id, req.user.company]);
    if (!result.changes) return res.status(404).json({ error: "Usuario no encontrado." });
    res.json({ updated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/store/users/:id/role", requireUserAdmin, async (req, res) => {
  const role = req.body.role === "Usuario" ? "Usuario" : "Admin";
  try {
    const target = await dbGet("SELECT id, role FROM users WHERE id = ? AND company = ?", [req.params.id, req.user.company]);
    if (!target) return res.status(404).json({ error: "Usuario no encontrado." });
    if (target.role === "Admin" && role === "Usuario") {
      const admins = await dbGet("SELECT COUNT(*) AS total FROM users WHERE company = ? AND role = 'Admin'", [req.user.company]);
      if (admins.total <= 1) return res.status(400).json({ error: "La tienda debe conservar al menos un administrador." });
    }
    await dbRun("UPDATE users SET role = ? WHERE id = ? AND company = ?", [role, req.params.id, req.user.company]);
    res.json({ updated: true, role });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/store/users/:id", requireUserAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (id === req.user.id) return res.status(400).json({ error: "No puedes eliminar tu propia cuenta." });
  try {
    const target = await dbGet("SELECT role FROM users WHERE id = ? AND company = ?", [id, req.user.company]);
    if (!target) return res.status(404).json({ error: "Usuario no encontrado." });
    if (target.role === "Admin") {
      const admins = await dbGet("SELECT COUNT(*) AS total FROM users WHERE company = ? AND role = 'Admin'", [req.user.company]);
      if (admins.total <= 1) return res.status(400).json({ error: "La tienda debe conservar al menos un administrador." });
    }
    await dbRun("DELETE FROM password_reset_codes WHERE userId = ?", [id]);
    await dbRun("DELETE FROM users WHERE id = ? AND company = ?", [id, req.user.company]);
    res.json({ deleted: true });
  } catch (err) {
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
    await dataStore.transaction(async () => {
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
    });
    res.json(summary);
  } catch (err) {
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

if (!dataStore.postgres) {
  addColumnIfMissing("products", "taxRate REAL DEFAULT 15");
  addColumnIfMissing("sales", "invoiceId INTEGER");
  addColumnIfMissing("sri_settings", "certificateValidated INTEGER DEFAULT 0");
  addColumnIfMissing("store_licenses", "businessType TEXT DEFAULT 'SHOP'");
}

app.delete("/sales/:company/:id", requireUserAdmin, async (req, res) => {
  const { company, id } = req.params;
  try {
    const deleted = await dataStore.transaction(async () => {
      const sale = await dbGet("SELECT id, productId, quantity FROM sales WHERE id = ? AND company = ?", [id, company]);
      if (!sale) return null;
      await dbRun("UPDATE products SET quantity = quantity + ? WHERE id = ? AND company = ?", [sale.quantity, sale.productId, company]);
      return dbRun("DELETE FROM sales WHERE id = ? AND company = ?", [id, company]);
    });
    if (!deleted) return res.status(404).json({ error: "Venta no encontrada." });
    res.json({ deleted: deleted.changes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/auth/create-password", async (req, res) => {
  const password = String(req.body.password || "");
  if (password.length < 8) return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres." });
  try {
    const payload = jwt.verify(String(req.body.setupToken || ""), SECRET);
    if (payload.purpose !== "create-password") throw new Error("invalid purpose");
    const hashed = await bcrypt.hash(password, 10);
    const result = await dbRun("UPDATE users SET password = ?, mustChangePassword = 0 WHERE id = ? AND mustChangePassword = 1", [hashed, payload.id]);
    if (!result.changes) return res.status(400).json({ error: "Esta contraseña ya fue creada. Inicia sesión nuevamente." });
    res.json({ updated: true });
  } catch {
    res.status(400).json({ error: "La sesión para crear la contraseña expiró. Inicia sesión nuevamente." });
  }
});

app.post("/auth/forgot-password", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const generic = { sent: true, message: "Si el correo está registrado, recibirás un código en unos minutos." };
  try {
    const user = await dbGet("SELECT id, username FROM users WHERE lower(username) = ? AND active = 1", [email]);
    if (!user) return res.json(generic);
    const code = String(crypto.randomInt(100000, 1000000));
    const now = new Date();
    const expires = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
    await dbRun("UPDATE password_reset_codes SET usedAt = ? WHERE userId = ? AND usedAt IS NULL", [now.toISOString(), user.id]);
    await dbRun("INSERT INTO password_reset_codes (userId, codeHash, expiresAt, createdAt) VALUES (?, ?, ?, ?)", [user.id, resetCodeHash(user.id, code), expires, now.toISOString()]);
    await sendTransactionalEmail(user.username, "Código para restablecer tu contraseña", `<div style="font-family:Arial,sans-serif"><h2>POS Simple</h2><p>Tu código para restablecer la contraseña es:</p><p style="font-size:30px;font-weight:bold;letter-spacing:6px">${code}</p><p>Este código vence en 15 minutos. Si no lo solicitaste, ignora este correo.</p></div>`);
    res.json(generic);
  } catch (err) {
    console.error("No se pudo enviar recuperación:", err.message);
    res.status(503).json({ error: "No se pudo enviar el código en este momento. Intenta nuevamente." });
  }
});

app.post("/auth/reset-password", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const code = String(req.body.code || "").trim();
  const password = String(req.body.password || "");
  if (!/^\d{6}$/.test(code)) return res.status(400).json({ error: "Ingresa el código de 6 dígitos." });
  if (password.length < 8) return res.status(400).json({ error: "La contraseña debe tener al menos 8 caracteres." });
  try {
    const user = await dbGet("SELECT id FROM users WHERE lower(username) = ? AND active = 1", [email]);
    if (!user) return res.status(400).json({ error: "El código no es válido o ya expiró." });
    const reset = await dbGet("SELECT * FROM password_reset_codes WHERE userId = ? AND codeHash = ? AND usedAt IS NULL ORDER BY id DESC LIMIT 1", [user.id, resetCodeHash(user.id, code)]);
    if (!reset || reset.expiresAt < new Date().toISOString()) return res.status(400).json({ error: "El código no es válido o ya expiró." });
    const hashed = await bcrypt.hash(password, 10);
    await dataStore.transaction(async () => {
      await dbRun("UPDATE users SET password = ?, mustChangePassword = 0 WHERE id = ?", [hashed, user.id]);
      await dbRun("UPDATE password_reset_codes SET usedAt = ? WHERE id = ?", [new Date().toISOString(), reset.id]);
    });
    res.json({ updated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/admin/tiendas/:company/licencia", requireAdmin, async (req, res) => {
  const company = req.params.company;
  const active = req.body.active ? 1 : 0;
  const expiresAt = req.body.expiresAt || null;
  const userLimit = Math.max(1, Number(req.body.userLimit) || 1);
  const businessType = normalizeBusinessType(req.body.businessType);
  const now = getETLocalISO();
  try {
    const count = await dbGet("SELECT COUNT(*) AS total FROM users WHERE company = ?", [company]);
    if (!count?.total) return res.status(404).json({ error: "Tienda no encontrada." });
    if (userLimit < count.total) return res.status(400).json({ error: `La tienda ya tiene ${count.total} usuarios. El límite no puede ser menor.` });
    await dbRun(
      `INSERT INTO store_licenses (company, active, expiresAt, userLimit, businessType, createdAt, updatedAt)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(company) DO UPDATE SET active=excluded.active, expiresAt=excluded.expiresAt,
         userLimit=excluded.userLimit, businessType=excluded.businessType, updatedAt=excluded.updatedAt`,
      [company, active, expiresAt, userLimit, businessType, now, now]
    );
    res.json({ saved: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- RESTAURANTE: MESAS ----------

app.get("/restaurant/servers", requireRestaurantStore, async (req, res) => {
  try {
    const rows = await dataStore.all(
      `SELECT id, name, active, createdAt FROM restaurant_servers
       WHERE company = ? ${req.user.role === "Admin" ? "" : "AND active = 1"}
       ORDER BY active DESC, name, id`,
      [req.user.company]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/restaurant/servers", requireRestaurantAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    if (!name || name.length > 80) return res.status(400).json({ error: "Escribe un nombre de hasta 80 caracteres." });
    const existing = await dbGet("SELECT id FROM restaurant_servers WHERE company = ? AND lower(name) = lower(?)", [req.user.company, name]);
    if (existing) return res.status(409).json({ error: "Ya existe un mesero con ese nombre." });
    const createdAt = getETLocalISO();
    const result = await dbRun(
      "INSERT INTO restaurant_servers (company, name, active, createdAt) VALUES (?, ?, 1, ?)",
      [req.user.company, name, createdAt]
    );
    res.json({ id: result.lastID, name, active: 1, createdAt });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/restaurant/servers/:id", requireRestaurantAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const server = await dbGet("SELECT * FROM restaurant_servers WHERE id = ? AND company = ?", [id, req.user.company]);
    if (!server) return res.status(404).json({ error: "Mesero no encontrado." });
    const name = String(req.body.name || server.name).trim();
    const active = req.body.active === false || req.body.active === 0 ? 0 : 1;
    if (!name || name.length > 80) return res.status(400).json({ error: "Escribe un nombre de hasta 80 caracteres." });
    const duplicate = await dbGet("SELECT id FROM restaurant_servers WHERE company = ? AND lower(name) = lower(?) AND id <> ?", [req.user.company, name, id]);
    if (duplicate) return res.status(409).json({ error: "Ya existe un mesero con ese nombre." });
    await dbRun("UPDATE restaurant_servers SET name = ?, active = ? WHERE id = ? AND company = ?", [name, active, id, req.user.company]);
    res.json({ updated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/restaurant/table-sessions", requireRestaurantStore, async (req, res) => {
  try {
    const rows = await dataStore.all(
      `SELECT s.id, s.tableId, t.name AS tableName, s.restaurantServerId, s.serverName,
              s.guests, s.openedAt, s.closedAt, s.durationMinutes
       FROM restaurant_table_sessions s
       LEFT JOIN restaurant_tables t ON t.id = s.tableId
       WHERE s.company = ? AND s.closedAt IS NOT NULL
       ORDER BY s.closedAt DESC, s.id DESC
       LIMIT 100`,
      [req.user.company]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/restaurant/tables", requireRestaurantStore, async (req, res) => {
  try {
    const includeInactive = req.user.role === "Admin";
    const rows = await dataStore.all(
      `SELECT t.id, t.name, t.capacity, t.active,
              s.id AS sessionId, s.guests, s.status, s.openedAt,
              s.serverUserId, s.serverName
       FROM restaurant_tables t
       LEFT JOIN restaurant_table_sessions s
         ON s.tableId = t.id AND s.closedAt IS NULL
       WHERE t.company = ? ${includeInactive ? "" : "AND t.active = 1"}
       ORDER BY t.name, t.id`,
      [req.user.company]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/restaurant/tables", requireRestaurantAdmin, async (req, res) => {
  try {
    const name = String(req.body.name || "").trim();
    const capacity = Math.min(30, Math.max(1, Number(req.body.capacity) || 4));
    if (!name || name.length > 50) return res.status(400).json({ error: "Escribe un nombre de mesa de hasta 50 caracteres." });
    const existing = await dbGet("SELECT id FROM restaurant_tables WHERE company = ? AND lower(name) = lower(?)", [req.user.company, name]);
    if (existing) return res.status(409).json({ error: "Ya existe una mesa con ese nombre." });
    const result = await dbRun(
      "INSERT INTO restaurant_tables (company, name, capacity, active, createdAt) VALUES (?, ?, ?, 1, ?)",
      [req.user.company, name, capacity, getETLocalISO()]
    );
    res.json({ id: result.lastID, name, capacity, active: 1 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/restaurant/tables/:id", requireRestaurantAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const table = await dbGet("SELECT * FROM restaurant_tables WHERE id = ? AND company = ?", [id, req.user.company]);
    if (!table) return res.status(404).json({ error: "Mesa no encontrada." });
    const name = String(req.body.name || table.name).trim();
    const capacity = Math.min(30, Math.max(1, Number(req.body.capacity) || table.capacity || 4));
    const active = req.body.active === false || req.body.active === 0 ? 0 : 1;
    if (!name || name.length > 50) return res.status(400).json({ error: "Escribe un nombre de mesa de hasta 50 caracteres." });
    const duplicate = await dbGet("SELECT id FROM restaurant_tables WHERE company = ? AND lower(name) = lower(?) AND id <> ?", [req.user.company, name, id]);
    if (duplicate) return res.status(409).json({ error: "Ya existe una mesa con ese nombre." });
    if (!active) {
      const openSession = await dbGet("SELECT id FROM restaurant_table_sessions WHERE tableId = ? AND closedAt IS NULL", [id]);
      if (openSession) return res.status(409).json({ error: "No puedes desactivar una mesa ocupada." });
    }
    await dbRun("UPDATE restaurant_tables SET name = ?, capacity = ?, active = ? WHERE id = ? AND company = ?", [name, capacity, active, id, req.user.company]);
    res.json({ updated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/restaurant/tables/:id", requireRestaurantAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const openSession = await dbGet("SELECT id FROM restaurant_table_sessions WHERE tableId = ? AND closedAt IS NULL", [id]);
    if (openSession) return res.status(409).json({ error: "No puedes eliminar una mesa ocupada." });
    const history = await dbGet("SELECT COUNT(*) AS total FROM restaurant_table_sessions WHERE tableId = ?", [id]);
    if (Number(history?.total || 0) > 0) {
      await dbRun("UPDATE restaurant_tables SET active = 0 WHERE id = ? AND company = ?", [id, req.user.company]);
      return res.json({ deactivated: true });
    }
    const result = await dbRun("DELETE FROM restaurant_tables WHERE id = ? AND company = ?", [id, req.user.company]);
    if (!result.changes) return res.status(404).json({ error: "Mesa no encontrada." });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/restaurant/tables/:id/seat", requireRestaurantStore, async (req, res) => {
  const id = Number(req.params.id);
  const guests = Number(req.body.guests);
  const restaurantServerId = Number(req.body.restaurantServerId);
  if (!Number.isInteger(guests) || guests > 99) return res.status(400).json({ error: "Ingresa una cantidad válida de clientes." });
  if (guests < 1) return res.status(400).json({ error: "Debe haber al menos un cliente." });
  if (!Number.isInteger(restaurantServerId) || restaurantServerId < 1) return res.status(400).json({ error: "Selecciona el mesero que atenderá la mesa." });
  try {
    const session = await dataStore.transaction(async () => {
      const table = await dbGet("SELECT * FROM restaurant_tables WHERE id = ? AND company = ? AND active = 1", [id, req.user.company]);
      if (!table) throw Object.assign(new Error("Mesa no encontrada o inactiva."), { status: 404 });
      const open = await dbGet("SELECT id FROM restaurant_table_sessions WHERE tableId = ? AND closedAt IS NULL", [id]);
      if (open) throw Object.assign(new Error("Esta mesa ya está ocupada."), { status: 409 });
      const restaurantServer = await dbGet(
        "SELECT id, name FROM restaurant_servers WHERE id = ? AND company = ? AND active = 1",
        [restaurantServerId, req.user.company]
      );
      if (!restaurantServer) throw Object.assign(new Error("El mesero seleccionado no existe o está inactivo."), { status: 400 });
      const openedAt = getETLocalISO();
      const serverName = restaurantServer.name;
      const result = await dbRun(
        `INSERT INTO restaurant_table_sessions
         (company, tableId, restaurantServerId, serverUserId, serverName, guests, status, openedAt)
         VALUES (?, ?, ?, ?, ?, ?, 'OCCUPIED', ?)`,
        [req.user.company, id, restaurantServerId, req.user.id, serverName, guests, openedAt]
      );
      return { id: result.lastID, tableId: id, restaurantServerId, guests, status: "OCCUPIED", openedAt, serverName };
    });
    res.json(session);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/restaurant/tables/:id/close", requireRestaurantStore, async (req, res) => {
  const id = Number(req.params.id);
  try {
    const session = await dbGet(
      "SELECT * FROM restaurant_table_sessions WHERE tableId = ? AND company = ? AND closedAt IS NULL",
      [id, req.user.company]
    );
    if (!session) return res.status(404).json({ error: "Esta mesa ya está disponible." });
    const closedAt = getETLocalISO();
    const durationMinutes = Math.max(0, Math.round((new Date(closedAt) - new Date(session.openedAt)) / 60000));
    await dbRun(
      "UPDATE restaurant_table_sessions SET closedAt = ?, durationMinutes = ?, status = 'CLOSED' WHERE id = ?",
      [closedAt, durationMinutes, session.id]
    );
    res.json({ closed: true, durationMinutes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", database: dataStore.postgres ? "postgresql" : "sqlite" });
});

async function initializePostgres() {
  if (!dataStore.postgres) return;
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (id SERIAL PRIMARY KEY, username TEXT UNIQUE, password TEXT, company TEXT, role TEXT DEFAULT 'Admin', active INTEGER DEFAULT 1, fullName TEXT DEFAULT '', mustChangePassword INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS store_licenses (company TEXT PRIMARY KEY, active INTEGER DEFAULT 1, expiresAt TEXT, userLimit INTEGER DEFAULT 3, businessType TEXT DEFAULT 'SHOP', createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL)`,
    `ALTER TABLE store_licenses ADD COLUMN IF NOT EXISTS businessType TEXT DEFAULT 'SHOP'`,
    `CREATE TABLE IF NOT EXISTS password_reset_codes (id SERIAL PRIMARY KEY, userId INTEGER NOT NULL, codeHash TEXT NOT NULL, expiresAt TEXT NOT NULL, usedAt TEXT, createdAt TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS products (id SERIAL PRIMARY KEY, code TEXT, name TEXT, quantity INTEGER, price DOUBLE PRECISION, taxRate DOUBLE PRECISION DEFAULT 15, company TEXT)`,
    `CREATE TABLE IF NOT EXISTS sales (id SERIAL PRIMARY KEY, productId INTEGER, code TEXT, name TEXT, quantity INTEGER, price DOUBLE PRECISION, total DOUBLE PRECISION, date TEXT, paymentType TEXT, invoiceId INTEGER, company TEXT)`,
    `CREATE TABLE IF NOT EXISTS invoices (id SERIAL PRIMARY KEY, company TEXT NOT NULL, invoiceType TEXT NOT NULL, clientId INTEGER, buyerIdType TEXT, buyerIdNumber TEXT, buyerName TEXT NOT NULL, buyerAddress TEXT, buyerEmail TEXT, subtotal DOUBLE PRECISION NOT NULL, taxAmount DOUBLE PRECISION NOT NULL, total DOUBLE PRECISION NOT NULL, paymentType TEXT NOT NULL, invoiceNumber TEXT, status TEXT DEFAULT 'CONFIGURATION_REQUIRED', sriMessage TEXT, date TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sri_settings (company TEXT PRIMARY KEY, environment TEXT DEFAULT 'TEST', ruc TEXT, legalName TEXT, commercialName TEXT, mainAddress TEXT, establishmentAddress TEXT, establishmentCode TEXT DEFAULT '001', emissionPoint TEXT DEFAULT '001', nextSequence INTEGER DEFAULT 1, accountingRequired TEXT DEFAULT 'NO', specialTaxpayerNumber TEXT, taxRegime TEXT, senderEmail TEXT, adminCopyEmail TEXT, certificateConfigured INTEGER DEFAULT 0, certificateValidated INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS sri_certificates (company TEXT PRIMARY KEY, filename TEXT NOT NULL, certificateEncrypted TEXT NOT NULL, passwordEncrypted TEXT NOT NULL, installedAt TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS client_intake_tokens (company TEXT PRIMARY KEY, tokenHash TEXT NOT NULL UNIQUE, active INTEGER DEFAULT 1, createdAt TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS client_intake_submissions (id SERIAL PRIMARY KEY, company TEXT NOT NULL, clientId INTEGER NOT NULL, createdAt TEXT NOT NULL, claimedAt TEXT)`,
    `CREATE TABLE IF NOT EXISTS clients (id SERIAL PRIMARY KEY, company TEXT, idType TEXT, idNumber TEXT, razonSocial TEXT, nombreComercial TEXT, ciudad TEXT, direccion TEXT, email TEXT, telefono TEXT, celular TEXT)`,
    `CREATE TABLE IF NOT EXISTS restaurant_tables (id SERIAL PRIMARY KEY, company TEXT NOT NULL, name TEXT NOT NULL, capacity INTEGER DEFAULT 4, active INTEGER DEFAULT 1, createdAt TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS restaurant_servers (id SERIAL PRIMARY KEY, company TEXT NOT NULL, name TEXT NOT NULL, active INTEGER DEFAULT 1, createdAt TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS restaurant_table_sessions (id SERIAL PRIMARY KEY, company TEXT NOT NULL, tableId INTEGER NOT NULL, restaurantServerId INTEGER, serverUserId INTEGER NOT NULL, serverName TEXT NOT NULL, guests INTEGER NOT NULL, status TEXT DEFAULT 'OCCUPIED', openedAt TEXT NOT NULL, closedAt TEXT, durationMinutes INTEGER)`,
    `ALTER TABLE restaurant_table_sessions ADD COLUMN IF NOT EXISTS restaurantServerId INTEGER`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_open_table_session ON restaurant_table_sessions(tableId) WHERE closedAt IS NULL`,
    `CREATE INDEX IF NOT EXISTS idx_users_company ON users(company)`,
    `CREATE INDEX IF NOT EXISTS idx_products_company ON products(company)`,
    `CREATE INDEX IF NOT EXISTS idx_sales_company_date ON sales(company, date)`,
    `CREATE INDEX IF NOT EXISTS idx_clients_company ON clients(company)`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_company_date ON invoices(company, date)`,
    `CREATE INDEX IF NOT EXISTS idx_restaurant_tables_company ON restaurant_tables(company)`,
    `CREATE INDEX IF NOT EXISTS idx_restaurant_servers_company ON restaurant_servers(company)`,
    `CREATE INDEX IF NOT EXISTS idx_restaurant_sessions_company ON restaurant_table_sessions(company, openedAt)`
  ];
  for (const statement of statements) await dataStore.run(statement);
  console.log("PostgreSQL conectado y tablas verificadas.");
}

const PORT = process.env.PORT || 4000;
initializePostgres()
  .then(() => app.listen(PORT, () => console.log(`✅ Backend running on http://localhost:${PORT}`)))
  .catch(err => {
    console.error("No se pudo inicializar la base de datos:", err);
    process.exit(1);
  });
