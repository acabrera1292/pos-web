async function loadInventory() {
  const company = localStorage.getItem("company");
  const data = await request(`/inventory/${company}`);
  renderInventoryTable(data);
}


async function addOrUpdateProduct(event) {
  event.preventDefault();
  const company = localStorage.getItem("company");

  const id = document.getElementById("productId").value;
  const code = document.getElementById("prodCode").value;
  const name = document.getElementById("prodName").value;
  const quantity = parseInt(document.getElementById("prodQty").value);
  const price = parseFloat(document.getElementById("prodPrice").value);

  if (!code || !name || !quantity || !price) {
    return alert("Todos los campos son obligatorios.");
  }

  const product = { code, name, quantity, price, company };

  if (id) {
    await request(`/inventory/edit/${id}`, "PUT", product);
  } else {
    await request("/inventory/add", "POST", product);
  }

  clearForm();
  loadInventory();
}

function clearForm() {
  document.getElementById("productId").value = "";
  document.getElementById("productForm").reset();
}

function editProduct(prod) {
  document.getElementById("productId").value = prod.id;
  document.getElementById("prodCode").value = prod.code;
  document.getElementById("prodName").value = prod.name;
  document.getElementById("prodQty").value = prod.quantity;
  document.getElementById("prodPrice").value = prod.price;
}

async function deleteProduct(id) {
  if (confirm("¿Eliminar este producto?")) {
    await request(`/inventory/delete/${id}`, "DELETE");
    loadInventory();
  }
}

document.getElementById("productForm").addEventListener("submit", addOrUpdateProduct);

function searchInventory() {
  const term = document.getElementById('searchInput').value.toLowerCase();
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

window.saveSettings = saveSettings;
window.loadSettings = loadSettings;


