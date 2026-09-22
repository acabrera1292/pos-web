const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcrypt");
const path = require("path");
const crypto = require("crypto");
const forge = require("node-forge");
const { createDatabase } = require("./database");
const {
  Ambiente,
  FormaPago,
  loadCertificate,
  SriClient,
  TipoComprobante,
  TipoEmision
} = require("sri-ec");

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
      menuCategory TEXT DEFAULT 'General',
      available INTEGER DEFAULT 1,
      modifierGroups TEXT DEFAULT '[]',
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
      grossTotal REAL DEFAULT 0,
      discountPercent REAL DEFAULT 0,
      discountAmount REAL DEFAULT 0,
      discountReason TEXT DEFAULT '',
      selectedModifiers TEXT DEFAULT '[]',
      grantedByUserId INTEGER,
      grantedByName TEXT DEFAULT '',
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
      discountAmount REAL DEFAULT 0,
      total REAL NOT NULL,
      paymentType TEXT NOT NULL,
      cashRegisterSessionId INTEGER,
      restaurantOrderId INTEGER,
      invoiceNumber TEXT,
      status TEXT DEFAULT 'CONFIGURATION_REQUIRED',
      saleStatus TEXT DEFAULT 'COMPLETADA',
      cancellationReason TEXT,
      canceledAt TEXT,
      canceledByUserId INTEGER,
      canceledByName TEXT,
      cashReceived REAL DEFAULT 0,
      changeDue REAL DEFAULT 0,
      issuedByUserId INTEGER,
      issuedByName TEXT DEFAULT '',
      accessKey TEXT,
      authorizationNumber TEXT,
      authorizedAt TEXT,
      sriMessage TEXT,
      date TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS invoice_payments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      invoiceId INTEGER NOT NULL,
      paymentType TEXT NOT NULL,
      amount REAL NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS sale_adjustments (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      invoiceId INTEGER,
      saleId INTEGER NOT NULL,
      type TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      amount REAL NOT NULL,
      reason TEXT NOT NULL,
      paymentType TEXT NOT NULL,
      cashRegisterSessionId INTEGER NOT NULL,
      performedByUserId INTEGER,
      performedByName TEXT NOT NULL,
      createdAt TEXT NOT NULL
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
      certificateValidated INTEGER DEFAULT 0,
      certificateLocalValidated INTEGER DEFAULT 0
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
      joinedToSessionId INTEGER,
      openedAt TEXT NOT NULL,
      closedAt TEXT,
      durationMinutes INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS restaurant_orders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      tableSessionId INTEGER NOT NULL,
      tableId INTEGER NOT NULL,
      status TEXT DEFAULT 'OPEN',
      kitchenStatus TEXT DEFAULT 'NEW',
      kitchenReceivedAt TEXT,
      kitchenStartedAt TEXT,
      kitchenReadyAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      paidAt TEXT,
      invoiceId INTEGER
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS restaurant_order_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      orderId INTEGER NOT NULL,
      productId INTEGER NOT NULL,
      code TEXT,
      name TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      price REAL NOT NULL,
      discountPercent REAL DEFAULT 0,
      discountReason TEXT DEFAULT '',
      selectedModifiers TEXT DEFAULT '[]',
      note TEXT DEFAULT ''
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS cash_register_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      openedByUserId INTEGER NOT NULL,
      openedByName TEXT NOT NULL,
      openedAt TEXT NOT NULL,
      openingAmount REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'OPEN',
      closedByUserId INTEGER,
      closedByName TEXT,
      closedAt TEXT,
      cashSales REAL NOT NULL DEFAULT 0,
      cardSales REAL NOT NULL DEFAULT 0,
      transferSales REAL NOT NULL DEFAULT 0,
      otherSales REAL NOT NULL DEFAULT 0,
      cashIn REAL NOT NULL DEFAULT 0,
      cashOut REAL NOT NULL DEFAULT 0,
      expectedAmount REAL NOT NULL DEFAULT 0,
      countedAmount REAL,
      difference REAL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS cash_register_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      company TEXT NOT NULL,
      sessionId INTEGER NOT NULL,
      type TEXT NOT NULL,
      amount REAL NOT NULL,
      reason TEXT NOT NULL,
      recordedByUserId INTEGER NOT NULL,
      recordedByName TEXT NOT NULL,
      createdAt TEXT NOT NULL
    )
  `);

  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_open_table_session
          ON restaurant_table_sessions(tableId) WHERE closedAt IS NULL`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_order_session
          ON restaurant_orders(tableSessionId)`);
  db.run(`CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_register_open_company
          ON cash_register_sessions(company) WHERE status = 'OPEN'`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sale_adjustments_sale ON sale_adjustments(saleId)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_sale_adjustments_register ON sale_adjustments(cashRegisterSessionId)`);
  db.run(`CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoiceId)`);

});

