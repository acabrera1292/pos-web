const express = require("express");
const cors = require("cors");
const sqlite3 = require("sqlite3").verbose();
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const path = require("path");

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname, "../frontend")));

const db = new sqlite3.Database("./database.sqlite");

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
      company TEXT
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

const SECRET = "pos-secret";
const ADMIN_SECRET = "posmaster"; // 

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

      const token = jwt.sign({ id: user.id }, SECRET);

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


// ====== ADMIN & ROLES ======

function checkAdminSecret(req, res) {
  if (req.query.secret !== ADMIN_SECRET) {
    res.status(403).json({ error: "No autorizado" });
    return false;
  }
  return true;
}


// LISTA DE USUARIOS / TIENDAS
app.get("/admin/tiendas", (req, res) => {
  if (!checkAdminSecret(req, res)) return;

  db.all(
    "SELECT id, username, company, role, active FROM users ORDER BY company, username",
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// CREAR NUEVA TIENDA + USUARIO ADMIN INICIAL
app.post("/admin/tienda", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;

  const { email, password, company } = req.body;
  if (!email || !password || !company) {
    return res.status(400).json({ error: "Faltan datos" });
  }

  try {
    const hashed = await bcrypt.hash(password, 10);
    db.run(
      `INSERT INTO users (username, password, company, role, active)
       VALUES (?, ?, ?, 'Admin', 1)`,
      [email, hashed, company],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
      }
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ACTIVAR / DESACTIVAR USUARIO
app.post("/admin/tienda/:id/active", (req, res) => {
  if (!checkAdminSecret(req, res)) return;

  const { id } = req.params;
  const { active } = req.body; // true / false o 1 / 0

  db.run(
    "UPDATE users SET active = ? WHERE id = ?",
    [active ? 1 : 0, id],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ updated: this.changes });
    }
  );
});

// ELIMINAR TODA UNA TIENDA (usuarios + inventario + ventas)
app.delete("/admin/tienda/:company", (req, res) => {
  if (!checkAdminSecret(req, res)) return;

  const { company } = req.params;

  db.serialize(() => {
    db.run("DELETE FROM sales WHERE company = ?", [company]);
    db.run("DELETE FROM products WHERE company = ?", [company]);
    db.run("DELETE FROM users WHERE company = ?", [company], function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ deleted: this.changes });
    });
  });
});

// AÑADIR USUARIO A TIENDA EXISTENTE (Admin o Usuario)
app.post("/admin/usuario", async (req, res) => {
  if (!checkAdminSecret(req, res)) return;

  const { company, email, password, role } = req.body;
  if (!company || !email || !password) {
    return res.status(400).json({ error: "Faltan datos" });
  }

  const userRole = role === "Usuario" ? "Usuario" : "Admin";

  try {
    const hashed = await bcrypt.hash(password, 10);
    db.run(
      `INSERT INTO users (username, password, company, role, active)
       VALUES (?, ?, ?, ?, 1)`,
      [email, hashed, company, userRole],
      function (err) {
        if (err) return res.status(500).json({ error: err.message });
        res.json({ id: this.lastID });
      }
    );
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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


app.put("/products/:company/:id", (req, res) => {
  const { code, name, quantity, price } = req.body;
  const { company, id } = req.params;

  db.run(
    "UPDATE products SET code = ?, name = ?, quantity = ?, price = ? WHERE id = ? AND company = ?",
    [code, name, quantity, price, id, company],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ updated: this.changes });
    }
  );
});

app.delete("/products/:company/:id", (req, res) => {
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

app.post("/sales/:company", (req, res) => {
  const { company } = req.params;
  const { items, total, cash, paymentType } = req.body;
  const date = getETLocalISO();
  const payType = paymentType || "Efectivo";

  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: "Carrito vacío" });
  }

  db.serialize(() => {
    items.forEach((item) => {
      const lineTotal = item.price * item.quantity;
      db.run(
        `INSERT INTO sales (productId, code, name, quantity, price, total, date, paymentType, company)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          item.id,
          item.code,
          item.name,
          item.quantity,
          item.price,
          lineTotal,
          date,
          payType,
          company,
        ]
      );

      db.run(
        "UPDATE products SET quantity = quantity - ? WHERE id = ? AND company = ?",
        [item.quantity, item.id, company]
      );
    });
  });

  res.json({ msg: "Venta registrada", total, cash, paymentType: payType });
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

const PORT = process.env.PORT || 4000;
app.listen(PORT, () => {
  console.log(`✅ Backend running on http://localhost:${PORT}`);
});
