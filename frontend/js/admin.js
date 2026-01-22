const API = "http://localhost:4000";

let currentSecret = "";
let stores = [];
let users = [];

function getSecret() {
  if (!currentSecret) {
    currentSecret = document.getElementById("adminSecret").value.trim();
  }
  return currentSecret;
}

async function loadAll() {
  currentSecret = document.getElementById("adminSecret").value.trim();
  if (!currentSecret) {
    alert("Ingresa la clave admin (ADMIN_SECRET).");
    return;
  }
  await Promise.all([loadStores(), loadUsers()]);
}

// ------- Tiendas -------

async function loadStores() {
  const secret = getSecret();
  try {
    const res = await fetch(`${API}/admin/tiendas?secret=${encodeURIComponent(secret)}`);
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Error al cargar tiendas.");
      return;
    }
    stores = data;
    renderStores();
    fillStoreSelect();
  } catch (err) {
    console.error(err);
    alert("No se pudo conectar con el servidor (tiendas).");
  }
}

function renderStores() {
  const tbody = document.getElementById("storesBody");
  tbody.innerHTML = "";

  stores.forEach(s => {
    const tr = document.createElement("tr");

    const estado = s.active ? "Activa" : "Inactiva";

    tr.innerHTML = `
      <td>${s.company}</td>
      <td>
        <select onchange="changeStoreState('${s.company}', this.value)">
          <option value="1" ${s.active ? "selected" : ""}>Activa</option>
          <option value="0" ${!s.active ? "selected" : ""}>Inactiva</option>
        </select>
      </td>
      <td>
        <button onclick="enterStore('${s.company}')">Entrar</button>
        <button onclick="deleteStore('${s.company}')">Eliminar tienda</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function fillStoreSelect() {
  const sel = document.getElementById("storeSelect");
  sel.innerHTML = "";
  stores.forEach(s => {
    const opt = document.createElement("option");
    opt.value = s.company;
    opt.textContent = s.company;
    sel.appendChild(opt);
  });
}

async function changeStoreState(company, value) {
  const secret = getSecret();
  const active = value === "1";

  try {
    const res = await fetch(`${API}/admin/tiendas/estado?secret=${encodeURIComponent(secret)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ company, active })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Error al cambiar estado.");
      return;
    }
    await loadStores();
  } catch (err) {
    console.error(err);
    alert("No se pudo conectar con el servidor.");
  }
}

async function deleteStore(company) {
  const secret = getSecret();
  if (!confirm(`¿Eliminar la tienda "${company}" y todos sus datos?`)) return;

  try {
    const res = await fetch(
      `${API}/admin/tiendas/${encodeURIComponent(company)}?secret=${encodeURIComponent(secret)}`,
      { method: "DELETE" }
    );
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Error al eliminar tienda.");
      return;
    }
    await loadAll();
  } catch (err) {
    console.error(err);
    alert("No se pudo conectar con el servidor.");
  }
}

async function createStore() {
  const email = document.getElementById("newEmail").value.trim();
  const pass  = document.getElementById("newPassword").value.trim();
  const store = document.getElementById("newStore").value.trim();
  const secret = getSecret();

  if (!email || !pass || !store) {
    alert("Completa correo, contraseña inicial y nombre de tienda.");
    return;
  }

  try {
    // reutilizamos /admin/usuarios para crear el primer Admin
    const res = await fetch(`${API}/admin/usuarios?secret=${encodeURIComponent(secret)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: email,
        password: pass,
        company: store,
        role: "Admin"
      })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Error al crear tienda.");
      return;
    }

    document.getElementById("newEmail").value = "";
    document.getElementById("newPassword").value = "";
    document.getElementById("newStore").value = "";

    await loadAll();
  } catch (err) {
    console.error(err);
    alert("No se pudo conectar con el servidor.");
  }
}

function enterStore(company) {
  // Impersonar tienda como Admin
  localStorage.setItem("company", company);
  localStorage.setItem("username", "admin@support");
  localStorage.setItem("role", "Admin");
  window.location.href = "dashboard.html";
}

// ------- Usuarios -------

async function loadUsers() {
  const secret = getSecret();
  try {
    const res = await fetch(`${API}/admin/usuarios?secret=${encodeURIComponent(secret)}`);
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Error al cargar usuarios.");
      return;
    }
    users = data;
    renderUsers();
  } catch (err) {
    console.error(err);
    alert("No se pudo conectar con el servidor (usuarios).");
  }
}

function renderUsers() {
  const tbody = document.getElementById("usersBody");
  tbody.innerHTML = "";

  users.forEach(u => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${u.id}</td>
      <td>${u.username}</td>
      <td>${u.company}</td>
      <td>${u.role || "Admin"}</td>
      <td>
        <button onclick="deleteUser(${u.id})">Eliminar</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

async function createUser() {
  const company = document.getElementById("storeSelect").value;
  const email   = document.getElementById("userEmail").value.trim();
  const pass    = document.getElementById("userPass").value.trim();
  const role    = document.getElementById("userRole").value;
  const secret  = getSecret();

  if (!company || !email || !pass) {
    alert("Selecciona tienda y completa correo y contraseña.");
    return;
  }

  try {
    const res = await fetch(`${API}/admin/usuarios?secret=${encodeURIComponent(secret)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: email, password: pass, company, role })
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Error al crear usuario.");
      return;
    }

    document.getElementById("userEmail").value = "";
    document.getElementById("userPass").value = "";

    await loadUsers();
  } catch (err) {
    console.error(err);
    alert("No se pudo conectar con el servidor.");
  }
}

async function deleteUser(id) {
  const secret = getSecret();
  if (!confirm("¿Eliminar este usuario?")) return;

  try {
    const res = await fetch(`${API}/admin/usuarios/${id}?secret=${encodeURIComponent(secret)}`, {
      method: "DELETE"
    });
    const data = await res.json();
    if (!res.ok) {
      alert(data.error || "Error al eliminar usuario.");
      return;
    }
    await loadUsers();
  } catch (err) {
    console.error(err);
    alert("No se pudo conectar con el servidor.");
  }
}
