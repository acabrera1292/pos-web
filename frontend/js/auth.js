const API =
  window.location.hostname.includes("localhost")
    ? "http://localhost:4000"
    : "https://pos-api-yvoj.onrender.com";

// Solo login, el registro ahora vive en admin.html
async function login() {
  const username = document.getElementById("loginUser").value.trim();
  const password = document.getElementById("loginPass").value.trim();

  if (!username || !password) {
    alert("Por favor ingresa correo y contraseña.");
    return;
  }

  try {
    const res = await fetch(`${API}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password })
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Error al iniciar sesión.");
      return;
    }

    // guardar sesión (incluimos el correo)
    localStorage.setItem("token", data.token);
    localStorage.setItem("company", data.company);
    localStorage.setItem("username", data.username || username);
    localStorage.setItem("role", data.role || "Admin");

    window.location.href = "dashboard.html";
  } catch (err) {
    console.error(err);
    alert("No se pudo conectar con el servidor.");
  }
}
