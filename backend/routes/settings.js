const express = require("express");
const router = express.Router();

// GET /settings/:company
router.get("/:company", (req, res) => {
  const db = req.app.get("db");

  console.log("🔍 GET /settings/:company hit with:", req.params.company);

  db.get(
    "SELECT * FROM settings WHERE company = ?",
    [req.params.company],
    (err, row) => {
      if (err) {
        console.error("❌ Error loading settings:", err.message);
        return res.status(500).json({ error: "DB error" });
      }

      if (!row) {
        console.log("🔹 No settings row — returning default");
        return res.json({ low_threshold: 10 }); // Default value
      }

      console.log("✅ Found settings row:", row);
      res.json(row);
    }
  );
});

// POST /settings/save
router.post("/save", (req, res) => {
  const db = req.app.get("db");
  const { company, low_threshold } = req.body;

  db.run(
    `INSERT OR REPLACE INTO settings (company, low_threshold) VALUES (?, ?)`,
    [company, low_threshold],
    (err) => {
      if (err) {
        console.error("❌ Error saving settings:", err.message);
        return res.status(500).json({ error: "DB error" });
      }

      console.log("✅ Settings saved for:", company);
      res.json({ msg: "Configuración guardada" });
    }
  );
});

module.exports = router; // ✅ Export once, at the end
