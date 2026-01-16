const express = require("express");
const router = express.Router();

router.post("/add", (req, res) => {
  const db = req.app.get("db");
  const { code, name, quantity, price, company } = req.body;

  db.run(
    `INSERT INTO products (code, name, quantity, price, company)
     VALUES (?, ?, ?, ?, ?)`,
    [code, name, quantity, price, company],
    function (err) {
      if (err) return res.status(500).json(err);
      res.json({ id: this.lastID });
    }
  );
});

router.get("/:company", (req, res) => {
  const db = req.app.get("db");
  db.all(
    "SELECT * FROM products WHERE company = ?",
    [req.params.company],
    (err, rows) => res.json(rows)
  );
});

router.put("/edit/:id", (req, res) => {
  const db = req.app.get("db");
  const { code, name, quantity, price } = req.body;
  db.run(
    `UPDATE products SET code=?, name=?, quantity=?, price=? WHERE id=?`,
    [code, name, quantity, price, req.params.id],
    () => res.json({ msg: "Producto actualizado" })
  );
});

router.delete("/delete/:id", (req, res) => {
  req.app.get("db").run(
    "DELETE FROM products WHERE id=?",
    [req.params.id],
    () => res.json({ msg: "Producto eliminado" })
  );
});

module.exports = router;
