// ============================
// CONFIGURACIÓN MODULE
// ============================

const API = "http://localhost:4000";

export function initConfig() {
  const container = document.getElementById("config");
  if (!container) return;

  container.innerHTML = `
    <h2>Configuración</h2>

    <h3>Stock Bajo</h3>
    <label>
      Umbral stock bajo:
      <input id="lowThreshold" type="number" style="width:80px;">
    </label>
    <button id="btnSaveThreshold">Guardar umbral</button>

    <hr style="margin:16px 0;">

    <h3>Cambiar contraseña</h3>
    <div class="config-form-row">
      <input id="currentPass" type="password" placeholder="Contraseña actual">
      <input id="newPass" type="password" placeholder="Nueva contraseña">
      <input id="newPass2" type="password" placeholder="Repetir nueva contraseña">
      <button id="btnChangePassword">Guardar nueva contraseña</button>
    </div>
  `;

  loadThreshold();
  bindConfigEvents();
}

// ============================
// EVENTS
// ============================

function bindConfigEvents() {
  document.getElementById("btnSaveThreshold").onclick = saveThreshold;
  document.getElementById("btnChangePassword").onclick = changePassword;
}

// ============================
// STOCK THRESHOLD
// ============================

function getThresholdKey() {
  const company = localStorage.getItem("company");
  return `lowThreshold_${company}`;
}

function loadThreshold() {
  const key = getThresholdKey();
  const val = localStorage.getItem(key);
  document.getElementById("lowThreshold").value = val || 5;
}

function saveThreshold() {
  const input = document.getElementById("lowThreshold");
  const value = Number(input.value || 0);
  const key = getThresholdKey();
  localStorage.setItem(key, value);
  alert("Umbral guardado correctamente.");
}

// ============================
// CAMBIO DE CONTRASEÑA
// ============================

async function changePassword() {
  const username = localStorage.getItem("username");
  if (!username) {
    alert("No se encontró el usuario en sesión.");
    return;
  }

  const current = document.getElementById("currentPass").value.trim();
  const newPass = document.getElementById("newPass").value.trim();
  const newPass2 = document.getElementById("newPass2").value.trim();

  if (!current || !newPass || !newPass2) {
    alert("Completa todos los campos de contraseña.");
    return;
  }

  if (newPass !== newPass2) {
    alert("La nueva contraseña no coincide.");
    return;
  }

  try {
    const res = await fetch(`${API}/auth/change-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        oldPassword: current,
        newPassword: newPass
      })
    });

    const data = await res.json();

    if (!res.ok) {
      alert(data.error || "Error al cambiar contraseña.");
      return;
    }

    alert("Contraseña actualizada correctamente.");
    document.getElementById("currentPass").value = "";
    document.getElementById("newPass").value = "";
    document.getElementById("newPass2").value = "";
  } catch (err) {
    console.error(err);
    alert("No se pudo conectar con el servidor.");
  }
}
