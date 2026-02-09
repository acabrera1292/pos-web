// ============================
// PUNTO DE VENTA MODULE
// ============================

const API = "https://pos-api-yvoj.onrender.com";

let cart = [];
let allProducts = [];

export function initPOS() {
  const container = document.getElementById("pos");
  if (!container) return;

  container.innerHTML = `
    <h2>Punto de Venta</h2>

    <div>
      <label>Código de producto:</label>
      <input id="posCode" placeholder="Escanear o escribir código">
      <button id="btnAddToCart">Agregar</button>
    </div>

    <h3>Carrito</h3>

    <div class="table-scroll">
      <table border="1">
        <thead>
          <tr>
            <th>Código</th>
            <th>Nombre</th>
            <th>Cant.</th>
            <th>Precio</th>
            <th>Subtotal</th>
            <th>Acciones</th>
          </tr>
        </thead>
        <tbody id="cartBody"></tbody>
      </table>
    </div>

    <h3>Totales</h3>
    <p>Total: $<span id="cartTotal">0.00</span></p>

    <label>Tipo de pago:
      <select id="paymentType">
        <option value="Efectivo" selected>Efectivo</option>
        <option value="Tarjeta">Tarjeta</option>
      </select>
    </label>

    <br>

    <label>Efectivo recibido:</label>
    <input id="cashReceived" type="number" step="0.01">
    <p>Cambio: $<span id="changeDue">0.00</span></p>

    <button id="btnFinishSale">Finalizar venta</button>
  `;

  bindPOSHandlers();
  loadProductList(); // for scanning
}

// ============================
// EVENT BINDINGS
// ============================

function bindPOSHandlers() {
  document.getElementById("btnAddToCart").onclick = addToCartByCode;
  document.getElementById("btnFinishSale").onclick = finishSale;
  document.getElementById("cashReceived").oninput = updateChange;
}

// ============================
// LOAD INVENTORY
// ============================

async function loadProductList() {
  const company = localStorage.getItem("company");
  const res = await fetch(`${API}/products/${company}`);
  const data = await res.json();

  if (!Array.isArray(data)) {
    alert("Error cargando productos");
    return;
  }

  allProducts = data;
}

// ============================
// CART OPERATIONS
// ============================

function addToCartByCode() {
  const code = document.getElementById("posCode").value.trim();
  if (!code) return;

  const product = allProducts.find(p => String(p.code) === code);
  if (!product) {
    alert("Producto no encontrado");
    return;
  }

  addToCart(product);
  document.getElementById("posCode").value = "";
}

function addToCart(product) {
  const existing = cart.find(item => item.id === product.id);
  if (existing) {
    existing.quantity += 1;
  } else {
    cart.push({
      id: product.id,
      code: product.code,
      name: product.name,
      price: Number(product.price),
      quantity: 1
    });
  }

  renderCart();
}

function renderCart() {
  const tbody = document.getElementById("cartBody");
  tbody.innerHTML = "";

  cart.forEach((item, index) => {
    const subtotal = item.price * item.quantity;
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${item.code}</td>
      <td>${item.name}</td>
      <td>
        <input type="number" min="1" value="${item.quantity}"
               onchange="updateCartQty(${index}, this.value)">
      </td>
      <td>$${item.price.toFixed(2)}</td>
      <td>$${subtotal.toFixed(2)}</td>
      <td><button onclick="removeCartItem(${index})">Quitar</button></td>
    `;
    tbody.appendChild(tr);
  });

  updateTotal();
}

// Monkey-patch for onchange handler (DOM evals this inline)
window.updateCartQty = function(index, value) {
  const qty = Number(value);
  if (!qty || qty <= 0) return;
  cart[index].quantity = qty;
  renderCart();
};

window.removeCartItem = function(index) {
  cart.splice(index, 1);
  renderCart();
};

// ============================
// TOTALS & CHANGE
// ============================

function updateTotal() {
  const total = cart.reduce((sum, i) => sum + i.price * i.quantity, 0);
  document.getElementById("cartTotal").textContent = total.toFixed(2);
  updateChange();
}

function updateChange() {
  const total = Number(document.getElementById("cartTotal").textContent || 0);
  const cash = Number(document.getElementById("cashReceived").value || 0);
  const change = cash - total;
  document.getElementById("changeDue").textContent = change >= 0 ? change.toFixed(2) : "0.00";
}

// ============================
// FINALIZE SALE
// ============================

async function finishSale() {
  if (!cart.length) {
    alert("El carrito está vacío");
    return;
  }

  const total = Number(document.getElementById("cartTotal").textContent || 0);
  const cash = Number(document.getElementById("cashReceived").value || 0);
  const paymentType = document.getElementById("paymentType").value || "Efectivo";

  if (paymentType === "Efectivo" && cash < total) {
    alert("Efectivo insuficiente.");
    return;
  }

  const company = localStorage.getItem("company");

  await fetch(`${API}/sales/${company}`, {
    method: "POST",
    headers: {"Content-Type": "application/json"},
    body: JSON.stringify({
      items: cart,
      total,
      cash,
      paymentType
    })
  });

  cart = [];
  renderCart();
  document.getElementById("cashReceived").value = "";
  updateChange();
  alert("Venta registrada.");
  loadProductList(); // update stock
}
