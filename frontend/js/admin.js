const API = "";
let currentSecret = "";
let stores = [];
let users = [];
let currentFilter = "all";
let selectedStore = null;
let passwordResetUserId = null;

function getSecret() {
  if (!currentSecret) currentSecret = document.getElementById("adminSecret").value.trim();
  return currentSecret;
}

function adminUrl(path) {
  return `${API}${path}${path.includes("?") ? "&" : "?"}secret=${encodeURIComponent(getSecret())}`;
}

async function loadAll() {
  currentSecret = document.getElementById("adminSecret").value.trim();
  if (!currentSecret) return alert("Ingresa la clave ADMIN_SECRET.");
  await Promise.all([loadStores(), loadUsers()]);
}

async function loadStores() {
  const res = await fetch(adminUrl("/admin/tiendas"));
  const data = await res.json();
  if (!res.ok) return alert(data.error || "No se pudieron cargar las tiendas.");
  stores = data;
  renderStores();
  fillStoreSelect();
  renderSummary();
}

async function loadUsers() {
  const res = await fetch(adminUrl("/admin/usuarios"));
  const data = await res.json();
  if (!res.ok) return alert(data.error || "No se pudieron cargar los usuarios.");
  users = data;
  renderUsers();
  renderSummary();
}

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function daysUntil(date) {
  if (!date) return null;
  const today = new Date(`${todayText()}T00:00:00`);
  const target = new Date(`${date}T00:00:00`);
  return Math.round((target - today) / 86400000);
}

function storeState(store) {
  const days = daysUntil(store.expiresAt);
  if (!store.active) return "inactive";
  if (days !== null && days < 0) return "expired";
  if (days !== null && days <= 30) return "expiring";
  if (Number(store.userCount) >= Number(store.userLimit)) return "limit";
  return "active";
}

function stateLabel(state) {
  return ({ active: "Activa", inactive: "Inactiva", expired: "Vencida", expiring: "Por vencer", limit: "Límite alcanzado" })[state];
}

function matchesStoreFilter(store, filter) {
  const days = daysUntil(store.expiresAt);
  if (filter === "all") return true;
  if (filter === "inactive") return !store.active;
  if (filter === "expired") return Boolean(store.active && days !== null && days < 0);
  if (filter === "expiring") return Boolean(store.active && days !== null && days >= 0 && days <= 30);
  if (filter === "limit") return Number(store.userCount) >= Number(store.userLimit);
  return true;
}

function setStoreFilter(filter, button) {
  currentFilter = filter;
  document.querySelectorAll("#licenseFilters button").forEach(item => item.classList.toggle("active", item === button));
  const labels = { all: "Todas las tiendas", expiring: "Licencias que vencen en 30 días", expired: "Licencias vencidas", inactive: "Tiendas inactivas", limit: "Tiendas sin cupos disponibles" };
  document.getElementById("storeFilterLabel").textContent = labels[filter];
  renderStores();
}

function renderStores() {
  const tbody = document.getElementById("storesBody");
  const search = document.getElementById("storeSearch").value.trim().toLowerCase();
  tbody.innerHTML = "";
  stores.filter(store => {
    const state = storeState(store);
    return matchesStoreFilter(store, currentFilter) && (!search || store.company.toLowerCase().includes(search));
  }).forEach(store => {
    const state = storeState(store);
    const days = daysUntil(store.expiresAt);
    const expiration = !store.expiresAt ? "Sin vencimiento" : days < 0 ? `Venció ${store.expiresAt}` : days === 0 ? "Vence hoy" : `${store.expiresAt} (${days} días)`;
    const row = document.createElement("tr");
    row.innerHTML = `<td><strong></strong></td><td><span class="license-badge ${state}">${stateLabel(state)}</span></td><td></td><td><div class="license-usage"><span>${store.userCount} / ${store.userLimit}</span><progress max="${store.userLimit}" value="${store.userCount}"></progress></div></td><td class="license-actions"></td>`;
    row.children[0].querySelector("strong").textContent = store.company;
    row.children[2].textContent = expiration;
    const edit = document.createElement("button"); edit.textContent = "Editar licencia"; edit.onclick = () => openLicenseEditor(store.company);
    const toggle = document.createElement("button"); toggle.textContent = store.active ? "Desactivar" : "Activar"; toggle.onclick = () => changeStoreState(store.company, !store.active);
    const remove = document.createElement("button"); remove.textContent = "Eliminar"; remove.className = "danger-button"; remove.onclick = () => deleteStore(store.company);
    row.querySelector(".license-actions").append(edit, toggle, remove);
    tbody.appendChild(row);
  });
  if (!tbody.children.length) tbody.innerHTML = '<tr><td colspan="5" class="empty-table">No hay tiendas en este filtro.</td></tr>';
}

function renderSummary() {
  const counts = { all: stores.length, expiring: 0, expired: 0, inactive: 0, limit: 0 };
  let activeCount = 0;
  stores.forEach(store => {
    ["expiring", "expired", "inactive", "limit"].forEach(filter => {
      if (matchesStoreFilter(store, filter)) counts[filter] += 1;
    });
    if (store.active && state !== "expired") activeCount += 1;
  });
  document.getElementById("summaryStores").textContent = counts.all;
  document.getElementById("summaryActive").textContent = activeCount;
  document.getElementById("summaryExpiring").textContent = counts.expiring;
  document.getElementById("summaryUsers").textContent = users.length;
  document.getElementById("countAll").textContent = counts.all;
  document.getElementById("countExpiring").textContent = counts.expiring;
  document.getElementById("countExpired").textContent = counts.expired;
  document.getElementById("countInactive").textContent = counts.inactive;
  document.getElementById("countLimit").textContent = counts.limit;
}

