const API = "";
let setupToken = "";
let resetEmail = "";

function showAuthPanel(id) {
  ["loginPanel", "createPasswordPanel", "forgotPanel", "resetPanel"].forEach(panel => document.getElementById(panel).classList.toggle("hidden", panel !== id));
}

function showLogin() { showAuthPanel("loginPanel"); }
function showForgotPassword() {
  document.getElementById("forgotEmail").value = document.getElementById("loginUser").value.trim();
  showAuthPanel("forgotPanel");
}

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

    if (data.passwordChangeRequired) {
      setupToken = data.setupToken;
      showAuthPanel("createPasswordPanel");
      document.getElementById("createPass").focus();
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

async function createPassword() {
  const password = document.getElementById("createPass").value;
  const confirm = document.getElementById("createPass2").value;
  if (password.length < 8) return alert("La contraseña debe tener al menos 8 caracteres.");
  if (password !== confirm) return alert("Las contraseñas no coinciden.");
  const res = await fetch(`${API}/auth/create-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ setupToken, password }) });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "No se pudo crear la contraseña.");
  setupToken = "";
  document.getElementById("loginPass").value = "";
  showLogin();
  alert("Contraseña creada. Ya puedes iniciar sesión.");
}

async function sendResetCode() {
  resetEmail = (document.getElementById("forgotEmail").value.trim() || resetEmail).toLowerCase();
  if (!resetEmail) return alert("Ingresa tu correo electrónico.");
  const res = await fetch(`${API}/auth/forgot-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: resetEmail }) });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "No se pudo enviar el código.");
  showAuthPanel("resetPanel");
  document.getElementById("resetCode").focus();
  alert(data.message);
}

async function resetPassword() {
  const code = document.getElementById("resetCode").value.trim();
  const password = document.getElementById("resetPass").value;
  const confirm = document.getElementById("resetPass2").value;
  if (!/^\d{6}$/.test(code)) return alert("Ingresa el código de 6 dígitos.");
  if (password.length < 8) return alert("La contraseña debe tener al menos 8 caracteres.");
  if (password !== confirm) return alert("Las contraseñas no coinciden.");
  const res = await fetch(`${API}/auth/reset-password`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: resetEmail, code, password }) });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "No se pudo cambiar la contraseña.");
  document.getElementById("loginUser").value = resetEmail;
  document.getElementById("loginPass").value = "";
  showLogin();
  alert("Contraseña actualizada. Ya puedes iniciar sesión.");
}
