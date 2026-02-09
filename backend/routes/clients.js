// backend/routes/clients.js
const express = require("express");
const router = express.Router();

// LISTAR clientes por empresa
router.get("/:company", (req, res) => {
  const { company } = req.params;

  db.all(
    "SELECT * FROM clients WHERE company = ? ORDER BY razonSocial",
    [company],
    (err, rows) => {
      if (err) return res.status(500).json({ error: err.message });
      res.json(rows);
    }
  );
});

// CREAR cliente
router.post("/:company", (req, res) => {
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
      nombreComercial,
      ciudad,
      direccion,
      email,
      telefono,
      celular,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ id: this.lastID });
    }
  );
});

// ACTUALIZAR cliente
router.put("/:company/:id", (req, res) => {
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

  db.run(
    `UPDATE clients
       SET idType = ?, idNumber = ?, razonSocial = ?, nombreComercial = ?,
           ciudad = ?, direccion = ?, email = ?, telefono = ?, celular = ?
     WHERE id = ? AND company = ?`,
    [
      idType,
      idNumber,
      razonSocial,
      nombreComercial,
      ciudad,
      direccion,
      email,
      telefono,
      celular,
      id,
      company,
    ],
    function (err) {
      if (err) return res.status(500).json({ error: err.message });
      res.json({ updated: this.changes });
    }
  );
});

// ELIMINAR cliente
router.delete("/:company/:id", (req, res) => {
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

module.exports = router;
