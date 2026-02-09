// ============================
// VENTAS MODULE
// ============================

const API = "https://pos-api-yvoj.onrender.com";
let allSales = [];
let filteredSales = [];

export function initVentas() {
  const container = document.getElementById("ventas");
  if (!container) return;

  container.innerHTML = `
    <h2>Ventas</h2>

    <div class="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Fecha</th>
            <th>Código</th>
            <th>Nombre</th>
            <th>Cant.</th>
            <th>Precio</th>
            <th>Total</th>
            <th>Tipo</th>
          </tr>
        </thead>
        <tbody id="salesBody"></tbody>
      </table>
    </div>

    <button id="btnLoadSales">Cargar ventas</button>

    <h3>Resumen</h3>
    <p>Rango: <span id="summaryLabel">Sin datos</span></p>
    <p>Total vendido: $<span id="summaryTotal">0.00</span></p>
    <p>Número de líneas: <span id="summaryCount">0</span></p>
  `;

  loadSales();
  bindVentasEvents();
  initSalesFilterPanel();
}

// ============================
// EVENTS
// ============================

function bindVentasEvents() {
  document.getElementById("btnLoadSales").onclick = loadSales;
}

function initSalesFilterPanel() {
  const from = document.getElementById("fromDate");
  const to = document.getElementById("toDate");
  const apply = document.querySelector("#salesFilters button:nth-child(3)");
  const clear = document.querySelector("#salesFilters button:nth-child(4)");
  const exportBtn = document.querySelector("#salesFilters button:nth-child(5)");

  if (apply) apply.onclick = filterSalesByDate;
  if (clear) clear.onclick = clearSalesFilter;
  if (exportBtn) exportBtn.onclick = exportSales;
}

// ============================
// LOAD SALES
// ============================

async function loadSales() {
  const company = localStorage.getItem("company");
  const res = await fetch(`${API}/sales/${company}`);
  const data = await res.json();

  if (!Array.isArray(data)) {
    console.error("Error cargando ventas:", data);
    return;
  }

  allSales = data;

  // Set default filter to today
  const today = new Date().toISOString().split("T")[0];
  const fromInput = document.getElementById("fromDate");
  const toInput = document.getElementById("toDate");
  if (fromInput) fromInput.value = today;
  if (toInput) toInput.value = today;

  filterSalesByDate();
}

// ============================
// RENDER
// ============================

function renderSalesTable(list) {
  const tbody = document.getElementById("salesBody");
  tbody.innerHTML = "";

  list.forEach(s => {
    const date = s.date ? new Date(s.date).toLocaleString() : "";
    const tipo = s.paymentType || "Efectivo";
    const row = `
      <tr>
        <td>${date}</td>
        <td>${s.code}</td>
        <td>${s.name}</td>
        <td>${s.quantity}</td>
        <td>$${Number(s.price).toFixed(2)}</td>
        <td>$${Number(s.total).toFixed(2)}</td>
        <td>${tipo}</td>
      </tr>
    `;
    tbody.innerHTML += row;
  });
}

// ============================
// FILTER / SUMMARY
// ============================

function filterSalesByDate() {
  if (!Array.isArray(allSales) || !allSales.length) {
    document.getElementById("summaryLabel").innerText = "Sin datos";
    document.getElementById("summaryTotal").innerText = "0.00";
    document.getElementById("summaryCount").innerText = "0";
    renderSalesTable([]);
    return;
  }

  const fromVal = document.getElementById("fromDate").value;
  const toVal = document.getElementById("toDate").value;

  const fromDate = fromVal ? new Date(`${fromVal}T00:00:00`) : null;
  const toDate = toVal ? new Date(`${toVal}T23:59:59`) : null;

  filteredSales = allSales.filter(s => {
    const d = new Date(s.date);
    if (isNaN(d)) return false;
    if (fromDate && d < fromDate) return false;
    if (toDate && d > toDate) return false;
    return true;
  });

  const total = filteredSales.reduce((sum, s) => sum + Number(s.total || 0), 0);
  const label = (fromVal || toVal) ? `${fromVal || "..."} → ${toVal || "..."}` : "Todo";

  document.getElementById("summaryLabel").innerText = label;
  document.getElementById("summaryTotal").innerText = total.toFixed(2);
  document.getElementById("summaryCount").innerText = String(filteredSales.length);

  renderSalesTable(filteredSales);
}

function clearSalesFilter() {
  document.getElementById("fromDate").value = "";
  document.getElementById("toDate").value = "";

  filteredSales = allSales.slice();

  const total = allSales.reduce((sum, s) => sum + Number(s.total || 0), 0);

  document.getElementById("summaryLabel").innerText = "Todo";
  document.getElementById("summaryTotal").innerText = total.toFixed(2);
  document.getElementById("summaryCount").innerText = String(allSales.length);

  renderSalesTable(allSales);
}

// ============================
// EXPORT
// ============================

function exportSales() {
  const list = filteredSales.length ? filteredSales : allSales;
  if (!list.length) {
    alert("No hay ventas para exportar.");
    return;
  }

  const rows = [["fecha","hora","codigo","nombre","cantidad","precio","total","tipo_pago"]];

  list.forEach(s => {
    let fecha = "", hora = "";
    if (s.date) {
      const d = new Date(s.date);
      if (!isNaN(d)) {
        fecha = d.toLocaleDateString();
        hora = d.toLocaleTimeString();
      }
    }

    rows.push([
      fecha,
      hora,
      s.code,
      s.name,
      s.quantity,
      Number(s.price).toFixed(2),
      Number(s.total).toFixed(2),
      s.paymentType || "Efectivo"
    ]);
  });

  const csv = rows.map(r => r.join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");

  a.href = url;
  a.download = "ventas.csv";
  a.click();

  URL.revokeObjectURL(url);
}
