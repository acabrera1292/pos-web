const express = require("express");
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");

const router = express.Router();
const SECRET = "REPLACE_WITH_A_SECRET_KEY";

router.post("/register", async (req, res) => {
  const db = req.app.get("db");
  const { username, password, company } = req.body;
  const hashed = await bcrypt.hash(password, 10);

  db.run(
    `INSERT INTO users (username, password, company) VALUES (?, ?, ?)`,
    [username, hashed, company],
    function (err) {
      if (err) return res.status(500).json(err);
      res.json({ id: this.lastID });
    }
  );
});

router.post("/login", (req, res) => {
  const db = req.app.get("db");
  const { username, password } = req.body;

  db.get(
    `SELECT * FROM users WHERE username = ?`,
    [username],
    async (err, user) => {
      if (!user)
        return res.status(400).json({ msg: "Usuario no existe" });

      if (!(await bcrypt.compare(password, user.password)))
        return res.status(400).json({ msg: "Contraseña incorrecta" });

      const token = jwt.sign(
        { id: user.id, username: user.username, company: user.company },
        SECRET
      );

      res.json({ token, company: user.company });
    }
  );
});

module.exports = router;
