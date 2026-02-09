import { request } from './api.js';

export async function initInventario() {
  const el = document.getElementById("tab-content");
  el.innerHTML = `
    <h2>INVENTARIO</h2>

    <input type="text" id="searchInput" placeholder="Buscar por código o nombre" />

    <div>
      <button id="btnLowStock">Ver solo bajo stock</button>
      <button id="btnShowAll">Ver todo</button>
    </div>

    <form id="productForm">
      <input type="hidden" id="productId" />
      <input type="text" id="prodCode" placeholder="Código" required />
      <input type="text" id="prodName" placeholder="Nombre" required />
      <input type="number" id="prodQty" placeholder="Cantidad" required />
      <input type="number" id="prodPrice" placeholder="Precio" required />
      <button type="submit">Guardar</button>
    </form>

    <table id="inventoryTable">
      <thead>
        <tr>
          <th>Código</th>
          <th>Nombre</th>
          <th>Cantidad</th>
          <th>Precio</th>
          <th>Acciones</th>
        </tr>
      </thead>
      <tbody></tbody>
    </table>

    <div>
      <h3>Configuración</h3>
      <label>Stock mínimo:</label>
      <input type="number" id="lowThreshold" />
      <button id="btnSaveThreshold">Guardar</button>
    </div>
  `;

  bindInventoryEvents();
  await loadInventory();
  await loadSettings();
}

async function loadInventory() {
  const company = localStorage.getItem("company");
  const data = await request(`/inventory/${company}`);
  renderInventoryTable(data);
}

function renderInventoryTable(products) {
  const tbody = document.querySelector("#inventoryTable tbody");
  tbody.innerHTML = "";
  for (const p of products) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${p.code}</td>
      <td>${p.name}</td>
      <td>${p.quantity}</td>
      <td>${p.price.toFixed(2)}</td>
      <td>
        <button onclick='editProduct(${JSON.stringify(p)})'>✏️</button>
        <button onclick='deleteProduct("${p.id}")'>🗑️</button>
      </td>
    `;
    tbody.appendChild(row);
  }
}

async function addOrUpdateProduct(e) {
  e.preventDefault();
  const company = localStorage.getItem("company");
  const id = document.getElementById("productId").value;
  const code = document.getElementById("prodCode").value;
  const name = document.getElementById("prodName").value;
  const quantity = +document.getElementById("prodQty").value;
  const price = +document.getElementById("prodPrice").value;

  if (!code || !name || !quantity || !price) {
    return alert("Todos los campos son obligatorios.");
  }

  const data = { code, name, quantity, price, company };

  if (id) await request(`/inventory/edit/${id}`, "PUT", data);
  else await request("/inventory/add", "POST", data);

  clearForm();
  await loadInventory();
}

function clearForm() {
  document.getElementById("productId").value = "";
  document.getElementById("productForm").reset();
}

window.editProduct = function(prod) {
  document.getElementById("productId").value = prod.id;
  document.getElementById("prodCode").value = prod.code;
  document.getElementById("prodName").value = prod.name;
  document.getElementById("prodQty").value = prod.quantity;
  document.getElementById("prodPrice").value = prod.price;
};

window.deleteProduct = async function(id) {
  if (confirm("¿Eliminar este producto?")) {
    await request(`/inventory/delete/${id}`, "DELETE");
    await loadInventory();
  }
};

function searchInventory() {
  const term = document.getElementById("searchInput").value.toLowerCase();
  const rows = document.querySelectorAll("#inventoryTable tbody tr");

  rows.forEach(row => {
    const text = row.textContent.toLowerCase();
    row.style.display = text.includes(term) ? "" : "none";
  });
}

function filterLowInventory() {
  const threshold = parseInt(localStorage.getItem("lowThreshold") || 10);
  const rows = document.querySelectorAll("#inventoryTable tbody tr");

  rows.forEach(row => {
    const qty = parseInt(row.children[2].textContent);
    row.style.display = qty <= threshold ? "" : "none";
  });
}

async function loadSettings() {
  const company = localStorage.getItem("company");
  const res = await request(`/settings/${company}`);
  document.getElementById("lowThreshold").value = res?.low_threshold || 10;
  localStorage.setItem("lowThreshold", res?.low_threshold || 10);
}

async function saveSettings() {
  const company = localStorage.getItem("company");
  const val = parseInt(document.getElementById("lowThreshold").value);
  localStorage.setItem("lowThreshold", val);
  await request("/settings/save", "POST", { company, low_threshold: val });
  alert("Configuración guardada");
}

function bindInventoryEvents() {
  document.getElementById("productForm")?.addEventListener("submit", addOrUpdateProduct);
  document.getElementById("searchInput")?.addEventListener("input", searchInventory);
  document.getElementById("btnLowStock")?.addEventListener("click", filterLowInventory);
  document.getElementById("btnShowAll")?.addEventListener("click", loadInventory);
  document.getElementById("btnSaveThreshold")?.addEventListener("click", saveSettings);
}
