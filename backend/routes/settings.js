const express = require("express");
const router = express.Router();

// GET settings for a specific company
router.get("/:company", (req, res) => {
  const db = req.app.get("db");

  db.get(
    "SELECT * FROM settings WHERE company = ?",
    [req.params.company],
    (err, row) => {
      if (err) {
        console.error("Error loading settings:", err.message);
        return res.status(500).json({ error: "Database error" });
      }

      if (!row) {
        console.log(`🔹 No settings row — returning default`);
        return res.json({ low_threshold: 10 }); // default
      }

      res.json(row);
    }
  );
});

// POST to create or update settings
router.post("/save", (req, res) => {
  const db = req.app.get("db");
  const { company, low_threshold } = req.body;

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
