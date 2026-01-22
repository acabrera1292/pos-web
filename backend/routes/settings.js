const express = require("express");
const router = express.Router();

// Load settings for a specific company
router.get("/:company", (req, res) => {
  const db = req.app.get("db");
  const company = req.params.company;

  db.get(
    "SELECT * FROM settings WHERE company = ?",
    [company],
    (err, row) => {
      if (err) {
        console.error("Error loading settings:", err.message);
        return res.status(500).json({ error: "DB error" });
      }

      if (!row) {
        console.log(`🔹 No settings row — returning default`);
        return res.json({ company, low_threshold: 10 }); // default fallback
      }

      res.json(row);
    }
  );
});

// Save settings
router.post("/save", (req, res) => {
  const db = req.app.get("db");
  const { company, low_threshold } = req.body;

  if (!company || low_threshold == null) {
    return res.status(400).json({ error: "Missing settings data" });
  }

  db.run(
    `INSERT OR REPLACE INTO settings (company, low_threshold) VALUES (?, ?)`,
    [company, low_threshold],
    function (err) {
      if (err) {
        console.error("Error saving settings:", err.message);
        return res.status(500).json({ error: "Failed to save settings" });
      }

      res.json({ msg: "Configuración guardada" });
    }
  );
});

module.exports = router;