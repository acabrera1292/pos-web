const express = require("express");
const router = express.Router();

router.post("/add", (req, res) => {
  const db = req.app.get("db");
  const { productId, code, name, quantity, price, total, date, company } =
    req.body;

  db.run(
    `INSERT INTO sales
     (productId, code, name, quantity, price, total, date, company)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [productId, code, name, quantity, price, total, date, company],
    function (err) {
      if (err) return res.status(500).json(err);
      res.json({ id: this.lastID });
    }
  );
});

router.get("/:company", (req, res) => {
  req.app.get("db").all(
    "SELECT * FROM sales WHERE company = ? ORDER BY date DESC",
    [req.params.company],
    (err, rows) => res.json(rows)
  );
});

module.exports = router;