function fillStoreSelect() {
  const select = document.getElementById("storeSelect");
  select.innerHTML = "";
  stores.forEach(store => {
    const option = document.createElement("option");
    option.value = store.company;
    option.textContent = `${store.company} (${store.userCount}/${store.userLimit})`;
    option.disabled = storeState(store) !== "active";
    select.appendChild(option);
  });
}

async function createStore() {
  const payload = {
    company: document.getElementById("newStore").value.trim(),
    username: document.getElementById("newEmail").value.trim(),
    password: document.getElementById("newPassword").value,
    expiresAt: document.getElementById("newExpiration").value || null,
    userLimit: Number(document.getElementById("newUserLimit").value) || 1
  };
  if (!payload.company || !payload.username || !payload.password || !payload.expiresAt) return alert("Completa tienda, Admin inicial, contraseña y vencimiento.");
  const res = await fetch(adminUrl("/admin/tiendas"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "No se pudo crear la tienda.");
  ["newStore", "newEmail", "newPassword", "newExpiration"].forEach(id => document.getElementById(id).value = "");
  document.getElementById("newUserLimit").value = "3";
  await loadAll();
  alert("Tienda y licencia creadas.");
}

function openLicenseEditor(company) {
  const store = stores.find(item => item.company === company);
  if (!store) return;
  selectedStore = store;
  document.getElementById("licenseEditorStore").textContent = `${store.company} · ${store.userCount} usuarios actuales`;
  document.getElementById("editLicenseActive").value = store.active ? "1" : "0";
  document.getElementById("editLicenseExpiration").value = store.expiresAt || "";
  document.getElementById("editLicenseLimit").value = store.userLimit;
  document.getElementById("licenseEditor").classList.remove("hidden");
  document.getElementById("licenseEditor").scrollIntoView({ behavior: "smooth", block: "center" });
}

function closeLicenseEditor() { selectedStore = null; document.getElementById("licenseEditor").classList.add("hidden"); }

async function saveLicense() {
  if (!selectedStore) return;
  const payload = { active: document.getElementById("editLicenseActive").value === "1", expiresAt: document.getElementById("editLicenseExpiration").value || null, userLimit: Number(document.getElementById("editLicenseLimit").value) || 1 };
  const res = await fetch(adminUrl(`/admin/tiendas/${encodeURIComponent(selectedStore.company)}/licencia`), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "No se pudo guardar la licencia.");
  closeLicenseEditor(); await loadStores(); alert("Licencia actualizada.");
}

async function changeStoreState(company, active) {
  const res = await fetch(adminUrl("/admin/tiendas/estado"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ company, active }) });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "No se pudo cambiar el estado.");
  await loadStores();
}

async function deleteStore(company) {
  if (!await appConfirm(`Eliminar "${company}" borrará usuarios, inventario, ventas, clientes y configuración. ¿Continuar?`)) return;
  const res = await fetch(adminUrl(`/admin/tiendas/${encodeURIComponent(company)}`), { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "No se pudo eliminar la tienda.");
  await loadAll();
}

function renderUsers() {
  const tbody = document.getElementById("usersBody"); tbody.innerHTML = "";
  users.forEach(user => {
    const row = document.createElement("tr");
    row.innerHTML = "<td></td><td></td><td></td><td class=license-actions></td>";
    row.children[0].textContent = user.username; row.children[1].textContent = user.company; row.children[2].textContent = user.role || "Admin";
    const password = document.createElement("button"); password.textContent = "Cambiar clave"; password.onclick = () => openPasswordReset(user);
    const remove = document.createElement("button"); remove.textContent = "Eliminar"; remove.className = "danger-button"; remove.onclick = () => deleteUser(user.id);
    row.children[3].append(password, remove); tbody.appendChild(row);
  });
}

async function createUser() {
  const payload = { company: document.getElementById("storeSelect").value, username: document.getElementById("userEmail").value.trim(), password: document.getElementById("userPass").value, role: document.getElementById("userRole").value };
  if (!payload.company || !payload.username || !payload.password) return alert("Selecciona tienda y completa usuario y contraseña.");
  const res = await fetch(adminUrl("/admin/usuarios"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "No se pudo crear el usuario.");
  document.getElementById("userEmail").value = ""; document.getElementById("userPass").value = ""; await loadAll();
}

function openPasswordReset(user) { passwordResetUserId = user.id; document.getElementById("passwordResetUser").textContent = `Nueva clave para ${user.username}`; document.getElementById("passwordResetPanel").classList.remove("hidden"); document.getElementById("passwordResetValue").focus(); }
function closePasswordReset() { passwordResetUserId = null; document.getElementById("passwordResetValue").value = ""; document.getElementById("passwordResetPanel").classList.add("hidden"); }

async function resetUserPassword() {
  const password = document.getElementById("passwordResetValue").value;
  const res = await fetch(adminUrl(`/admin/usuarios/${passwordResetUserId}/password`), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ password }) });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "No se pudo cambiar la clave.");
  closePasswordReset(); alert("Contraseña actualizada.");
}

async function deleteUser(id) {
  if (!await appConfirm("¿Eliminar este usuario?")) return;
  const res = await fetch(adminUrl(`/admin/usuarios/${id}`), { method: "DELETE" });
  const data = await res.json();
  if (!res.ok) return alert(data.error || "No se pudo eliminar el usuario.");
  await loadAll();
}
