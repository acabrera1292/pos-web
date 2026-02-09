// ============================
// CLIENTES MODULE
// ============================

const API = "http://localhost:4000";

let allClients = [];
let filteredClients = [];
let selectedClientId = null;
let editingClientId = null;

let currentClientPage = 1;
const clientPageSize = 100;

export function initClientes() {
  const container = document.getElementById("clientes");
  if (!container) return;

  container.innerHTML = `
    <h2>Agregar / Editar Cliente</h2>
    <div class="form-row" style="display:flex; flex-wrap:wrap; gap:8px; margin-bottom:12px;">
      <select id="clientType">
        <option value="Cedula">Cédula</option>
        <option value="RUC">RUC</option>
      </select>
      <input id="clientIdNumber" placeholder="Identificación" />
      <input id="clientRazonSocial" placeholder="Razón social" />
      <input id="clientNombreCom" placeholder="Nombre comercial" />
      <input id="clientCiudad" placeholder="Ciudad" />
      <input id="clientDireccion" placeholder="Dirección" />
      <input id="clientEmail" placeholder="Email" />
      <input id="clientTelefono" placeholder="Teléfono" />
      <input id="clientCelular" placeholder="Celular" />
      <button type="button" id="btnSaveClient">Guardar</button>
      <button type="button" id="btnCancelClient">Cancelar</button>
    </div>

    <h2>Clientes</h2>
    <div class="table-scroll">
      <table border="1">
        <thead>
          <tr>
            <th>Tipo</th>
            <th>Identificación</th>
            <th>Razón Social</th>
            <th>Nombre Comercial</th>
            <th>Ciudad</th>
            <th>Email</th>
            <th>Teléfono</th>
            <th>Celular</th>
          </tr>
        </thead>
        <tbody id="clientsBody"></tbody>
      </table>
    </div>

    <div class="pagination">
      <button id="clientPrev">Anterior</button>
      <span id="clientPageInfo">1 / 1</span>
      <button id="clientNext">Siguiente</button>
    </div>

    <div class="inventory-actions">
      <button id="btnEditClient">Editar</button>
      <button id="btnDeleteClient">Eliminar</button>
    </div>
  `;

  bindClientEvents();
  loadClients();
  initClientFilters();
}

// ============================
// BIND EVENTS
// ============================

function bindClientEvents() {
  document.getElementById("btnSaveClient").onclick = saveClient;
  document.getElementById("btnCancelClient").onclick = clearClientForm;
  document.getElementById("btnEditClient").onclick = startEditClient;
  document.getElementById("btnDeleteClient").onclick = deleteSelectedClient;

  document.getElementById("clientPrev").onclick = () => {
    if (currentClientPage > 1) {
      currentClientPage--;
      renderClientsTable();
    }
  };

  document.getElementById("clientNext").onclick = () => {
    const totalPages = Math.ceil((filteredClients.length || allClients.length) / clientPageSize);
    if (currentClientPage < totalPages) {
      currentClientPage++;
      renderClientsTable();
    }
  };
}

// ============================
// LOAD CLIENTS
// ============================

async function loadClients() {
  try {
    const company = localStorage.getItem("company");
    const res = await fetch(`${API}/clients/${company}`);
    const data = await res.json();

    if (!Array.isArray(data)) {
      console.error("Error cargando clientes:", data);
      return;
    }

    allClients = data;
    filteredClients = data.slice();
    currentClientPage = 1;
    renderClientsTable();
  } catch (err) {
    console.error("Error en loadClients:", err);
  }
}

