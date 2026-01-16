const express = require("express");
const cors = require("cors");
const bodyParser = require("body-parser");
const sqlite3 = require("sqlite3").verbose();

// Route imports (AFTER express initialized)
const authRoutes = require("./routes/auth");
const inventoryRoutes = require("./routes/inventory");
const salesRoutes = require("./routes/sales");
const settingsRoutes = require("./routes/settings");

// Init express app
const app = express();
const PORT = process.env.PORT || 4000;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// SQLite DB setup
const db = new sqlite3.Database("./db/database.sqlite", (err) => {
  if (err) {
    console.error("❌ Failed to connect to SQLite:", err.message);
  } else {
    console.log("✅ Connected to SQLite database.");
  }
});

// Make db accessible in all routes via req.app.get("db")
app.set("db", db);

// Create tables if not exists
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT,
    password TEXT,
    company TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    code TEXT,
    name TEXT,
    quantity INTEGER,
    price REAL,
    company TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS sales (
    id INTEGER PRIMARY KEY,
    productId INTEGER,
    code TEXT,
    name TEXT,
    quantity INTEGER,
    price REAL,
    total REAL,
    date TEXT,
    company TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    id INTEGER PRIMARY KEY,
    company TEXT UNIQUE,
    low_threshold INTEGER
  )`);
});

// Routes
app.use("/auth", authRoutes);
app.use("/inventory", inventoryRoutes);
app.use("/sales", salesRoutes);
app.use("/settings", settingsRoutes);

// Start server
app.listen(PORT, () => {
  console.log(`✅ POS backend running on port ${PORT}`);
});