if (!dataStore.postgres) db.run("ALTER TABLE invoices ADD COLUMN cashRegisterSessionId INTEGER", (err) => {
  if (err && !String(err.message).includes("duplicate column")) {
    console.error("Error agregando cashRegisterSessionId:", err.message);
  }
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
    modules: Object.freeze(["inicio", "inventario", "pos", "caja", "ventas", "clientes", "usuarios", "config"])
  }),
  RESTAURANT: Object.freeze({
    label: "Restaurante",
    modules: Object.freeze(["inicio", "inventario", "pos", "caja", "ventas", "clientes", "usuarios", "config", "mesas", "meseros", "historial-mesas", "menu", "cocina", "rendimiento-cocina", "reloj"])
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

function dbAll(sql, params = []) {
  return dataStore.all(sql, params);
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

function sriDate(value) {
  const date = new Date(value || Date.now());
  const parts = new Intl.DateTimeFormat("es-EC", {
    timeZone: "America/Guayaquil", year: "numeric", month: "2-digit", day: "2-digit"
  }).formatToParts(date).reduce((out, part) => (out[part.type] = part.value, out), {});
  return `${parts.day}/${parts.month}/${parts.year}`;
}

function sriPaymentType(paymentType) {
  const value = String(paymentType || "").toLowerCase();
  if (value.includes("efectivo")) return FormaPago.EFECTIVO;
  if (value.includes("débito") || value.includes("debito")) return FormaPago.TARJETA_DEBITO;
  if (value.includes("crédito") || value.includes("credito") || value.includes("tarjeta")) return FormaPago.TARJETA_CREDITO;
  return FormaPago.OTROS_SISTEMA_FINANCIERO;
}

async function submitInvoiceToSri(company, invoiceId) {
  const settings = await dbGet("SELECT * FROM sri_settings WHERE company = ?", [company]);
  if (!settings?.ruc || !settings.legalName || !settings.mainAddress) {
    throw new Error("Completa los datos del emisor SRI antes de enviar la factura.");
  }
  if (!settings.certificateConfigured) throw new Error("Instala primero el certificado .p12 del emisor.");
  if (settings.environment === "PRODUCTION" && !settings.certificateValidated) {
    throw new Error("La firma todavía no está autorizada para Producción.");
  }

  const certRow = await dbGet("SELECT certificateEncrypted, passwordEncrypted FROM sri_certificates WHERE company = ?", [company]);
  if (!certRow) throw new Error("No se encontró el certificado del emisor.");
  const certificate = loadCertificate(
    decryptCertificateValue(certRow.certificateEncrypted),
    decryptCertificateValue(certRow.passwordEncrypted).toString("utf8")
  );
  const invoice = await dbGet("SELECT * FROM invoices WHERE id = ? AND company = ?", [invoiceId, company]);
  if (!invoice) throw new Error("Factura no encontrada.");
  const lines = await dbAll(
    `SELECT s.*, p.taxRate FROM sales s LEFT JOIN products p ON p.id = s.productId
     WHERE s.invoiceId = ? AND s.company = ? ORDER BY s.id`, [invoiceId, company]
  );
  if (!lines.length) throw new Error("La factura no tiene detalles para enviar.");

  const totalConImpuestos = [];
  const detalles = lines.map(line => {
    const rate = Number(line.taxRate ?? 15);
    const total = money(line.total);
    const base = rate > 0 ? money(total / (1 + rate / 100)) : total;
    const tax = money(total - base);
    const grossUnit = Number(line.price) || 0;
    const priceUnit = rate > 0 ? money(grossUnit / (1 + rate / 100)) : money(grossUnit);
    const discount = rate > 0 ? money((Number(line.discountAmount) || 0) / (1 + rate / 100)) : money(line.discountAmount || 0);
    const taxCode = rate === 15 ? "4" : rate === 0 ? "0" : "2";
    const taxRow = { codigo: "2", codigoPorcentaje: taxCode, tarifa: rate.toFixed(2), baseImponible: base.toFixed(2), valor: tax.toFixed(2) };
    const existingTax = totalConImpuestos.find(row => row.codigoPorcentaje === taxCode);
    if (existingTax) {
      existingTax.baseImponible = money(Number(existingTax.baseImponible) + base).toFixed(2);
      existingTax.valor = money(Number(existingTax.valor) + tax).toFixed(2);
    } else totalConImpuestos.push({
      codigo: taxRow.codigo,
      codigoPorcentaje: taxRow.codigoPorcentaje,
      baseImponible: taxRow.baseImponible,
      valor: taxRow.valor
    });
    return {
      codigoPrincipal: String(line.code || line.productId),
      descripcion: String(line.name || "Producto").slice(0, 300),
      cantidad: Number(line.quantity || 0).toFixed(2),
      precioUnitario: priceUnit.toFixed(2),
      descuento: discount.toFixed(2),
      precioTotalSinImpuesto: base.toFixed(2),
      impuestos: [taxRow]
    };
  });

  const [estab = "001", ptoEmi = "001", secuencial = "000000001"] = String(invoice.invoiceNumber || "001-001-000000001").split("-");
  const ambiente = settings.environment === "PRODUCTION" ? Ambiente.Produccion : Ambiente.Pruebas;
  const factura = {
    tipo: TipoComprobante.Factura,
    infoTributaria: {
      ambiente,
      razonSocial: String(settings.legalName).slice(0, 300),
      nombreComercial: String(settings.commercialName || settings.legalName).slice(0, 300),
      ruc: String(settings.ruc), estab, ptoEmi, secuencial,
      dirMatriz: String(settings.mainAddress).slice(0, 300), tipoEmision: TipoEmision.Normal
    },
    dirEstablecimiento: settings.establishmentAddress || undefined,
    fechaEmision: sriDate(invoice.date),
    tipoIdentificacionComprador: invoice.buyerIdType || "07",
    razonSocialComprador: String(invoice.buyerName || "CONSUMIDOR FINAL").slice(0, 300),
    identificacionComprador: String(invoice.buyerIdNumber || "9999999999999"),
    direccionComprador: invoice.buyerAddress || undefined,
    totalSinImpuestos: Number(invoice.subtotal || 0).toFixed(2),
    totalDescuento: Number(invoice.discountAmount || 0).toFixed(2),
    importeTotal: Number(invoice.total || 0).toFixed(2),
    totalConImpuestos,
    detalles,
    pagos: [{ formaPago: sriPaymentType(invoice.paymentType), total: Number(invoice.total || 0).toFixed(2) }]
  };

  const sri = new SriClient({ ambiente, certificate });
  let result;
  try {
    result = await sri.emit(factura, invoice.accessKey || undefined);
  } catch (error) {
    if (error?.claveAcceso) {
      await dbRun(
        "UPDATE invoices SET status = ?, accessKey = ?, sriMessage = ? WHERE id = ? AND company = ?",
        ["PENDING_SRI", error.claveAcceso, error.message || "Error de comunicación con el SRI", invoiceId, company]
      );
    }
    throw error;
  }
  const messages = (result.messages || []).map(message => `${message.identificador || "SRI"}: ${message.mensaje || message.message || ""}`).join(" | ");
  const status = result.status === "AUTORIZADO" ? "AUTHORIZED" : result.status === "RECHAZADO" ? "SRI_REJECTED" : "PENDING_SRI";
  await dbRun(
    `UPDATE invoices SET status = ?, accessKey = ?, authorizationNumber = ?, authorizedAt = ?, sriMessage = ? WHERE id = ? AND company = ?`,
    [status, result.claveAcceso || invoice.accessKey || null, result.numeroAutorizacion || null, result.fechaAutorizacion || null, messages || result.status, invoiceId, company]
  );
  if (result.status === "AUTORIZADO") {
    await dbRun("UPDATE sri_settings SET certificateValidated = 1 WHERE company = ?", [company]);
  }
  return { ...result, status, message: messages };
}

const PAYMENT_TYPES = ["Efectivo", "Tarjeta", "Transferencia"];

function normalizeInvoicePayments(paymentType, rawPayments, total) {
  const type = PAYMENT_TYPES.includes(paymentType) ? paymentType : paymentType === "Mixto" ? "Mixto" : "Efectivo";
  if (type !== "Mixto") return { paymentType: type, payments: [{ paymentType: type, amount: total }] };
  const grouped = new Map();
  for (const item of Array.isArray(rawPayments) ? rawPayments : []) {
    const method = String(item?.paymentType || "");
    const amount = money(item?.amount || 0);
    if (!PAYMENT_TYPES.includes(method) || amount <= 0) continue;
    grouped.set(method, money((grouped.get(method) || 0) + amount));
  }
  const payments = Array.from(grouped, ([method, amount]) => ({ paymentType: method, amount }));
  const paymentTotal = money(payments.reduce((sum, item) => sum + item.amount, 0));
  if (payments.length < 2) throw Object.assign(new Error("El pago mixto debe usar al menos dos formas de pago."), { status: 400 });
  if (Math.abs(paymentTotal - total) > 0.009) {
    throw Object.assign(new Error(`Los pagos deben sumar exactamente $${total.toFixed(2)}.`), { status: 400 });
  }
  return { paymentType: "Mixto", payments };
}

function normalizeModifierGroups(input) {
  let groups = input;
  if (typeof groups === "string") {
    try { groups = JSON.parse(groups || "[]"); } catch { groups = []; }
  }
  if (!Array.isArray(groups)) return [];
  return groups.slice(0, 12).map((group, groupIndex) => ({
    name: String(group?.name || "").trim().slice(0, 60),
    required: Boolean(group?.required),
    multiple: Boolean(group?.multiple),
    sortOrder: groupIndex,
    options: (Array.isArray(group?.options) ? group.options : []).slice(0, 30).map((option, optionIndex) => ({
      name: String(option?.name || "").trim().slice(0, 60),
      priceDelta: money(Math.max(0, Number(option?.priceDelta) || 0)),
      sortOrder: optionIndex
    })).filter(option => option.name)
  })).filter(group => group.name && group.options.length);
}

function defaultBurgerModifierGroups(product) {
  const category = String(product?.menuCategory || '').toLowerCase();
  const name = String(product?.name || '').toLowerCase();
  if (!(category.includes('hamburg') || name.includes('burger') || name.includes('hamburgues'))) return [];
  return [
    { name: 'Término', required: true, multiple: false, options: [
      { name: 'Poco cocida' }, { name: '2/3' }, { name: '3/4' }, { name: 'Bien cocida' }
    ]},
    { name: 'Extras', required: false, multiple: true, options: [
      { name: 'Papas fritas' }, { name: 'Tocino', priceDelta: 1.5 },
      { name: 'Queso extra', priceDelta: 1 }, { name: 'Huevo', priceDelta: 1.25 }
    ]}
  ];
}

function parseProductModifierGroups(product) {
  const configured = normalizeModifierGroups(product?.modifierGroups || []);
  return configured.length ? configured : normalizeModifierGroups(defaultBurgerModifierGroups(product));
}

function parseJsonArray(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function resolveSelectedModifiers(product, input) {
  const groups = parseProductModifierGroups(product);
  const selections = Array.isArray(input) ? input : [];
  const clean = [];
  let extraPrice = 0;
  for (const group of groups) {
    const requested = selections.find(selection => String(selection?.group || "") === group.name);
    const names = Array.isArray(requested?.options)
      ? requested.options.map(option => String(typeof option === "object" ? option?.name : option))
      : [];
    const chosen = group.options.filter(option => names.includes(option.name));
    if (group.required && !chosen.length) {
      throw Object.assign(new Error(`Selecciona una opción para ${group.name}.`), { status: 400 });
    }
    if (!group.multiple && chosen.length > 1) {
      throw Object.assign(new Error(`Selecciona una sola opción para ${group.name}.`), { status: 400 });
    }
    if (chosen.length) {
      clean.push({ group: group.name, options: chosen.map(option => ({ name: option.name, priceDelta: option.priceDelta })) });
      extraPrice = money(extraPrice + chosen.reduce((sum, option) => sum + option.priceDelta, 0));
    }
  }
  return { selections: clean, extraPrice };
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
      return res.status(403).json({ error: "Solo un administrador puede usar esta función de Restaurante." });
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
      certificateConfigured: 0,
      certificateLocalValidated: 0,
      certificateValidated: 0
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
    const existing = await dbGet("SELECT certificateConfigured, certificateValidated, certificateLocalValidated FROM sri_settings WHERE company = ?", [company]);
    const certificateConfigured = existing?.certificateConfigured ? 1 : 0;
    const certificateValidated = existing?.certificateValidated ? 1 : 0;
    const certificateLocalValidated = existing?.certificateLocalValidated ? 1 : 0;
    if (environment === "PRODUCTION" && !certificateValidated) {
      return res.status(400).json({ error: "La firma debe validarse con el SRI antes de activar Producción." });
    }
    await dbRun(
      `INSERT INTO sri_settings
       (company, environment, ruc, legalName, commercialName, mainAddress,
        establishmentAddress, establishmentCode, emissionPoint, nextSequence,
        accountingRequired, specialTaxpayerNumber, taxRegime, senderEmail,
        adminCopyEmail, certificateConfigured, certificateValidated, certificateLocalValidated)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
         certificateValidated=excluded.certificateValidated,
         certificateLocalValidated=excluded.certificateLocalValidated`,
      [
        company, environment, values.ruc || "", values.legalName || "",
        values.commercialName || "", values.mainAddress || "",
        values.establishmentAddress || "", values.establishmentCode || "001",
        values.emissionPoint || "001", Math.max(1, Number(values.nextSequence) || 1),
        values.accountingRequired === "SI" ? "SI" : "NO",
        values.specialTaxpayerNumber || "", values.taxRegime || "",
        values.senderEmail || "", values.adminCopyEmail || "",
        certificateConfigured, certificateValidated, certificateLocalValidated
      ]
    );
    const saved = await dbGet("SELECT * FROM sri_settings WHERE company = ?", [company]);
    res.json({ saved: true, environment, settings: saved });
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
      `INSERT INTO sri_settings (company, certificateConfigured, certificateValidated, certificateLocalValidated)
       VALUES (?, 1, 0, 0)
       ON CONFLICT(company) DO UPDATE SET certificateConfigured=1, certificateValidated=0,
         certificateLocalValidated=0, environment='TEST'`,
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
      "UPDATE sri_settings SET certificateConfigured = 0, certificateValidated = 0, certificateLocalValidated = 0, environment = 'TEST' WHERE company = ?",
      [req.params.company]
    );
    res.json({ removed: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/settings/sri/:company/certificate/validate", requireUserAdmin, async (req, res) => {
  try {
    const row = await dbGet(
      "SELECT certificateEncrypted, passwordEncrypted, filename FROM sri_certificates WHERE company = ?",
      [req.params.company]
    );
    if (!row) return res.status(400).json({ error: "Primero instala un certificado .p12/.pfx." });
    const certificate = decryptCertificateValue(row.certificateEncrypted);
    const password = decryptCertificateValue(row.passwordEncrypted).toString("utf8");
    const details = inspectPkcs12(certificate, password);
    await dbRun("UPDATE sri_settings SET certificateLocalValidated = 1 WHERE company = ?", [req.params.company]);
    res.json({ validated: true, sriValidated: false, filename: row.filename, expiresAt: details.expiresAt });
  } catch (err) {
    await dbRun("UPDATE sri_settings SET certificateLocalValidated = 0 WHERE company = ?", [req.params.company]).catch(() => {});
    res.status(400).json({ error: err.message || "No se pudo validar el certificado." });
  }
});

app.post("/settings/sri/:company/test-connection", requireUserAdmin, async (req, res) => {
  const settings = await dbGet("SELECT environment FROM sri_settings WHERE company = ?", [req.params.company]);
  const environment = settings?.environment === "PRODUCTION" ? "PRODUCTION" : "TEST";
  const base = environment === "PRODUCTION" ? "https://cel.sri.gob.ec" : "https://celcer.sri.gob.ec";
  const url = `${base}/comprobantes-electronicos-ws/RecepcionComprobantesOffline?wsdl`;
  try {
    const response = await fetch(url, { headers: { Accept: "text/xml, application/xml" } });
    if (!response.ok) throw new Error(`SRI respondió HTTP ${response.status}.`);
    res.json({ connected: true, environment, endpoint: url });
  } catch (err) {
    res.status(502).json({ connected: false, environment, error: `No se pudo conectar con el SRI: ${err.message}` });
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
  const tables = ["restaurant_order_items", "restaurant_orders", "restaurant_table_sessions", "restaurant_servers", "restaurant_tables", "client_intake_submissions", "client_intake_tokens", "sri_certificates",
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
  if (!Number.isInteger(Number(quantity)) || Number(quantity) < 0 || !Number.isFinite(Number(price)) || Number(price) < 0) {
    return res.status(400).json({ error: "Ingresa una cantidad y un precio válidos." });
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
  if (!Number.isInteger(Number(quantity)) || Number(quantity) < 0 || !Number.isFinite(Number(price)) || Number(price) < 0) {
    return res.status(400).json({ error: "La fila contiene una cantidad o precio inválido." });
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
  const { items, cash, paymentType, payments: requestedPayments, invoiceType, clientId } = req.body;
  const restaurantOrderId = Number(req.body.restaurantOrderId) || null;
  const date = getETLocalISO();

  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ error: "Carrito vacío" });
  }

  const type = invoiceType === "FACTURA" ? "FACTURA" : "CONSUMIDOR_FINAL";

  try {
    const cashRegister = await dbGet(
      "SELECT * FROM cash_register_sessions WHERE company = ? AND status = 'OPEN' ORDER BY id DESC LIMIT 1",
      [company]
    );
    if (!cashRegister) {
      return res.status(409).json({ error: "Abre la caja antes de registrar una venta." });
    }
    const restaurantOrder = restaurantOrderId
      ? await dbGet(
        `SELECT o.*, s.openedAt
         FROM restaurant_orders o
         JOIN restaurant_table_sessions s ON s.id = o.tableSessionId
         WHERE o.id = ? AND o.company = ? AND o.status = 'OPEN' AND s.closedAt IS NULL`,
        [restaurantOrderId, company]
      )
      : null;
    if (restaurantOrderId && !restaurantOrder) {
      return res.status(400).json({ error: "El pedido de la mesa ya no está disponible." });
    }

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
    let discountAmount = 0;
    for (const item of items) {
      const orderItem = restaurantOrder
        ? await dbGet(
          "SELECT * FROM restaurant_order_items WHERE id = ? AND orderId = ? AND company = ?",
          [Number(item.orderItemId), restaurantOrder.id, company]
        )
        : null;
      if (restaurantOrder && !orderItem) {
        return res.status(409).json({ error: "Uno de los productos ya no pertenece a esta cuenta. Vuelve a abrir el pedido." });
      }
      const product = await dbGet(
        "SELECT * FROM products WHERE id = ? AND company = ?",
        [orderItem?.productId || item.id, company]
      );
      if (!product) return res.status(400).json({ error: `Producto no encontrado: ${item.code}` });
      if (!restaurantOrder && Number(product.available ?? 1) !== 1) {
        return res.status(409).json({ error: `${product.name} está marcado como agotado.` });
      }
      const quantity = Math.max(1, Number(item.quantity) || 1);
      if (orderItem && quantity > Number(orderItem.quantity || 0)) {
        return res.status(409).json({ error: `Solo quedan ${orderItem.quantity} unidad(es) de ${orderItem.name} en esta cuenta.` });
      }
      if (quantity > product.quantity) {
        return res.status(400).json({ error: `Inventario insuficiente para ${product.name}.` });
      }
      const discountPercent = Number(orderItem?.discountPercent ?? item.discountPercent ?? 0);
      if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
        return res.status(400).json({ error: `El descuento de ${product.name} debe estar entre 0% y 100%.` });
      }
      const discountReason = String(orderItem?.discountReason ?? item.discountReason ?? "").trim().slice(0, 80);
      if (discountPercent === 100 && !discountReason) {
        return res.status(400).json({ error: `Selecciona el motivo para entregar ${product.name} gratis.` });
      }
      let modifiers;
      try {
        modifiers = orderItem
          ? { selections: parseJsonArray(orderItem.selectedModifiers), extraPrice: 0 }
          : resolveSelectedModifiers(product, item.selectedModifiers);
      } catch (err) {
        return res.status(err.status || 400).json({ error: err.message });
      }
      const rate = Number(product.taxRate ?? 15);
      const unitPrice = orderItem ? money(orderItem.price) : money(Number(product.price) + modifiers.extraPrice);
      const gross = money(unitPrice * quantity);
      const lineDiscount = money(gross * discountPercent / 100);
      const net = money(gross - lineDiscount);
      const base = rate > 0 ? money(net / (1 + rate / 100)) : net;
      const tax = money(net - base);
      subtotal = money(subtotal + base);
      taxAmount = money(taxAmount + tax);
      discountAmount = money(discountAmount + lineDiscount);
      total = money(total + net);
      lines.push({ orderItemId: orderItem?.id || null, product, quantity, unitPrice, gross, discountPercent, discountAmount: lineDiscount, discountReason, selectedModifiers: modifiers.selections, net });
    }

    let payment;
    try {
      payment = normalizeInvoicePayments(paymentType, requestedPayments, total);
    } catch (err) {
      return res.status(err.status || 400).json({ error: err.message });
    }
    const payType = payment.paymentType;
    const cashPayment = payment.payments.find(item => item.paymentType === "Efectivo")?.amount || 0;
    if (payType === "Efectivo" && money(Number(cash) || 0) < total) {
      return res.status(400).json({ error: "El efectivo recibido es insuficiente." });
    }

    const settings = await dbGet("SELECT * FROM sri_settings WHERE company = ?", [company]);
    const sequence = settings?.nextSequence || 1;
    const establishment = settings?.establishmentCode || "001";
    const emissionPoint = settings?.emissionPoint || "001";
    const invoiceNumber = `${establishment}-${emissionPoint}-${String(sequence).padStart(9, "0")}`;
    const issuerConfigured = Boolean(settings?.ruc && settings?.legalName && settings?.mainAddress);
    const configured = issuerConfigured && Boolean(settings?.certificateLocalValidated || settings?.certificateValidated);
    const status = configured
      ? "PENDING_SRI"
      : settings?.certificateConfigured ? "CERTIFICATE_PENDING_VALIDATION" : "CONFIGURATION_REQUIRED";

    let tableClosed = false;
    let remainingItems = 0;
    const invoice = await dataStore.transaction(async () => {
      if (restaurantOrder) {
        const claimed = await dbRun(
          "UPDATE restaurant_orders SET status = 'PROCESSING', updatedAt = ? WHERE id = ? AND company = ? AND status = 'OPEN'",
          [date, restaurantOrder.id, company]
        );
        if (!claimed.changes) throw Object.assign(new Error("Este pedido ya está siendo procesado."), { status: 409 });
      }
      const createdInvoice = await dbRun(
      `INSERT INTO invoices
       (company, invoiceType, clientId, buyerIdType, buyerIdNumber, buyerName,
        buyerAddress, buyerEmail, subtotal, taxAmount, discountAmount, total, paymentType,
        cashRegisterSessionId, restaurantOrderId, invoiceNumber, status, cashReceived, changeDue,
        issuedByUserId, issuedByName, sriMessage, date)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        company, type, client?.id || null, client?.idType || "07",
        client?.idNumber || "9999999999999",
        client?.razonSocial || "CONSUMIDOR FINAL", client?.direccion || "",
        client?.email || "", subtotal, taxAmount, discountAmount, total, payType,
        cashRegister.id, restaurantOrder?.id || null, invoiceNumber, status,
        payType === "Efectivo" ? money(Number(cash) || 0) : cashPayment,
        payType === "Efectivo" ? money(Math.max(0, (Number(cash) || 0) - total)) : 0,
        req.user.id, req.user.fullName || req.user.username,
        configured ? "Pendiente de firma y envío al SRI." : "Complete la configuración SRI.",
        date
      ]
      );

      for (const item of payment.payments) {
        await dbRun(
          "INSERT INTO invoice_payments (company, invoiceId, paymentType, amount) VALUES (?, ?, ?, ?)",
          [company, createdInvoice.lastID, item.paymentType, item.amount]
        );
      }

      for (const line of lines) {
        await dbRun(
        `INSERT INTO sales
         (productId, code, name, quantity, price, grossTotal, discountPercent,
          discountAmount, discountReason, selectedModifiers, grantedByUserId, grantedByName, total,
          date, paymentType, invoiceId, company)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [line.product.id, line.product.code, line.product.name, line.quantity,
          line.unitPrice, line.gross, line.discountPercent, line.discountAmount,
          line.discountReason, JSON.stringify(line.selectedModifiers), line.discountPercent > 0 ? req.user.id : null,
          line.discountPercent > 0 ? (req.user.fullName || req.user.username) : "",
          line.net, date, payType, createdInvoice.lastID, company]
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
      if (restaurantOrder) {
        for (const line of lines) {
          await dbRun(
            "UPDATE restaurant_order_items SET quantity = quantity - ? WHERE id = ? AND orderId = ? AND company = ?",
            [line.quantity, line.orderItemId, restaurantOrder.id, company]
          );
          await dbRun(
            "DELETE FROM restaurant_order_items WHERE id = ? AND orderId = ? AND company = ? AND quantity <= 0",
            [line.orderItemId, restaurantOrder.id, company]
          );
        }
        const remaining = await dbGet(
          "SELECT COALESCE(SUM(quantity), 0) AS total FROM restaurant_order_items WHERE orderId = ? AND company = ?",
          [restaurantOrder.id, company]
        );
        remainingItems = Number(remaining?.total || 0);
        if (remainingItems > 0) {
          await dbRun(
            "UPDATE restaurant_orders SET status = 'OPEN', invoiceId = ?, updatedAt = ? WHERE id = ? AND company = ?",
            [createdInvoice.lastID, date, restaurantOrder.id, company]
          );
        } else {
          const durationMinutes = Math.max(0, Math.round((new Date(date) - new Date(restaurantOrder.openedAt)) / 60000));
          await dbRun(
            "UPDATE restaurant_orders SET status = 'PAID', paidAt = ?, invoiceId = ?, updatedAt = ? WHERE id = ? AND company = ?",
            [date, createdInvoice.lastID, date, restaurantOrder.id, company]
          );
          await dbRun(
            `UPDATE restaurant_table_sessions
             SET closedAt = ?, durationMinutes = ?, status = 'CLOSED'
             WHERE company = ? AND closedAt IS NULL AND (id = ? OR joinedToSessionId = ?)`,
            [date, durationMinutes, company, restaurantOrder.tableSessionId, restaurantOrder.tableSessionId]
          );
          tableClosed = true;
        }
      }
      return createdInvoice;
    });

    let sriResult = null;
    if (type === "FACTURA" && configured) {
      try {
        sriResult = await submitInvoiceToSri(company, invoice.lastID);
      } catch (sriError) {
        await dbRun("UPDATE invoices SET status = ?, sriMessage = ? WHERE id = ? AND company = ?", ["SRI_ERROR", sriError.message, invoice.lastID, company]);
        sriResult = { status: "SRI_ERROR", message: sriError.message };
      }
    }
    res.json({
      msg: "Venta registrada",
      invoiceId: invoice.lastID,
      invoiceNumber,
      status: sriResult?.status || status,
      sriMessage: sriResult?.message || null,
      accessKey: sriResult?.claveAcceso || null,
      authorizationNumber: sriResult?.numeroAutorizacion || null,
      subtotal,
      taxAmount,
      discountAmount,
      total,
      cash,
      paymentType: payType,
      payments: payment.payments,
      tableClosed,
      remainingItems
    });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/invoices/:company/:id/sri-send", requireUserAdmin, async (req, res) => {
  try {
    const result = await submitInvoiceToSri(req.params.company, Number(req.params.id));
    res.json({ sent: true, status: result.status, accessKey: result.claveAcceso || null, authorizationNumber: result.numeroAutorizacion || null, message: result.message || null });
  } catch (err) {
    await dbRun("UPDATE invoices SET status = ?, sriMessage = ? WHERE id = ? AND company = ?", ["SRI_ERROR", err.message, Number(req.params.id), req.params.company]).catch(() => {});
    res.status(502).json({ sent: false, status: "SRI_ERROR", error: err.message });
  }
});

app.get("/invoices/:id/receipt", requireCompanyUser, async (req, res) => {
  const invoiceId = Number(req.params.id);
  if (!Number.isInteger(invoiceId) || invoiceId < 1) return res.status(400).json({ error: "Comprobante inválido." });
  try {
    const invoice = await dbGet("SELECT * FROM invoices WHERE id = ? AND company = ?", [invoiceId, req.user.company]);
    if (!invoice) return res.status(404).json({ error: "Comprobante no encontrado." });
    const [settings, lines, restaurant, payments] = await Promise.all([
      dbGet("SELECT * FROM sri_settings WHERE company = ?", [req.user.company]),
      dataStore.all(
        `SELECT code, name, quantity, price, grossTotal, discountPercent, discountAmount,
                discountReason, selectedModifiers, total
         FROM sales WHERE invoiceId = ? AND company = ? ORDER BY id`,
        [invoiceId, req.user.company]
      ),
      dbGet(
        `SELECT o.tableSessionId, t.name AS tableName, s.serverName, s.guests
         FROM restaurant_orders o
         JOIN restaurant_table_sessions s ON s.id = o.tableSessionId
         JOIN restaurant_tables t ON t.id = o.tableId
         WHERE o.id = ? AND o.company = ?`,
        [invoice.restaurantOrderId, req.user.company]
      ),
      dataStore.all(
        "SELECT paymentType, amount FROM invoice_payments WHERE invoiceId = ? AND company = ? ORDER BY id",
        [invoiceId, req.user.company]
      )
    ]);
    if (restaurant?.tableSessionId) {
      const servedTables = await dataStore.all(
        `SELECT t.name AS tableName, s.guests
         FROM restaurant_table_sessions s
         JOIN restaurant_tables t ON t.id = s.tableId
         WHERE s.company = ? AND (s.id = ? OR s.joinedToSessionId = ?)
         ORDER BY CASE WHEN s.id = ? THEN 0 ELSE 1 END, t.name`,
        [req.user.company, restaurant.tableSessionId, restaurant.tableSessionId, restaurant.tableSessionId]
      );
      restaurant.tableName = servedTables.map(table => table.tableName).join(" + ") || restaurant.tableName;
      restaurant.guests = servedTables.reduce((sum, table) => sum + Number(table.guests || 0), 0) || restaurant.guests;
    }
    const environment = settings?.environment === "PRODUCTION" ? "PRODUCTION" : "TEST";
    const authorized = invoice.status === "AUTHORIZED" && Boolean(invoice.accessKey || invoice.authorizationNumber);
    res.json({
      invoice,
      issuer: {
        legalName: settings?.legalName || req.user.company,
        commercialName: settings?.commercialName || "",
        ruc: settings?.ruc || "",
        mainAddress: settings?.mainAddress || "",
        establishmentAddress: settings?.establishmentAddress || settings?.mainAddress || "",
        accountingRequired: settings?.accountingRequired || "NO",
        specialTaxpayerNumber: settings?.specialTaxpayerNumber || "",
        taxRegime: settings?.taxRegime || ""
      },
      environment,
      authorized,
      restaurant: restaurant || null,
      payments: payments.length ? payments : [{ paymentType: invoice.paymentType, amount: invoice.total }],
      lines: lines.map(line => ({ ...line, selectedModifiers: parseJsonArray(line.selectedModifiers) }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/restaurant/menu", requireRestaurantStore, async (req, res) => {
  const code = String(req.body.code || "").trim().slice(0, 80);
  const name = String(req.body.name || "").trim().slice(0, 150);
  const menuCategory = String(req.body.menuCategory || "General").trim().slice(0, 60) || "General";
  const available = req.user.role === "Admin" && req.body.available === false ? 0 : 1;
  const modifierGroups = req.user.role === "Admin" ? normalizeModifierGroups(req.body.modifierGroups) : [];
  const price = Number(req.body.price);
  const quantity = Number(req.body.quantity);
  if (!code || !name) return res.status(400).json({ error: "Completa el código y el nombre del producto." });
  if (req.body.price === "" || req.body.quantity === "" || !Number.isFinite(price) || price < 0 || !Number.isInteger(quantity) || quantity < 0) {
    return res.status(400).json({ error: "Ingresa un precio y una cantidad válidos." });
  }
  try {
    const duplicate = await dbGet("SELECT id FROM products WHERE company = ? AND code = ?", [req.user.company, code]);
    if (duplicate) return res.status(409).json({ error: "Ya existe un producto con este código." });
    const result = await dbRun(
      "INSERT INTO products (code, name, quantity, price, menuCategory, available, modifierGroups, company) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
      [code, name, quantity, price, menuCategory, available, JSON.stringify(modifierGroups), req.user.company]
    );
    res.json({ id: result.lastID, created: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/restaurant/menu/:id", requireRestaurantStore, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Producto inválido." });
  const categoryOnly = req.user.role === "Admin" && req.body.code === undefined && req.body.name === undefined;
  try {
    const existing = await dbGet("SELECT id FROM products WHERE id = ? AND company = ?", [id, req.user.company]);
    if (!existing) return res.status(404).json({ error: "Producto no encontrado." });

    if (categoryOnly) {
      const category = String(req.body.menuCategory || "General").trim().slice(0, 60) || "General";
      await dbRun("UPDATE products SET menuCategory = ? WHERE id = ? AND company = ?", [category, id, req.user.company]);
      return res.json({ updated: true, menuCategory: category });
    }

    const code = String(req.body.code || "").trim().slice(0, 80);
    const name = String(req.body.name || "").trim().slice(0, 150);
    if (!code || !name) return res.status(400).json({ error: "Completa el código y el nombre del producto." });
    const duplicate = await dbGet("SELECT id FROM products WHERE company = ? AND code = ? AND id <> ?", [req.user.company, code, id]);
    if (duplicate) return res.status(409).json({ error: "Ya existe otro producto con este código." });

    if (req.user.role !== "Admin") {
      await dbRun("UPDATE products SET code = ?, name = ? WHERE id = ? AND company = ?", [code, name, id, req.user.company]);
      return res.json({ updated: true });
    }

    const menuCategory = String(req.body.menuCategory || "General").trim().slice(0, 60) || "General";
    const available = req.body.available === false ? 0 : 1;
    const modifierGroups = normalizeModifierGroups(req.body.modifierGroups);
    const price = Number(req.body.price);
    const quantity = Number(req.body.quantity);
    if (req.body.price === "" || req.body.quantity === "" || !Number.isFinite(price) || price < 0 || !Number.isInteger(quantity) || quantity < 0) {
      return res.status(400).json({ error: "Ingresa un precio y una cantidad válidos." });
    }
    await dbRun(
      "UPDATE products SET code = ?, name = ?, quantity = ?, price = ?, menuCategory = ?, available = ?, modifierGroups = ? WHERE id = ? AND company = ?",
      [code, name, quantity, price, menuCategory, available, JSON.stringify(modifierGroups), id, req.user.company]
    );
    res.json({ updated: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/restaurant/menu/:id", requireRestaurantAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Producto inválido." });
  try {
    const result = await dbRun("DELETE FROM products WHERE id = ? AND company = ?", [id, req.user.company]);
    if (!result.changes) return res.status(404).json({ error: "Producto no encontrado." });
    res.json({ deleted: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/restaurant/menu/:id/availability", requireRestaurantAdmin, async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Producto inválido." });
  try {
    const available = req.body.available === false ? 0 : 1;
    const result = await dbRun(
      "UPDATE products SET available = ? WHERE id = ? AND company = ?",
      [available, id, req.user.company]
    );
    if (!result.changes) return res.status(404).json({ error: "Producto no encontrado." });
    res.json({ updated: true, available });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/restaurant/menu/import", requireRestaurantAdmin, async (req, res) => {
  const items = Array.isArray(req.body.items) ? req.body.items : [];
  if (!items.length) return res.status(400).json({ error: "El archivo no contiene productos." });
  if (items.length > 2000) return res.status(400).json({ error: "Puedes importar hasta 2.000 productos a la vez." });
  try {
    const summary = await dataStore.transaction(async () => {
      let inserted = 0;
      let updated = 0;
      for (const raw of items) {
        const code = String(raw.code || "").trim().slice(0, 80);
        const name = String(raw.name || "").trim().slice(0, 150);
        const menuCategory = String(raw.menuCategory || "General").trim().slice(0, 60) || "General";
        const available = raw.available === false || raw.available === 0 ? 0 : 1;
        const modifierGroups = normalizeModifierGroups(raw.modifierGroups);
        const price = Number(raw.price);
        const quantity = Number(raw.quantity ?? 0);
        if (!code || !name || !Number.isFinite(price) || price < 0 || !Number.isInteger(quantity) || quantity < 0) {
          throw Object.assign(new Error(`Revisa código, nombre, cantidad y precio de ${code || "una fila"}.`), { status: 400 });
        }
        const existing = await dbGet("SELECT id FROM products WHERE company = ? AND code = ?", [req.user.company, code]);
        if (existing) {
          await dbRun("UPDATE products SET name = ?, quantity = ?, price = ?, menuCategory = ?, available = ?, modifierGroups = ? WHERE id = ? AND company = ?", [name, quantity, price, menuCategory, available, JSON.stringify(modifierGroups), existing.id, req.user.company]);
          updated += 1;
        } else {
          await dbRun("INSERT INTO products (code, name, quantity, price, menuCategory, available, modifierGroups, company) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", [code, name, quantity, price, menuCategory, available, JSON.stringify(modifierGroups), req.user.company]);
          inserted += 1;
        }
      }
      return { inserted, updated };
    });
    res.json(summary);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
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

// ---------- INICIO / RESUMEN DIARIO ----------

function etDateWithOffset(days = 0) {
  return new Date(Date.now() + days * 86400000).toLocaleDateString("sv-SE", { timeZone: "America/New_York" });
}

function summarizeDailySales(rows, paymentsByInvoice = new Map()) {
  const activeUnits = sale => Math.max(0, Number(sale.quantity || 0) - Number(sale.returnedQuantity || 0));
  const activeTotal = sale => Math.max(0, Number(sale.total || 0) - Number(sale.returnedAmount || 0));
  const activeRows = rows.filter(sale => activeUnits(sale) > 0);
  const transactionIds = new Set(activeRows.map(sale => sale.invoiceId ? `invoice-${sale.invoiceId}` : `sale-${sale.id}`));
  const payments = { Efectivo: 0, Tarjeta: 0, Transferencia: 0, Otros: 0 };
  let total = 0;
  let units = 0;
  let discount = 0;
  let complimentary = 0;
  for (const sale of rows) {
    const lineUnits = activeUnits(sale);
    const lineTotal = activeTotal(sale);
    const ratio = Number(sale.quantity || 0) ? lineUnits / Number(sale.quantity) : 0;
    total = money(total + lineTotal);
    units += lineUnits;
    discount = money(discount + Number(sale.discountAmount || 0) * ratio);
    if (Number(sale.discountPercent || 0) === 100) complimentary += lineUnits;
    if (!lineUnits) continue;
    const breakdown = paymentsByInvoice.get(String(sale.invoiceId)) || [];
    const breakdownTotal = breakdown.reduce((sum, item) => sum + Number(item.amount || 0), 0);
    if (breakdown.length > 1 && breakdownTotal > 0) {
      for (const item of breakdown) {
        const method = PAYMENT_TYPES.includes(item.paymentType) ? item.paymentType : "Otros";
        payments[method] = money(payments[method] + lineTotal * Number(item.amount) / breakdownTotal);
      }
    } else {
      const paymentType = PAYMENT_TYPES.includes(sale.paymentType) ? sale.paymentType : "Otros";
      payments[paymentType] = money(payments[paymentType] + lineTotal);
    }
  }
  const transactions = transactionIds.size;
  return { total, transactions, average: money(transactions ? total / transactions : 0), units, discount, complimentary, payments };
}

app.get("/dashboard/summary", requireCompanyUser, async (req, res) => {
  try {
    const today = etDateWithOffset(0);
    const yesterday = etDateWithOffset(-1);
    const thresholdInput = Number(req.query.threshold);
    const threshold = Number.isFinite(thresholdInput) && thresholdInput >= 0 ? Math.min(999999, thresholdInput) : 5;
    const [sales, paymentRows] = await Promise.all([dataStore.all(
      `SELECT s.*, COALESCE(a.returnedQuantity, 0) AS returnedQuantity,
              COALESCE(a.returnedAmount, 0) AS returnedAmount
       FROM sales s
       LEFT JOIN (
         SELECT saleId, SUM(quantity) AS returnedQuantity, SUM(amount) AS returnedAmount
         FROM sale_adjustments GROUP BY saleId
       ) a ON a.saleId = s.id
       WHERE s.company = ? AND s.date >= ? AND s.date <= ?
       ORDER BY s.date DESC, s.id DESC`,
      [req.user.company, `${yesterday}T00:00:00`, `${today}T23:59:59`]
    ), dataStore.all(
      `SELECT ip.invoiceId, ip.paymentType, ip.amount
       FROM invoice_payments ip
       JOIN invoices i ON i.id = ip.invoiceId AND i.company = ip.company
       WHERE ip.company = ? AND i.date >= ? AND i.date <= ?`,
      [req.user.company, `${yesterday}T00:00:00`, `${today}T23:59:59`]
    )]);
    const paymentsByInvoice = new Map();
    paymentRows.forEach(payment => {
      const key = String(payment.invoiceId);
      if (!paymentsByInvoice.has(key)) paymentsByInvoice.set(key, []);
      paymentsByInvoice.get(key).push(payment);
    });
    const todaySummary = summarizeDailySales(sales.filter(sale => String(sale.date || "").slice(0, 10) === today), paymentsByInvoice);
    const yesterdaySummary = summarizeDailySales(sales.filter(sale => String(sale.date || "").slice(0, 10) === yesterday), paymentsByInvoice);
    const difference = money(todaySummary.total - yesterdaySummary.total);
    const percentage = yesterdaySummary.total > 0 ? Math.round((difference / yesterdaySummary.total) * 1000) / 10 : null;
    const lowStock = await dataStore.all(
      `SELECT id, code, name, quantity FROM products
       WHERE company = ? AND quantity <= ? ORDER BY quantity ASC, name ASC LIMIT 8`,
      [req.user.company, threshold]
    );
    const lowStockCount = await dbGet("SELECT COUNT(*) AS total FROM products WHERE company = ? AND quantity <= ?", [req.user.company, threshold]);
    const register = await dbGet("SELECT id, openedAt, openedByName FROM cash_register_sessions WHERE company = ? AND status = 'OPEN' ORDER BY id DESC LIMIT 1", [req.user.company]);
    const license = await dbGet("SELECT businessType FROM store_licenses WHERE company = ?", [req.user.company]);
    const businessType = normalizeBusinessType(license?.businessType);
    let restaurant = null;
    if (businessType === "RESTAURANT") {
      const openTables = await dbGet("SELECT COUNT(*) AS total FROM restaurant_table_sessions WHERE company = ? AND closedAt IS NULL", [req.user.company]);
      const activeOrders = await dbGet(
        `SELECT COUNT(*) AS total FROM restaurant_orders
         WHERE company = ? AND status = 'OPEN' AND COALESCE(kitchenStatus, 'NEW') <> 'READY'`,
        [req.user.company]
      );
      const readyOrders = await dataStore.all(
        `SELECT kitchenReceivedAt, kitchenStartedAt, kitchenReadyAt FROM restaurant_orders
         WHERE company = ? AND kitchenReadyAt >= ? AND kitchenReadyAt <= ?`,
        [req.user.company, `${today}T00:00:00`, `${today}T23:59:59`]
      );
      const preparationTimes = readyOrders.map(order => {
        const start = new Date(order.kitchenStartedAt || order.kitchenReceivedAt).getTime();
        const end = new Date(order.kitchenReadyAt).getTime();
        return Number.isFinite(start) && Number.isFinite(end) ? Math.max(0, (end - start) / 60000) : 0;
      });
      restaurant = {
        openTables: Number(openTables?.total || 0),
        activeOrders: Number(activeOrders?.total || 0),
        averagePreparationMinutes: preparationTimes.length
          ? Math.round((preparationTimes.reduce((sum, value) => sum + value, 0) / preparationTimes.length) * 10) / 10
          : 0
      };
    }
    res.json({
      date: today,
      today: todaySummary,
      yesterday: yesterdaySummary,
      comparison: { difference, percentage },
      threshold,
      lowStockCount: Number(lowStockCount?.total || 0),
      lowStock,
      cashRegister: register ? { open: true, ...register } : { open: false },
      restaurant
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- CAJA ----------

async function cashRegisterSnapshot(session) {
  const payments = await dataStore.all(
    `SELECT invoiceId, paymentType, total FROM (
       SELECT i.id AS invoiceId, ip.paymentType, ip.amount AS total
       FROM invoice_payments ip
       JOIN invoices i ON i.id = ip.invoiceId
       WHERE i.cashRegisterSessionId = ?
       UNION ALL
       SELECT i.id AS invoiceId, i.paymentType, i.total
       FROM invoices i
       WHERE i.cashRegisterSessionId = ?
         AND NOT EXISTS (SELECT 1 FROM invoice_payments ip WHERE ip.invoiceId = i.id)
     ) payment_rows`,
    [session.id, session.id]
  );
  const movements = await dataStore.all(
    `SELECT * FROM cash_register_movements
     WHERE sessionId = ? AND company = ? ORDER BY createdAt DESC, id DESC`,
    [session.id, session.company]
  );
  const adjustments = await dataStore.all(
    `SELECT invoiceId, paymentType, amount AS total
     FROM sale_adjustments
     WHERE cashRegisterSessionId = ? AND company = ?`,
    [session.id, session.company]
  );
  const totals = { cash: 0, card: 0, transfer: 0, other: 0 };
  const addPaymentAmount = (paymentType, amount) => {
    if (paymentType === "Efectivo") totals.cash += amount;
    else if (paymentType === "Tarjeta") totals.card += amount;
    else if (paymentType === "Transferencia") totals.transfer += amount;
    else totals.other += amount;
  };
  const invoicePayments = new Map();
  for (const payment of payments) {
    const amount = money(payment.total || 0);
    addPaymentAmount(payment.paymentType, amount);
    const key = String(payment.invoiceId);
    if (!invoicePayments.has(key)) invoicePayments.set(key, []);
    invoicePayments.get(key).push({ paymentType: payment.paymentType, amount });
  }
  for (const adjustment of adjustments) {
    const amount = money(adjustment.total || 0);
    const breakdown = adjustment.paymentType === "Mixto" ? invoicePayments.get(String(adjustment.invoiceId)) || [] : [];
    const breakdownTotal = breakdown.reduce((sum, item) => sum + item.amount, 0);
    if (breakdown.length > 1 && breakdownTotal > 0) {
      breakdown.forEach(item => addPaymentAmount(item.paymentType, -money(amount * item.amount / breakdownTotal)));
    } else {
      addPaymentAmount(adjustment.paymentType, -amount);
    }
  }
  const cashIn = money(movements.filter(item => item.type === "ENTRADA").reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const cashOut = money(movements.filter(item => item.type === "RETIRO").reduce((sum, item) => sum + Number(item.amount || 0), 0));
  const expectedAmount = money(Number(session.openingAmount || 0) + totals.cash + cashIn - cashOut);
  return {
    session,
    movements,
    totals: {
      cashSales: money(totals.cash),
      cardSales: money(totals.card),
      transferSales: money(totals.transfer),
      otherSales: money(totals.other),
      totalSales: money(totals.cash + totals.card + totals.transfer + totals.other),
      cashIn,
      cashOut,
      expectedAmount
    }
  };
}

app.get("/cash-register/current", requireCompanyUser, async (req, res) => {
  try {
    const session = await dbGet(
      "SELECT * FROM cash_register_sessions WHERE company = ? AND status = 'OPEN' ORDER BY id DESC LIMIT 1",
      [req.user.company]
    );
    if (!session) return res.json({ open: false });
    res.json({ open: true, ...(await cashRegisterSnapshot(session)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/cash-register/open", requireCompanyUser, async (req, res) => {
  const openingAmount = Number(req.body.openingAmount);
  if (!Number.isFinite(openingAmount) || openingAmount < 0) {
    return res.status(400).json({ error: "Ingresa un fondo inicial válido." });
  }
  try {
    const existing = await dbGet("SELECT id FROM cash_register_sessions WHERE company = ? AND status = 'OPEN'", [req.user.company]);
    if (existing) return res.status(409).json({ error: "Esta tienda ya tiene una caja abierta." });
    const now = getETLocalISO();
    const openedByName = req.user.fullName || req.user.username;
    const created = await dbRun(
      `INSERT INTO cash_register_sessions
       (company, openedByUserId, openedByName, openedAt, openingAmount, status)
       VALUES (?, ?, ?, ?, ?, 'OPEN')`,
      [req.user.company, req.user.id, openedByName, now, money(openingAmount)]
    );
    const session = await dbGet("SELECT * FROM cash_register_sessions WHERE id = ?", [created.lastID]);
    res.json({ open: true, ...(await cashRegisterSnapshot(session)) });
  } catch (err) {
    const conflict = /unique|constraint/i.test(String(err.message));
    res.status(conflict ? 409 : 500).json({ error: conflict ? "Esta tienda ya tiene una caja abierta." : err.message });
  }
});

app.post("/cash-register/movements", requireCompanyUser, async (req, res) => {
  const type = req.body.type === "RETIRO" ? "RETIRO" : req.body.type === "ENTRADA" ? "ENTRADA" : "";
  const amount = Number(req.body.amount);
  const reason = String(req.body.reason || "").trim().slice(0, 150);
  if (!type || !Number.isFinite(amount) || amount <= 0 || !reason) {
    return res.status(400).json({ error: "Selecciona el tipo, ingresa un valor mayor a cero y escribe el motivo." });
  }
  try {
    const session = await dbGet("SELECT * FROM cash_register_sessions WHERE company = ? AND status = 'OPEN'", [req.user.company]);
    if (!session) return res.status(409).json({ error: "No hay una caja abierta." });
    await dbRun(
      `INSERT INTO cash_register_movements
       (company, sessionId, type, amount, reason, recordedByUserId, recordedByName, createdAt)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.company, session.id, type, money(amount), reason, req.user.id, req.user.fullName || req.user.username, getETLocalISO()]
    );
    res.json({ open: true, ...(await cashRegisterSnapshot(session)) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.post("/cash-register/close", requireCompanyUser, async (req, res) => {
  const countedAmount = Number(req.body.countedAmount);
  if (!Number.isFinite(countedAmount) || countedAmount < 0) {
    return res.status(400).json({ error: "Ingresa el efectivo contado en caja." });
  }
  try {
    const result = await dataStore.transaction(async () => {
      const session = await dbGet("SELECT * FROM cash_register_sessions WHERE company = ? AND status = 'OPEN'", [req.user.company]);
      if (!session) throw Object.assign(new Error("No hay una caja abierta."), { status: 409 });
      const snapshot = await cashRegisterSnapshot(session);
      const closedAt = getETLocalISO();
      const difference = money(countedAmount - snapshot.totals.expectedAmount);
      const updated = await dbRun(
        `UPDATE cash_register_sessions SET status = 'CLOSED', closedByUserId = ?, closedByName = ?, closedAt = ?,
         cashSales = ?, cardSales = ?, transferSales = ?, otherSales = ?, cashIn = ?, cashOut = ?,
         expectedAmount = ?, countedAmount = ?, difference = ?
         WHERE id = ? AND company = ? AND status = 'OPEN'`,
        [req.user.id, req.user.fullName || req.user.username, closedAt,
          snapshot.totals.cashSales, snapshot.totals.cardSales, snapshot.totals.transferSales, snapshot.totals.otherSales,
          snapshot.totals.cashIn, snapshot.totals.cashOut, snapshot.totals.expectedAmount, money(countedAmount), difference,
          session.id, req.user.company]
      );
      if (!updated.changes) throw Object.assign(new Error("La caja ya fue cerrada."), { status: 409 });
      return { ...snapshot, difference, countedAmount: money(countedAmount), closedAt };
    });
    res.json({ closed: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get("/cash-register/history", requireUserAdmin, async (req, res) => {
  try {
    const rows = await dataStore.all(
      `SELECT * FROM cash_register_sessions
       WHERE company = ? AND status = 'CLOSED' ORDER BY closedAt DESC, id DESC LIMIT 50`,
      [req.user.company]
    );
    res.json(rows);
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

app.get("/sales/:company", requireCompanyUser, async (req, res) => {
  try {
    const [rows, paymentRows] = await Promise.all([dataStore.all(
      `SELECT s.*, i.invoiceNumber, i.saleStatus AS invoiceSaleStatus,
              COALESCE(a.returnedQuantity, 0) AS returnedQuantity,
              COALESCE(a.returnedAmount, 0) AS returnedAmount,
              a.adjustmentReason, a.adjustmentByName
       FROM sales s
       LEFT JOIN invoices i ON i.id = s.invoiceId AND i.company = s.company
       LEFT JOIN (
         SELECT saleId, SUM(quantity) AS returnedQuantity, SUM(amount) AS returnedAmount,
                MAX(reason) AS adjustmentReason, MAX(performedByName) AS adjustmentByName,
                MAX(CASE WHEN type = 'ANULACION' THEN 1 ELSE 0 END) AS hasCancellation
         FROM sale_adjustments GROUP BY saleId
       ) a ON a.saleId = s.id
       WHERE s.company = ? ORDER BY s.date DESC, s.id DESC`,
      [req.params.company]
    ), dataStore.all(
      `SELECT ip.invoiceId, ip.paymentType, ip.amount
       FROM invoice_payments ip
       JOIN invoices i ON i.id = ip.invoiceId AND i.company = ip.company
       WHERE ip.company = ?`,
      [req.params.company]
    )]);
    const paymentsByInvoice = new Map();
    paymentRows.forEach(payment => {
      const key = String(payment.invoiceId);
      if (!paymentsByInvoice.has(key)) paymentsByInvoice.set(key, []);
      paymentsByInvoice.get(key).push({ paymentType: payment.paymentType, amount: Number(payment.amount) });
    });
    res.json(rows.map(row => ({
      ...row,
      payments: paymentsByInvoice.get(String(row.invoiceId)) || [],
      saleStatus: row.invoiceSaleStatus === "ANULADA" || Number(row.hasCancellation || 0) === 1
        ? "ANULADA"
        : Number(row.returnedQuantity || 0) >= Number(row.quantity || 0) && Number(row.quantity || 0) > 0
          ? "DEVUELTA"
          : Number(row.returnedQuantity || 0) > 0 ? "DEVOLUCION_PARCIAL" : "COMPLETADA"
    })));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
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
  addColumnIfMissing("products", "menuCategory TEXT DEFAULT 'General'");
  addColumnIfMissing("products", "available INTEGER DEFAULT 1");
  addColumnIfMissing("products", "modifierGroups TEXT DEFAULT '[]'");
  addColumnIfMissing("sales", "invoiceId INTEGER");
  addColumnIfMissing("sales", "grossTotal REAL DEFAULT 0");
  addColumnIfMissing("sales", "discountPercent REAL DEFAULT 0");
  addColumnIfMissing("sales", "discountAmount REAL DEFAULT 0");
  addColumnIfMissing("sales", "discountReason TEXT DEFAULT ''");
  addColumnIfMissing("sales", "selectedModifiers TEXT DEFAULT '[]'");
  addColumnIfMissing("sales", "grantedByUserId INTEGER");
  addColumnIfMissing("sales", "grantedByName TEXT DEFAULT ''");
  addColumnIfMissing("invoices", "discountAmount REAL DEFAULT 0");
  addColumnIfMissing("invoices", "cashReceived REAL DEFAULT 0");
  addColumnIfMissing("invoices", "restaurantOrderId INTEGER");
  addColumnIfMissing("invoices", "changeDue REAL DEFAULT 0");
  addColumnIfMissing("invoices", "issuedByUserId INTEGER");
  addColumnIfMissing("invoices", "issuedByName TEXT DEFAULT ''");
  addColumnIfMissing("invoices", "accessKey TEXT");
  addColumnIfMissing("invoices", "authorizationNumber TEXT");
  addColumnIfMissing("invoices", "authorizedAt TEXT");
  addColumnIfMissing("invoices", "saleStatus TEXT DEFAULT 'COMPLETADA'");
  addColumnIfMissing("invoices", "cancellationReason TEXT");
  addColumnIfMissing("invoices", "canceledAt TEXT");
  addColumnIfMissing("invoices", "canceledByUserId INTEGER");
  addColumnIfMissing("invoices", "canceledByName TEXT");
  addColumnIfMissing("restaurant_order_items", "discountPercent REAL DEFAULT 0");
  addColumnIfMissing("restaurant_order_items", "discountReason TEXT DEFAULT ''");
  addColumnIfMissing("restaurant_order_items", "selectedModifiers TEXT DEFAULT '[]'");
  addColumnIfMissing("restaurant_table_sessions", "joinedToSessionId INTEGER");
  addColumnIfMissing("restaurant_orders", "kitchenStatus TEXT DEFAULT 'NEW'");
  addColumnIfMissing("restaurant_orders", "kitchenReceivedAt TEXT");
  addColumnIfMissing("restaurant_orders", "kitchenStartedAt TEXT");
  addColumnIfMissing("restaurant_orders", "kitchenReadyAt TEXT");
  addColumnIfMissing("sri_settings", "certificateValidated INTEGER DEFAULT 0");
  addColumnIfMissing("sri_settings", "certificateLocalValidated INTEGER DEFAULT 0");
  addColumnIfMissing("store_licenses", "businessType TEXT DEFAULT 'SHOP'");
}

async function updateInvoiceReturnStatus(invoiceId, company) {
  if (!invoiceId) return;
  const summary = await dbGet(
    `SELECT COALESCE(SUM(s.quantity), 0) AS soldQuantity,
            COALESCE(SUM(a.returnedQuantity), 0) AS returnedQuantity
     FROM sales s
     LEFT JOIN (
       SELECT saleId, SUM(quantity) AS returnedQuantity
       FROM sale_adjustments GROUP BY saleId
     ) a ON a.saleId = s.id
     WHERE s.invoiceId = ? AND s.company = ?`,
    [invoiceId, company]
  );
  const status = Number(summary?.returnedQuantity || 0) >= Number(summary?.soldQuantity || 0)
    ? "DEVUELTA"
    : "DEVOLUCION_PARCIAL";
  await dbRun("UPDATE invoices SET saleStatus = ? WHERE id = ? AND company = ? AND COALESCE(saleStatus, 'COMPLETADA') <> 'ANULADA'", [status, invoiceId, company]);
}

app.post("/sales/:company/:id/return", requireUserAdmin, async (req, res) => {
  const { company, id } = req.params;
  const quantity = Number(req.body.quantity);
  const reason = String(req.body.reason || "").trim().slice(0, 180);
  if (!Number.isInteger(quantity) || quantity <= 0) return res.status(400).json({ error: "Ingresa una cantidad válida para devolver." });
  if (reason.length < 3) return res.status(400).json({ error: "Escribe el motivo de la devolución." });
  try {
    const result = await dataStore.transaction(async () => {
      const register = await dbGet("SELECT id FROM cash_register_sessions WHERE company = ? AND status = 'OPEN'", [company]);
      if (!register) throw Object.assign(new Error("Abre la caja antes de registrar una devolución."), { status: 409 });
      const sale = await dbGet(
        `SELECT s.*, i.saleStatus AS invoiceSaleStatus, COALESCE(i.paymentType, s.paymentType) AS originalPaymentType
         FROM sales s LEFT JOIN invoices i ON i.id = s.invoiceId AND i.company = s.company
         WHERE s.id = ? AND s.company = ?`,
        [id, company]
      );
      if (!sale) throw Object.assign(new Error("Venta no encontrada."), { status: 404 });
      if (sale.invoiceSaleStatus === "ANULADA") throw Object.assign(new Error("Esta venta ya fue anulada."), { status: 409 });
      const previous = await dbGet("SELECT COALESCE(SUM(quantity), 0) AS quantity, COALESCE(SUM(amount), 0) AS amount FROM sale_adjustments WHERE saleId = ? AND company = ?", [sale.id, company]);
      const remaining = Number(sale.quantity || 0) - Number(previous?.quantity || 0);
      if (quantity > remaining) throw Object.assign(new Error(`Solo quedan ${remaining} unidades disponibles para devolver.`), { status: 409 });
      const returnedAfter = Number(previous?.quantity || 0) + quantity;
      const amount = money(
        money(Number(sale.total || 0) * returnedAfter / Math.max(1, Number(sale.quantity || 0))) - Number(previous?.amount || 0)
      );
      await dbRun("UPDATE products SET quantity = quantity + ? WHERE id = ? AND company = ?", [quantity, sale.productId, company]);
      await dbRun(
        `INSERT INTO sale_adjustments
         (company, invoiceId, saleId, type, quantity, amount, reason, paymentType,
          cashRegisterSessionId, performedByUserId, performedByName, createdAt)
         VALUES (?, ?, ?, 'DEVOLUCION', ?, ?, ?, ?, ?, ?, ?, ?)`,
        [company, sale.invoiceId || null, sale.id, quantity, amount, reason,
          sale.originalPaymentType || "Efectivo", register.id, req.user.id,
          req.user.fullName || req.user.username, getETLocalISO()]
      );
      await updateInvoiceReturnStatus(sale.invoiceId, company);
      return { quantity, amount };
    });
    res.json({ returned: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/sales/:company/:id/cancel", requireUserAdmin, async (req, res) => {
  const { company, id } = req.params;
  const reason = String(req.body.reason || "").trim().slice(0, 180);
  if (reason.length < 3) return res.status(400).json({ error: "Escribe el motivo de la anulación." });
  try {
    const result = await dataStore.transaction(async () => {
      const register = await dbGet("SELECT id FROM cash_register_sessions WHERE company = ? AND status = 'OPEN'", [company]);
      if (!register) throw Object.assign(new Error("Abre la caja antes de anular una venta."), { status: 409 });
      const selected = await dbGet(
        `SELECT s.*, i.saleStatus AS invoiceSaleStatus, COALESCE(i.paymentType, s.paymentType) AS originalPaymentType
         FROM sales s LEFT JOIN invoices i ON i.id = s.invoiceId AND i.company = s.company
         WHERE s.id = ? AND s.company = ?`,
        [id, company]
      );
      if (!selected) throw Object.assign(new Error("Venta no encontrada."), { status: 404 });
      if (selected.invoiceSaleStatus === "ANULADA") throw Object.assign(new Error("Esta venta ya fue anulada."), { status: 409 });
      const lines = selected.invoiceId
        ? await dataStore.all("SELECT * FROM sales WHERE invoiceId = ? AND company = ?", [selected.invoiceId, company])
        : [selected];
      let quantity = 0;
      let amount = 0;
      for (const line of lines) {
        const previous = await dbGet("SELECT COALESCE(SUM(quantity), 0) AS quantity, COALESCE(SUM(amount), 0) AS amount FROM sale_adjustments WHERE saleId = ? AND company = ?", [line.id, company]);
        const remaining = Math.max(0, Number(line.quantity || 0) - Number(previous?.quantity || 0));
        if (!remaining) continue;
        const lineAmount = money(Number(line.total || 0) - Number(previous?.amount || 0));
        await dbRun("UPDATE products SET quantity = quantity + ? WHERE id = ? AND company = ?", [remaining, line.productId, company]);
        await dbRun(
          `INSERT INTO sale_adjustments
           (company, invoiceId, saleId, type, quantity, amount, reason, paymentType,
            cashRegisterSessionId, performedByUserId, performedByName, createdAt)
           VALUES (?, ?, ?, 'ANULACION', ?, ?, ?, ?, ?, ?, ?, ?)`,
          [company, line.invoiceId || null, line.id, remaining, lineAmount, reason,
            selected.originalPaymentType || line.paymentType || "Efectivo", register.id,
            req.user.id, req.user.fullName || req.user.username, getETLocalISO()]
        );
        quantity += remaining;
        amount = money(amount + lineAmount);
      }
      if (!quantity) throw Object.assign(new Error("Esta venta ya fue devuelta completamente."), { status: 409 });
      if (selected.invoiceId) {
        await dbRun(
          `UPDATE invoices SET saleStatus = 'ANULADA', cancellationReason = ?, canceledAt = ?,
           canceledByUserId = ?, canceledByName = ? WHERE id = ? AND company = ?`,
          [reason, getETLocalISO(), req.user.id, req.user.fullName || req.user.username, selected.invoiceId, company]
        );
      }
      return { quantity, amount, invoiceId: selected.invoiceId || null };
    });
    res.json({ canceled: true, ...result });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.delete("/sales/:company/:id", requireUserAdmin, (_req, res) => {
  res.status(410).json({ error: "Las ventas ya no se eliminan. Usa Devolver producto o Anular venta para conservar el historial." });
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

async function ensureRestaurantOrder(session) {
  let order = await dbGet(
    "SELECT * FROM restaurant_orders WHERE tableSessionId = ? AND company = ?",
    [session.id, session.company]
  );
  if (order) return order;
  const now = getETLocalISO();
  await dbRun(
    `INSERT INTO restaurant_orders
     (company, tableSessionId, tableId, status, createdAt, updatedAt)
     VALUES (?, ?, ?, 'OPEN', ?, ?)
     ON CONFLICT(tableSessionId) DO NOTHING`,
    [session.company, session.id, session.tableId, now, now]
  );
  order = await dbGet(
    "SELECT * FROM restaurant_orders WHERE tableSessionId = ? AND company = ?",
    [session.id, session.company]
  );
  return order;
}

function decryptCertificateValue(value) {
  const key = certificateEncryptionKey();
  if (!key) throw new Error("SRI_CERT_ENCRYPTION_KEY no está configurada en el servidor.");
  const parts = String(value || "").split(":");
  if (parts.length !== 4 || parts[0] !== "v1") throw new Error("Formato de certificado cifrado no reconocido.");
  const iv = Buffer.from(parts[1], "base64");
  const tag = Buffer.from(parts[2], "base64");
  const encrypted = Buffer.from(parts[3], "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(encrypted), decipher.final()]);
}

function inspectPkcs12(certificate, password) {
  try {
    const der = forge.util.createBuffer(certificate.toString("binary"), "raw");
    const asn1 = forge.asn1.fromDer(der, false);
    const p12 = forge.pkcs12.pkcs12FromAsn1(asn1, false, password);
    const certBags = p12.getBags({ bagType: forge.pki.oids.certBag })[forge.pki.oids.certBag] || [];
    const keyBags = [forge.pki.oids.pkcs8ShroudedKeyBag, forge.pki.oids.keyBag]
      .flatMap(type => p12.getBags({ bagType: type })[type] || []);
    const cert = certBags.find(bag => bag.cert)?.cert;
    if (!cert || !keyBags.some(bag => bag.key)) throw new Error("El archivo no contiene certificado y clave privada.");
    const now = new Date();
    if (cert.validity?.notAfter && cert.validity.notAfter < now) throw new Error("El certificado está vencido.");
    if (cert.validity?.notBefore && cert.validity.notBefore > now) throw new Error("El certificado todavía no es válido.");
    return { subject: cert.subject?.attributes || [], issuer: cert.issuer?.attributes || [], expiresAt: cert.validity?.notAfter?.toISOString() || null };
  } catch (error) {
    const message = String(error?.message || "");
    if (/Invalid password|MAC could not be verified|PKCS12/i.test(message)) {
      throw new Error("La contraseña no corresponde al certificado .p12/.pfx o el archivo está dañado.");
    }
    throw error;
  }
}

async function primaryRestaurantSession(session, company) {
  if (!session?.joinedToSessionId) return session;
  return dbGet(
    "SELECT * FROM restaurant_table_sessions WHERE id = ? AND company = ? AND closedAt IS NULL",
    [session.joinedToSessionId, company]
  );
}

async function restaurantSessionContext(session) {
  const rows = await dataStore.all(
    `SELECT s.id, s.guests, s.serverName, t.name AS tableName
     FROM restaurant_table_sessions s
     JOIN restaurant_tables t ON t.id = s.tableId
     WHERE s.company = ? AND s.closedAt IS NULL AND (s.id = ? OR s.joinedToSessionId = ?)
     ORDER BY CASE WHEN s.id = ? THEN 0 ELSE 1 END, t.name`,
    [session.company, session.id, session.id, session.id]
  );
  return {
    tableName: rows.map(row => row.tableName).join(" + "),
    guests: rows.reduce((sum, row) => sum + Number(row.guests || 0), 0),
    serverName: session.serverName,
    joinedTableCount: Math.max(0, rows.length - 1)
  };
}

async function restaurantOrderResponse(order) {
  const items = await dataStore.all(
    `SELECT id, productId, code, name, quantity, price, discountPercent, discountReason, selectedModifiers, note
     FROM restaurant_order_items WHERE orderId = ? AND company = ? ORDER BY id`,
    [order.id, order.company]
  );
  return { ...order, items: items.map(item => ({ ...item, selectedModifiers: parseJsonArray(item.selectedModifiers) })) };
}

app.get("/restaurant/table-sessions/:sessionId/order", requireRestaurantStore, async (req, res) => {
  try {
    const sessionId = Number(req.params.sessionId);
    if (!Number.isInteger(sessionId) || sessionId < 1) return res.status(400).json({ error: "Atención inválida." });
    const requestedSession = await dbGet(
      `SELECT s.*, t.name AS tableName
       FROM restaurant_table_sessions s
       JOIN restaurant_tables t ON t.id = s.tableId
       WHERE s.id = ? AND s.company = ? AND s.closedAt IS NULL`,
      [sessionId, req.user.company]
    );
    if (!requestedSession) return res.status(404).json({ error: "La mesa ya no está ocupada." });
    const session = await primaryRestaurantSession(requestedSession, req.user.company);
    if (!session) return res.status(404).json({ error: "La cuenta principal ya no está disponible." });
    const order = await ensureRestaurantOrder(session);
    const context = await restaurantSessionContext(session);
    res.json({ ...(await restaurantOrderResponse(order)), ...context });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.put("/restaurant/table-sessions/:sessionId/order", requireRestaurantStore, async (req, res) => {
  const sessionId = Number(req.params.sessionId);
  const requestedItems = Array.isArray(req.body.items) ? req.body.items : [];
  if (!Number.isInteger(sessionId) || sessionId < 1) return res.status(400).json({ error: "Atención inválida." });
  if (requestedItems.length > 200) return res.status(400).json({ error: "El pedido tiene demasiados productos." });
  try {
    const requestedSession = await dbGet(
      "SELECT * FROM restaurant_table_sessions WHERE id = ? AND company = ? AND closedAt IS NULL",
      [sessionId, req.user.company]
    );
    if (!requestedSession) return res.status(404).json({ error: "La mesa ya no está ocupada." });
    const session = await primaryRestaurantSession(requestedSession, req.user.company);
    if (!session) return res.status(404).json({ error: "La cuenta principal ya no está disponible." });

    const cleanItems = [];
    for (const item of requestedItems) {
      const productId = Number(item.id || item.productId);
      const quantity = Number(item.quantity);
      if (!Number.isInteger(productId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 999) {
        return res.status(400).json({ error: "Revisa las cantidades del pedido." });
      }
      const product = await dbGet("SELECT * FROM products WHERE id = ? AND company = ?", [productId, req.user.company]);
      if (!product) return res.status(400).json({ error: "Uno de los productos ya no existe." });
      if (quantity > Number(product.quantity || 0)) return res.status(400).json({ error: `Inventario insuficiente para ${product.name}.` });
      const discountPercent = Number(item.discountPercent || 0);
      if (!Number.isFinite(discountPercent) || discountPercent < 0 || discountPercent > 100) {
        return res.status(400).json({ error: `El descuento de ${product.name} debe estar entre 0% y 100%.` });
      }
      const discountReason = String(item.discountReason || "").trim().slice(0, 80);
      if (discountPercent === 100 && !discountReason) {
        return res.status(400).json({ error: `Selecciona el motivo para entregar ${product.name} gratis.` });
      }
      let modifiers;
      try {
        modifiers = resolveSelectedModifiers(product, item.selectedModifiers);
      } catch (err) {
        return res.status(err.status || 400).json({ error: err.message });
      }
      cleanItems.push({
        product,
        quantity,
        discountPercent,
        discountReason,
        selectedModifiers: modifiers.selections,
        unitPrice: money(Number(product.price) + modifiers.extraPrice),
        note: String(item.note || "").trim().slice(0, 200)
      });
    }

    const order = await dataStore.transaction(async () => {
      const currentOrder = await ensureRestaurantOrder(session);
      if (currentOrder.status !== "OPEN") throw Object.assign(new Error("Este pedido ya fue cerrado."), { status: 409 });
      await dbRun("DELETE FROM restaurant_order_items WHERE orderId = ? AND company = ?", [currentOrder.id, req.user.company]);
      for (const item of cleanItems) {
        await dbRun(
          `INSERT INTO restaurant_order_items
           (company, orderId, productId, code, name, quantity, price, discountPercent, discountReason, selectedModifiers, note)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [req.user.company, currentOrder.id, item.product.id, item.product.code, item.product.name,
            item.quantity, item.unitPrice, item.discountPercent, item.discountReason, JSON.stringify(item.selectedModifiers), item.note]
        );
      }
      const now = getETLocalISO();
      if (cleanItems.length) {
        await dbRun(
          `UPDATE restaurant_orders
           SET kitchenStatus = 'NEW', kitchenReceivedAt = ?, kitchenStartedAt = NULL,
               kitchenReadyAt = NULL, updatedAt = ?
           WHERE id = ? AND company = ?`,
          [now, now, currentOrder.id, req.user.company]
        );
      } else {
        await dbRun(
          `UPDATE restaurant_orders
           SET kitchenStatus = 'NEW', kitchenReceivedAt = NULL, kitchenStartedAt = NULL,
               kitchenReadyAt = NULL, updatedAt = ?
           WHERE id = ? AND company = ?`,
          [now, currentOrder.id, req.user.company]
        );
      }
      return dbGet("SELECT * FROM restaurant_orders WHERE id = ?", [currentOrder.id]);
    });
    res.json(await restaurantOrderResponse(order));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

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
    const conditions = ["s.company = ?", "s.closedAt IS NOT NULL"];
    const params = [req.user.company];
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || ""))) {
      conditions.push("s.closedAt >= ?");
      params.push(`${req.query.from}T00:00:00`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || ""))) {
      conditions.push("s.closedAt <= ?");
      params.push(`${req.query.to}T23:59:59`);
    }
    const restaurantServerId = Number(req.query.restaurantServerId);
    if (Number.isInteger(restaurantServerId) && restaurantServerId > 0) {
      conditions.push("s.restaurantServerId = ?");
      params.push(restaurantServerId);
    }
    const rows = await dataStore.all(
      `SELECT s.id, s.tableId, t.name AS tableName, s.restaurantServerId, s.serverName,
              s.guests, s.openedAt, s.closedAt, s.durationMinutes
       FROM restaurant_table_sessions s
       LEFT JOIN restaurant_tables t ON t.id = s.tableId
       WHERE ${conditions.join(" AND ")}
       ORDER BY s.closedAt DESC, s.id DESC
       LIMIT 5000`,
      params
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.delete("/restaurant/table-sessions/:id", requireRestaurantAdmin, async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Atención inválida." });
    const result = await dbRun(
      "DELETE FROM restaurant_table_sessions WHERE id = ? AND company = ? AND closedAt IS NOT NULL",
      [id, req.user.company]
    );
    if (!result.changes) return res.status(404).json({ error: "Atención no encontrada." });
    res.json({ deleted: true });
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
              s.serverUserId, s.serverName, s.joinedToSessionId,
              pt.name AS joinedTableName, o.id AS orderId, o.kitchenStatus,
              COALESCE((SELECT SUM(oi.quantity) FROM restaurant_order_items oi WHERE oi.orderId = o.id), 0) AS orderItemCount
       FROM restaurant_tables t
       LEFT JOIN restaurant_table_sessions s
         ON s.tableId = t.id AND s.closedAt IS NULL
       LEFT JOIN restaurant_table_sessions ps ON ps.id = s.joinedToSessionId AND ps.closedAt IS NULL
       LEFT JOIN restaurant_tables pt ON pt.id = ps.tableId
       LEFT JOIN restaurant_orders o
         ON o.tableSessionId = COALESCE(s.joinedToSessionId, s.id) AND o.status = 'OPEN'
       WHERE t.company = ? ${includeInactive ? "" : "AND t.active = 1"}
       ORDER BY t.name, t.id`,
      [req.user.company]
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get("/restaurant/kitchen/orders", requireRestaurantStore, async (req, res) => {
  try {
    const rows = await dataStore.all(
      `SELECT o.id AS orderId, o.tableSessionId, o.tableId, o.kitchenStatus,
              o.kitchenReceivedAt, o.kitchenStartedAt, o.kitchenReadyAt,
              t.name AS tableName, s.guests, s.serverName,
              oi.id AS itemId, oi.productId, oi.code, oi.name, oi.quantity,
              oi.note, oi.discountPercent, oi.discountReason, oi.selectedModifiers
       FROM restaurant_orders o
       JOIN restaurant_table_sessions s ON s.id = o.tableSessionId AND s.closedAt IS NULL
       JOIN restaurant_tables t ON t.id = o.tableId
       JOIN restaurant_order_items oi ON oi.orderId = o.id
       WHERE o.company = ? AND o.status = 'OPEN' AND o.kitchenReceivedAt IS NOT NULL
       ORDER BY o.kitchenReceivedAt, o.id, oi.id`,
      [req.user.company]
    );
    const grouped = new Map();
    rows.forEach(row => {
      if (!grouped.has(row.orderId)) {
        grouped.set(row.orderId, {
          id: row.orderId,
          tableSessionId: row.tableSessionId,
          tableId: row.tableId,
          tableName: row.tableName,
          guests: row.guests,
          serverName: row.serverName,
          kitchenStatus: row.kitchenStatus || "NEW",
          kitchenReceivedAt: row.kitchenReceivedAt,
          kitchenStartedAt: row.kitchenStartedAt,
          kitchenReadyAt: row.kitchenReadyAt,
          items: []
        });
      }
      grouped.get(row.orderId).items.push({
        id: row.itemId,
        productId: row.productId,
        code: row.code,
        name: row.name,
        quantity: row.quantity,
        note: row.note || "",
        selectedModifiers: parseJsonArray(row.selectedModifiers),
        discountPercent: Number(row.discountPercent || 0),
        discountReason: row.discountReason || ""
      });
    });
    res.json(Array.from(grouped.values()));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.put("/restaurant/kitchen/orders/:id/status", requireRestaurantStore, async (req, res) => {
  try {
    const id = Number(req.params.id);
    const action = String(req.body.status || "").toUpperCase();
    if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Pedido inválido." });
    if (!['START', 'READY'].includes(action)) return res.status(400).json({ error: "Estado de cocina inválido." });
    const order = await dbGet(
      "SELECT * FROM restaurant_orders WHERE id = ? AND company = ? AND status = 'OPEN'",
      [id, req.user.company]
    );
    if (!order || !order.kitchenReceivedAt) return res.status(404).json({ error: "Pedido activo no encontrado en cocina." });
    const current = order.kitchenStatus || "NEW";
    const now = getETLocalISO();
    if (action === 'START') {
      if (current !== 'NEW') return res.status(409).json({ error: "Este pedido ya fue iniciado." });
      await dbRun(
        "UPDATE restaurant_orders SET kitchenStatus = 'COOKING', kitchenStartedAt = ?, kitchenReadyAt = NULL, updatedAt = ? WHERE id = ? AND company = ?",
        [now, now, id, req.user.company]
      );
    } else {
      if (current !== 'COOKING') return res.status(409).json({ error: "Primero debes iniciar la preparación." });
      await dbRun(
        "UPDATE restaurant_orders SET kitchenStatus = 'READY', kitchenReadyAt = ?, updatedAt = ? WHERE id = ? AND company = ?",
        [now, now, id, req.user.company]
      );
    }
    res.json(await dbGet("SELECT * FROM restaurant_orders WHERE id = ? AND company = ?", [id, req.user.company]));
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.get("/restaurant/kitchen/performance", requireRestaurantAdmin, async (req, res) => {
  try {
    const conditions = ["o.company = ?", "o.kitchenReadyAt IS NOT NULL"];
    const params = [req.user.company];
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || ""))) {
      conditions.push("o.kitchenReadyAt >= ?");
      params.push(`${req.query.from}T00:00:00`);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(req.query.to || ""))) {
      conditions.push("o.kitchenReadyAt <= ?");
      params.push(`${req.query.to}T23:59:59`);
    }
    const rows = await dataStore.all(
      `SELECT o.id AS orderId, o.status AS orderStatus, o.kitchenReceivedAt,
              o.kitchenStartedAt, o.kitchenReadyAt, t.name AS tableName,
              s.serverName, s.guests, oi.productId, oi.code, oi.name, oi.quantity
       FROM restaurant_orders o
       LEFT JOIN restaurant_table_sessions s ON s.id = o.tableSessionId
       LEFT JOIN restaurant_tables t ON t.id = o.tableId
       LEFT JOIN restaurant_order_items oi ON oi.orderId = o.id
       WHERE ${conditions.join(" AND ")}
       ORDER BY o.kitchenReadyAt DESC, o.id DESC, oi.id`,
      params
    );
    const minutesBetween = (start, end) => {
      const difference = new Date(end).getTime() - new Date(start).getTime();
      return Number.isFinite(difference) ? Math.max(0, Math.round(difference / 6000) / 10) : 0;
    };
    const grouped = new Map();
    rows.forEach(row => {
      if (!grouped.has(row.orderId)) {
        grouped.set(row.orderId, {
          id: row.orderId,
          tableName: row.tableName || `Mesa #${row.orderId}`,
          serverName: row.serverName || "Sin asignar",
          guests: Number(row.guests || 0),
          orderStatus: row.orderStatus,
          receivedAt: row.kitchenReceivedAt,
          startedAt: row.kitchenStartedAt,
          readyAt: row.kitchenReadyAt,
          waitingMinutes: minutesBetween(row.kitchenReceivedAt, row.kitchenStartedAt || row.kitchenReadyAt),
          preparationMinutes: minutesBetween(row.kitchenStartedAt || row.kitchenReceivedAt, row.kitchenReadyAt),
          totalMinutes: minutesBetween(row.kitchenReceivedAt, row.kitchenReadyAt),
          items: []
        });
      }
      if (row.productId) grouped.get(row.orderId).items.push({ productId: row.productId, code: row.code || "", name: row.name, quantity: Number(row.quantity || 0) });
    });
    const orders = Array.from(grouped.values());
    const total = values => values.reduce((sum, value) => sum + Number(value || 0), 0);
    const average = values => values.length ? Math.round((total(values) / values.length) * 10) / 10 : 0;
    const totalItems = total(orders.map(order => total(order.items.map(item => item.quantity))));
    const targetMinutes = 20;
    const onTimeOrders = orders.filter(order => order.totalMinutes <= targetMinutes).length;

    const productMap = new Map();
    orders.forEach(order => {
      const seen = new Set();
      order.items.forEach(item => {
        const key = item.productId || item.name;
        const product = productMap.get(key) || { productId: item.productId, name: item.name, quantity: 0, orderCount: 0, totalMinutes: 0 };
        product.quantity += item.quantity;
        if (!seen.has(key)) {
          product.orderCount += 1;
          product.totalMinutes += order.totalMinutes;
          seen.add(key);
        }
        productMap.set(key, product);
      });
    });
    const products = Array.from(productMap.values()).map(product => ({
      productId: product.productId,
      name: product.name,
      quantity: product.quantity,
      orderCount: product.orderCount,
      averageMinutes: product.orderCount ? Math.round((product.totalMinutes / product.orderCount) * 10) / 10 : 0
    })).sort((a, b) => b.quantity - a.quantity || a.name.localeCompare(b.name)).slice(0, 20);

    const hourMap = new Map();
    orders.forEach(order => {
      const hour = String(order.receivedAt || "").slice(11, 13) || "00";
      const entry = hourMap.get(hour) || { hour: `${hour}:00`, orders: 0, items: 0, totalMinutes: 0 };
      entry.orders += 1;
      entry.items += total(order.items.map(item => item.quantity));
      entry.totalMinutes += order.totalMinutes;
      hourMap.set(hour, entry);
    });
    const hours = Array.from(hourMap.values()).map(entry => ({
      hour: entry.hour,
      orders: entry.orders,
      items: entry.items,
      averageMinutes: Math.round((entry.totalMinutes / entry.orders) * 10) / 10
    })).sort((a, b) => b.orders - a.orders || a.hour.localeCompare(b.hour));

    res.json({
      targetMinutes,
      summary: {
        orders: orders.length,
        items: totalItems,
        averageWaitMinutes: average(orders.map(order => order.waitingMinutes)),
        averagePreparationMinutes: average(orders.map(order => order.preparationMinutes)),
        averageTotalMinutes: average(orders.map(order => order.totalMinutes)),
        onTimePercent: orders.length ? Math.round((onTimeOrders / orders.length) * 100) : 0
      },
      products,
      hours,
      orders
    });
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
  const restaurantServerId = Number(req.body.restaurantServerId) || null;
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "Mesa inválida." });
  if (!Number.isInteger(guests) || guests > 99) return res.status(400).json({ error: "Ingresa una cantidad válida de clientes." });
  if (guests < 1) return res.status(400).json({ error: "Debe haber al menos un cliente." });
  try {
    const session = await dataStore.transaction(async () => {
      const table = await dbGet("SELECT * FROM restaurant_tables WHERE id = ? AND company = ? AND active = 1", [id, req.user.company]);
      if (!table) throw Object.assign(new Error("Mesa no encontrada o inactiva."), { status: 404 });
      const open = await dbGet("SELECT id FROM restaurant_table_sessions WHERE tableId = ? AND closedAt IS NULL", [id]);
      if (open) throw Object.assign(new Error("Esta mesa ya está ocupada."), { status: 409 });
      const restaurantServer = restaurantServerId ? await dbGet(
        "SELECT id, name FROM restaurant_servers WHERE id = ? AND company = ? AND active = 1",
        [restaurantServerId, req.user.company]
      ) : null;
      if (restaurantServerId && !restaurantServer) throw Object.assign(new Error("El mesero seleccionado no existe o está inactivo."), { status: 400 });
      const openedAt = getETLocalISO();
      const serverName = restaurantServer?.name || "Sin asignar";
      const result = await dbRun(
        `INSERT INTO restaurant_table_sessions
         (company, tableId, restaurantServerId, serverUserId, serverName, guests, status, openedAt)
         VALUES (?, ?, ?, ?, ?, ?, 'OCCUPIED', ?)`,
        [req.user.company, id, restaurantServerId, req.user.id, serverName, guests, openedAt]
      );
      const session = { id: result.lastID, company: req.user.company, tableId: id, restaurantServerId, guests, status: "OCCUPIED", openedAt, serverName };
      const order = await ensureRestaurantOrder(session);
      return { ...session, orderId: order.id };
    });
    res.json(session);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message });
  }
});

app.post("/restaurant/tables/:id/join", requireRestaurantStore, async (req, res) => {
  const primaryTableId = Number(req.params.id);
  const otherTableId = Number(req.body.otherTableId);
  if (!Number.isInteger(primaryTableId) || !Number.isInteger(otherTableId) || primaryTableId === otherTableId) {
    return res.status(400).json({ error: "Selecciona dos mesas ocupadas diferentes." });
  }
  try {
    const result = await dataStore.transaction(async () => {
      const primary = await dbGet(
        "SELECT * FROM restaurant_table_sessions WHERE tableId = ? AND company = ? AND closedAt IS NULL",
        [primaryTableId, req.user.company]
      );
      const secondary = await dbGet(
        "SELECT * FROM restaurant_table_sessions WHERE tableId = ? AND company = ? AND closedAt IS NULL",
        [otherTableId, req.user.company]
      );
      if (!primary || !secondary) throw Object.assign(new Error("Las dos mesas deben estar ocupadas."), { status: 409 });
      if (primary.joinedToSessionId || secondary.joinedToSessionId) {
        throw Object.assign(new Error("Una de las mesas ya pertenece a otra cuenta unida."), { status: 409 });
      }
      const primaryOrder = await ensureRestaurantOrder(primary);
      const secondaryOrder = await ensureRestaurantOrder(secondary);
      const [primaryCount, secondaryCount] = await Promise.all([
        dbGet("SELECT COUNT(*) AS total FROM restaurant_order_items WHERE orderId = ?", [primaryOrder.id]),
        dbGet("SELECT COUNT(*) AS total FROM restaurant_order_items WHERE orderId = ?", [secondaryOrder.id])
      ]);
      const now = getETLocalISO();
      const primaryHasItems = Number(primaryCount?.total || 0) > 0;
      const secondaryHasItems = Number(secondaryCount?.total || 0) > 0;
      if (secondaryHasItems) {
        await dbRun(
          "UPDATE restaurant_order_items SET orderId = ? WHERE orderId = ? AND company = ?",
          [primaryOrder.id, secondaryOrder.id, req.user.company]
        );
      }
      if (!primaryHasItems && secondaryHasItems) {
        await dbRun(
          `UPDATE restaurant_orders
           SET kitchenStatus = ?, kitchenReceivedAt = ?, kitchenStartedAt = ?, kitchenReadyAt = ?, updatedAt = ?
           WHERE id = ? AND company = ?`,
          [secondaryOrder.kitchenStatus, secondaryOrder.kitchenReceivedAt, secondaryOrder.kitchenStartedAt,
            secondaryOrder.kitchenReadyAt, now, primaryOrder.id, req.user.company]
        );
      } else if (primaryHasItems && secondaryHasItems) {
        const bothReady = primaryOrder.kitchenStatus === "READY" && secondaryOrder.kitchenStatus === "READY";
        const eitherStarted = [primaryOrder.kitchenStatus, secondaryOrder.kitchenStatus].some(status => status === "COOKING" || status === "READY");
        const received = [primaryOrder.kitchenReceivedAt, secondaryOrder.kitchenReceivedAt].filter(Boolean).sort()[0] || now;
        const started = [primaryOrder.kitchenStartedAt, secondaryOrder.kitchenStartedAt].filter(Boolean).sort()[0] || null;
        const ready = bothReady
          ? [primaryOrder.kitchenReadyAt, secondaryOrder.kitchenReadyAt].filter(Boolean).sort().at(-1) || now
          : null;
        await dbRun(
          `UPDATE restaurant_orders
           SET kitchenStatus = ?, kitchenReceivedAt = ?, kitchenStartedAt = ?, kitchenReadyAt = ?, updatedAt = ?
           WHERE id = ? AND company = ?`,
          [bothReady ? "READY" : eitherStarted ? "COOKING" : "NEW", received,
            eitherStarted ? (started || now) : null, ready, now, primaryOrder.id, req.user.company]
        );
      }
      await dbRun(
        "UPDATE restaurant_orders SET status = 'MERGED', updatedAt = ? WHERE id = ? AND company = ?",
        [now, secondaryOrder.id, req.user.company]
      );
      await dbRun(
        "UPDATE restaurant_table_sessions SET joinedToSessionId = ? WHERE joinedToSessionId = ? AND company = ? AND closedAt IS NULL",
        [primary.id, secondary.id, req.user.company]
      );
      await dbRun(
        "UPDATE restaurant_table_sessions SET joinedToSessionId = ?, status = 'JOINED' WHERE id = ? AND company = ? AND closedAt IS NULL",
        [primary.id, secondary.id, req.user.company]
      );
      const context = await restaurantSessionContext(primary);
      return { joined: true, primarySessionId: primary.id, ...context };
    });
    res.json(result);
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
    if (session.joinedToSessionId) {
      return res.status(409).json({ error: "Esta mesa comparte una cuenta. Libera o cobra desde la mesa principal." });
    }
    const pendingOrder = await dbGet(
      `SELECT o.id, COUNT(oi.id) AS itemCount
       FROM restaurant_orders o
       LEFT JOIN restaurant_order_items oi ON oi.orderId = o.id
       WHERE o.tableSessionId = ? AND o.company = ? AND o.status = 'OPEN'
       GROUP BY o.id`,
      [session.id, req.user.company]
    );
    if (Number(pendingOrder?.itemCount || 0) > 0) {
      return res.status(409).json({ error: "Esta mesa tiene un pedido pendiente. Ábrelo y finaliza la venta antes de liberar la mesa." });
    }
    const closedAt = getETLocalISO();
    const durationMinutes = Math.max(0, Math.round((new Date(closedAt) - new Date(session.openedAt)) / 60000));
    await dbRun(
      `UPDATE restaurant_table_sessions SET closedAt = ?, durationMinutes = ?, status = 'CLOSED'
       WHERE company = ? AND closedAt IS NULL AND (id = ? OR joinedToSessionId = ?)`,
      [closedAt, durationMinutes, req.user.company, session.id, session.id]
    );
    if (pendingOrder?.id) {
      await dbRun(
        "UPDATE restaurant_orders SET status = 'CANCELED', updatedAt = ? WHERE id = ? AND company = ?",
        [closedAt, pendingOrder.id, req.user.company]
      );
    }
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
    `CREATE TABLE IF NOT EXISTS products (id SERIAL PRIMARY KEY, code TEXT, name TEXT, quantity INTEGER, price DOUBLE PRECISION, taxRate DOUBLE PRECISION DEFAULT 15, menuCategory TEXT DEFAULT 'General', available INTEGER DEFAULT 1, modifierGroups TEXT DEFAULT '[]', company TEXT)`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS menuCategory TEXT DEFAULT 'General'`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS available INTEGER DEFAULT 1`,
    `ALTER TABLE products ADD COLUMN IF NOT EXISTS modifierGroups TEXT DEFAULT '[]'`,
    `CREATE TABLE IF NOT EXISTS sales (id SERIAL PRIMARY KEY, productId INTEGER, code TEXT, name TEXT, quantity INTEGER, price DOUBLE PRECISION, grossTotal DOUBLE PRECISION DEFAULT 0, discountPercent DOUBLE PRECISION DEFAULT 0, discountAmount DOUBLE PRECISION DEFAULT 0, discountReason TEXT DEFAULT '', selectedModifiers TEXT DEFAULT '[]', grantedByUserId INTEGER, grantedByName TEXT DEFAULT '', total DOUBLE PRECISION, date TEXT, paymentType TEXT, invoiceId INTEGER, company TEXT)`,
    `ALTER TABLE sales ADD COLUMN IF NOT EXISTS grossTotal DOUBLE PRECISION DEFAULT 0`,
    `ALTER TABLE sales ADD COLUMN IF NOT EXISTS discountPercent DOUBLE PRECISION DEFAULT 0`,
    `ALTER TABLE sales ADD COLUMN IF NOT EXISTS discountAmount DOUBLE PRECISION DEFAULT 0`,
    `ALTER TABLE sales ADD COLUMN IF NOT EXISTS discountReason TEXT DEFAULT ''`,
    `ALTER TABLE sales ADD COLUMN IF NOT EXISTS selectedModifiers TEXT DEFAULT '[]'`,
    `ALTER TABLE sales ADD COLUMN IF NOT EXISTS grantedByUserId INTEGER`,
    `ALTER TABLE sales ADD COLUMN IF NOT EXISTS grantedByName TEXT DEFAULT ''`,
    `CREATE TABLE IF NOT EXISTS invoices (id SERIAL PRIMARY KEY, company TEXT NOT NULL, invoiceType TEXT NOT NULL, clientId INTEGER, buyerIdType TEXT, buyerIdNumber TEXT, buyerName TEXT NOT NULL, buyerAddress TEXT, buyerEmail TEXT, subtotal DOUBLE PRECISION NOT NULL, taxAmount DOUBLE PRECISION NOT NULL, discountAmount DOUBLE PRECISION DEFAULT 0, total DOUBLE PRECISION NOT NULL, paymentType TEXT NOT NULL, cashRegisterSessionId INTEGER, restaurantOrderId INTEGER, invoiceNumber TEXT, status TEXT DEFAULT 'CONFIGURATION_REQUIRED', cashReceived DOUBLE PRECISION DEFAULT 0, changeDue DOUBLE PRECISION DEFAULT 0, issuedByUserId INTEGER, issuedByName TEXT DEFAULT '', accessKey TEXT, authorizationNumber TEXT, authorizedAt TEXT, sriMessage TEXT, date TEXT NOT NULL)`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS restaurantOrderId INTEGER`,
    `CREATE TABLE IF NOT EXISTS invoice_payments (id SERIAL PRIMARY KEY, company TEXT NOT NULL, invoiceId INTEGER NOT NULL, paymentType TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL)`,
    `CREATE INDEX IF NOT EXISTS idx_invoice_payments_invoice ON invoice_payments(invoiceId)`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS discountAmount DOUBLE PRECISION DEFAULT 0`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cashRegisterSessionId INTEGER`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cashReceived DOUBLE PRECISION DEFAULT 0`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS changeDue DOUBLE PRECISION DEFAULT 0`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issuedByUserId INTEGER`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS issuedByName TEXT DEFAULT ''`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS accessKey TEXT`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS authorizationNumber TEXT`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS authorizedAt TEXT`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS saleStatus TEXT DEFAULT 'COMPLETADA'`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS cancellationReason TEXT`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS canceledAt TEXT`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS canceledByUserId INTEGER`,
    `ALTER TABLE invoices ADD COLUMN IF NOT EXISTS canceledByName TEXT`,
    `CREATE TABLE IF NOT EXISTS sale_adjustments (id SERIAL PRIMARY KEY, company TEXT NOT NULL, invoiceId INTEGER, saleId INTEGER NOT NULL, type TEXT NOT NULL, quantity INTEGER NOT NULL, amount DOUBLE PRECISION NOT NULL, reason TEXT NOT NULL, paymentType TEXT NOT NULL, cashRegisterSessionId INTEGER NOT NULL, performedByUserId INTEGER, performedByName TEXT NOT NULL, createdAt TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sri_settings (company TEXT PRIMARY KEY, environment TEXT DEFAULT 'TEST', ruc TEXT, legalName TEXT, commercialName TEXT, mainAddress TEXT, establishmentAddress TEXT, establishmentCode TEXT DEFAULT '001', emissionPoint TEXT DEFAULT '001', nextSequence INTEGER DEFAULT 1, accountingRequired TEXT DEFAULT 'NO', specialTaxpayerNumber TEXT, taxRegime TEXT, senderEmail TEXT, adminCopyEmail TEXT, certificateConfigured INTEGER DEFAULT 0, certificateValidated INTEGER DEFAULT 0, certificateLocalValidated INTEGER DEFAULT 0)`,
    `CREATE TABLE IF NOT EXISTS sri_certificates (company TEXT PRIMARY KEY, filename TEXT NOT NULL, certificateEncrypted TEXT NOT NULL, passwordEncrypted TEXT NOT NULL, installedAt TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS client_intake_tokens (company TEXT PRIMARY KEY, tokenHash TEXT NOT NULL UNIQUE, active INTEGER DEFAULT 1, createdAt TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS client_intake_submissions (id SERIAL PRIMARY KEY, company TEXT NOT NULL, clientId INTEGER NOT NULL, createdAt TEXT NOT NULL, claimedAt TEXT)`,
    `CREATE TABLE IF NOT EXISTS clients (id SERIAL PRIMARY KEY, company TEXT, idType TEXT, idNumber TEXT, razonSocial TEXT, nombreComercial TEXT, ciudad TEXT, direccion TEXT, email TEXT, telefono TEXT, celular TEXT)`,
    `CREATE TABLE IF NOT EXISTS restaurant_tables (id SERIAL PRIMARY KEY, company TEXT NOT NULL, name TEXT NOT NULL, capacity INTEGER DEFAULT 4, active INTEGER DEFAULT 1, createdAt TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS restaurant_servers (id SERIAL PRIMARY KEY, company TEXT NOT NULL, name TEXT NOT NULL, active INTEGER DEFAULT 1, createdAt TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS restaurant_table_sessions (id SERIAL PRIMARY KEY, company TEXT NOT NULL, tableId INTEGER NOT NULL, restaurantServerId INTEGER, serverUserId INTEGER NOT NULL, serverName TEXT NOT NULL, guests INTEGER NOT NULL, status TEXT DEFAULT 'OCCUPIED', joinedToSessionId INTEGER, openedAt TEXT NOT NULL, closedAt TEXT, durationMinutes INTEGER)`,
    `CREATE TABLE IF NOT EXISTS restaurant_orders (id SERIAL PRIMARY KEY, company TEXT NOT NULL, tableSessionId INTEGER NOT NULL, tableId INTEGER NOT NULL, status TEXT DEFAULT 'OPEN', kitchenStatus TEXT DEFAULT 'NEW', kitchenReceivedAt TEXT, kitchenStartedAt TEXT, kitchenReadyAt TEXT, createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, paidAt TEXT, invoiceId INTEGER)`,
    `CREATE TABLE IF NOT EXISTS restaurant_order_items (id SERIAL PRIMARY KEY, company TEXT NOT NULL, orderId INTEGER NOT NULL, productId INTEGER NOT NULL, code TEXT, name TEXT NOT NULL, quantity INTEGER NOT NULL, price DOUBLE PRECISION NOT NULL, discountPercent DOUBLE PRECISION DEFAULT 0, discountReason TEXT DEFAULT '', selectedModifiers TEXT DEFAULT '[]', note TEXT DEFAULT '')`,
    `CREATE TABLE IF NOT EXISTS cash_register_sessions (id SERIAL PRIMARY KEY, company TEXT NOT NULL, openedByUserId INTEGER NOT NULL, openedByName TEXT NOT NULL, openedAt TEXT NOT NULL, openingAmount DOUBLE PRECISION NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'OPEN', closedByUserId INTEGER, closedByName TEXT, closedAt TEXT, cashSales DOUBLE PRECISION NOT NULL DEFAULT 0, cardSales DOUBLE PRECISION NOT NULL DEFAULT 0, transferSales DOUBLE PRECISION NOT NULL DEFAULT 0, otherSales DOUBLE PRECISION NOT NULL DEFAULT 0, cashIn DOUBLE PRECISION NOT NULL DEFAULT 0, cashOut DOUBLE PRECISION NOT NULL DEFAULT 0, expectedAmount DOUBLE PRECISION NOT NULL DEFAULT 0, countedAmount DOUBLE PRECISION, difference DOUBLE PRECISION)`,
    `CREATE TABLE IF NOT EXISTS cash_register_movements (id SERIAL PRIMARY KEY, company TEXT NOT NULL, sessionId INTEGER NOT NULL, type TEXT NOT NULL, amount DOUBLE PRECISION NOT NULL, reason TEXT NOT NULL, recordedByUserId INTEGER NOT NULL, recordedByName TEXT NOT NULL, createdAt TEXT NOT NULL)`,
    `ALTER TABLE restaurant_order_items ADD COLUMN IF NOT EXISTS discountPercent DOUBLE PRECISION DEFAULT 0`,
    `ALTER TABLE restaurant_order_items ADD COLUMN IF NOT EXISTS discountReason TEXT DEFAULT ''`,
    `ALTER TABLE restaurant_order_items ADD COLUMN IF NOT EXISTS selectedModifiers TEXT DEFAULT '[]'`,
    `ALTER TABLE restaurant_orders ADD COLUMN IF NOT EXISTS kitchenStatus TEXT DEFAULT 'NEW'`,
    `ALTER TABLE restaurant_orders ADD COLUMN IF NOT EXISTS kitchenReceivedAt TEXT`,
    `ALTER TABLE restaurant_orders ADD COLUMN IF NOT EXISTS kitchenStartedAt TEXT`,
    `ALTER TABLE restaurant_orders ADD COLUMN IF NOT EXISTS kitchenReadyAt TEXT`,
    `ALTER TABLE restaurant_table_sessions ADD COLUMN IF NOT EXISTS restaurantServerId INTEGER`,
    `ALTER TABLE restaurant_table_sessions ADD COLUMN IF NOT EXISTS joinedToSessionId INTEGER`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_open_table_session ON restaurant_table_sessions(tableId) WHERE closedAt IS NULL`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_restaurant_order_session ON restaurant_orders(tableSessionId)`,
    `CREATE UNIQUE INDEX IF NOT EXISTS idx_cash_register_open_company ON cash_register_sessions(company) WHERE status = 'OPEN'`,
    `CREATE INDEX IF NOT EXISTS idx_users_company ON users(company)`,
    `CREATE INDEX IF NOT EXISTS idx_products_company ON products(company)`,
    `CREATE INDEX IF NOT EXISTS idx_sales_company_date ON sales(company, date)`,
    `CREATE INDEX IF NOT EXISTS idx_clients_company ON clients(company)`,
    `CREATE INDEX IF NOT EXISTS idx_invoices_company_date ON invoices(company, date)`,
    `CREATE INDEX IF NOT EXISTS idx_restaurant_tables_company ON restaurant_tables(company)`,
    `CREATE INDEX IF NOT EXISTS idx_restaurant_servers_company ON restaurant_servers(company)`,
    `CREATE INDEX IF NOT EXISTS idx_restaurant_sessions_company ON restaurant_table_sessions(company, openedAt)`,
    `CREATE INDEX IF NOT EXISTS idx_restaurant_orders_company ON restaurant_orders(company, status)`,
    `CREATE INDEX IF NOT EXISTS idx_restaurant_order_items_order ON restaurant_order_items(orderId)`,
    `CREATE INDEX IF NOT EXISTS idx_cash_register_company_opened ON cash_register_sessions(company, openedAt)`,
    `CREATE INDEX IF NOT EXISTS idx_cash_register_movements_session ON cash_register_movements(sessionId)`,
    `CREATE INDEX IF NOT EXISTS idx_sale_adjustments_sale ON sale_adjustments(saleId)`,
    `CREATE INDEX IF NOT EXISTS idx_sale_adjustments_register ON sale_adjustments(cashRegisterSessionId)`
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