function renderClientsTable() {
  const tbody = document.getElementById("clientsBody");
  tbody.innerHTML = "";

  const source = filteredClients.length ? filteredClients : allClients;
  const totalPages = Math.max(1, Math.ceil(source.length / clientPageSize));
  const start = (currentClientPage - 1) * clientPageSize;
  const items = source.slice(start, start + clientPageSize);

  items.forEach(c => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${c.idType || ""}</td>
      <td>${c.idNumber || ""}</td>
      <td>${c.razonSocial || ""}</td>
      <td>${c.nombreComercial || ""}</td>
      <td>${c.ciudad || ""}</td>
      <td>${c.email || ""}</td>
      <td>${c.telefono || ""}</td>
      <td>${c.celular || ""}</td>
    `;
    tr.onclick = () => selectClientRow(tr, c.id);
    tbody.appendChild(tr);
  });

  document.getElementById("clientPageInfo").textContent =
    `${currentClientPage} / ${totalPages}`;
}

// ============================
// CLIENT SELECTION
// ============================

function selectClientRow(tr, id) {
  selectedClientId = id;
  document.querySelectorAll("#clientsBody tr").forEach(r => {
    r.classList.remove("selected-row");
  });
  tr.classList.add("selected-row");
}

// ============================
// FORM
// ============================

function clearClientForm() {
  editingClientId = null;
  selectedClientId = null;

  [
    "clientType",
    "clientIdNumber",
    "clientRazonSocial",
    "clientNombreCom",
    "clientCiudad",
    "clientDireccion",
    "clientEmail",
    "clientTelefono",
    "clientCelular"
  ].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = "";
  });

  document.querySelectorAll("#clientsBody tr").forEach(r =>
    r.classList.remove("selected-row")
  );
}

async function saveClient() {
  const company = localStorage.getItem("company");

  const payload = {
    idType: document.getElementById("clientType")?.value,
    idNumber: document.getElementById("clientIdNumber")?.value.trim(),
    razonSocial: document.getElementById("clientRazonSocial")?.value.trim(),
    nombreComercial: document.getElementById("clientNombreCom")?.value.trim(),
    ciudad: document.getElementById("clientCiudad")?.value.trim(),
    direccion: document.getElementById("clientDireccion")?.value.trim(),
    email: document.getElementById("clientEmail")?.value.trim(),
    telefono: document.getElementById("clientTelefono")?.value.trim(),
    celular: document.getElementById("clientCelular")?.value.trim()
  };

  if (!payload.idNumber || !payload.razonSocial) {
    alert("Identificación y Razón social son obligatorias.");
    return;
  }

  const isEdit = !!editingClientId;
  const url = isEdit
    ? `${API}/clients/${company}/${editingClientId}`
    : `${API}/clients/${company}`;
  const method = isEdit ? "PUT" : "POST";

  try {
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const data = await res.json();
      alert(data?.error || "Error al guardar cliente.");
      return;
    }

    clearClientForm();
    await loadClients();
  } catch (err) {
    console.error("Error guardando cliente:", err);
    alert("No se pudo guardar el cliente.");
  }
}

function startEditClient() {
  if (!selectedClientId) {
    alert("Selecciona un cliente en la tabla.");
    return;
  }

  const client = allClients.find(c => c.id === selectedClientId);
  if (!client) return;

  editingClientId = client.id;

  document.getElementById("clientType").value = client.idType || "";
  document.getElementById("clientIdNumber").value = client.idNumber || "";
  document.getElementById("clientRazonSocial").value = client.razonSocial || "";
  document.getElementById("clientNombreCom").value = client.nombreComercial || "";
  document.getElementById("clientCiudad").value = client.ciudad || "";
  document.getElementById("clientDireccion").value = client.direccion || "";
  document.getElementById("clientEmail").value = client.email || "";
  document.getElementById("clientTelefono").value = client.telefono || "";
  document.getElementById("clientCelular").value = client.celular || "";
}

async function deleteSelectedClient() {
  if (!selectedClientId) {
    alert("Selecciona un cliente.");
    return;
  }

  if (!confirm("¿Seguro que deseas eliminar este cliente?")) return;

  const company = localStorage.getItem("company");

  try {
    const res = await fetch(`${API}/clients/${company}/${selectedClientId}`, {
      method: "DELETE"
    });

    if (!res.ok) {
      const data = await res.json();
      alert(data?.error || "Error al eliminar cliente.");
      return;
    }

    selectedClientId = null;
    editingClientId = null;
    await loadClients();
  } catch (err) {
    console.error("Error al eliminar cliente:", err);
    alert("No se pudo eliminar el cliente.");
  }
}

// ============================
// SEARCH FILTER
// ============================

function initClientFilters() {
  const search = document.getElementById("clientSearch");
  if (!search) return;

  search.addEventListener("input", () => {
    const q = search.value.trim().toLowerCase();

    if (!q) {
      filteredClients = allClients.slice();
    } else {
      filteredClients = allClients.filter(c =>
        Object.values(c).some(val =>
          String(val).toLowerCase().includes(q)
        )
      );
    }

    currentClientPage = 1;
    renderClientsTable();
  });
}
