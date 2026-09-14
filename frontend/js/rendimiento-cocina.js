(function () {
  let kitchenPerformance = { summary: {}, products: [], hours: [], orders: [], targetMinutes: 20 };

  function headers() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }

  function localDateValue(date) {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 10);
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("es-EC", { dateStyle: "short", timeStyle: "short" });
  }

  function renderEmptyRow(body, columns, message) {
    body.innerHTML = `<tr><td colspan="${columns}" class="empty-table">${escapeHtml(message)}</td></tr>`;
  }

  function renderKitchenPerformance() {
    const summary = kitchenPerformance.summary || {};
    document.getElementById("performanceOrderCount").textContent = summary.orders || 0;
    document.getElementById("performanceItemCount").textContent = summary.items || 0;
    document.getElementById("performanceWaitAverage").textContent = summary.averageWaitMinutes || 0;
    document.getElementById("performancePrepAverage").textContent = summary.averagePreparationMinutes || 0;
    document.getElementById("performanceTotalAverage").textContent = summary.averageTotalMinutes || 0;
    document.getElementById("performanceOnTime").textContent = summary.onTimePercent || 0;
    document.getElementById("performanceTargetLabel").textContent = `Listos en ${kitchenPerformance.targetMinutes || 20} min`;

    const productsBody = document.getElementById("performanceProductsBody");
    if (kitchenPerformance.products.length) {
      productsBody.innerHTML = kitchenPerformance.products.map(product => `<tr><td>${escapeHtml(product.name)}</td><td>${product.quantity}</td><td>${product.orderCount}</td><td>${product.averageMinutes} min</td></tr>`).join("");
    } else renderEmptyRow(productsBody, 4, "No hay productos en este período.");

    const hoursBody = document.getElementById("performanceHoursBody");
    if (kitchenPerformance.hours.length) {
      hoursBody.innerHTML = kitchenPerformance.hours.map(hour => `<tr><td>${escapeHtml(hour.hour)}</td><td>${hour.orders}</td><td>${hour.items}</td><td>${hour.averageMinutes} min</td></tr>`).join("");
    } else renderEmptyRow(hoursBody, 4, "No hay horas para analizar.");

    const ordersBody = document.getElementById("performanceOrdersBody");
    if (kitchenPerformance.orders.length) {
      ordersBody.innerHTML = kitchenPerformance.orders.map(order => {
        const items = order.items.map(item => `${item.quantity}× ${item.name}`).join(" · ");
        return `<tr><td>#${order.id}</td><td>${escapeHtml(order.tableName)}</td><td>${escapeHtml(order.serverName)}</td><td>${escapeHtml(formatDateTime(order.receivedAt))}</td><td>${escapeHtml(formatDateTime(order.startedAt))}</td><td>${escapeHtml(formatDateTime(order.readyAt))}</td><td>${order.waitingMinutes} min</td><td>${order.preparationMinutes} min</td><td>${order.totalMinutes} min</td><td>${escapeHtml(items)}</td></tr>`;
      }).join("");
    } else renderEmptyRow(ordersBody, 10, "No hay pedidos terminados en este período.");

    const from = document.getElementById("kitchenPerformanceFrom")?.value;
    const to = document.getElementById("kitchenPerformanceTo")?.value;
    document.getElementById("performanceRangeLabel").textContent = from || to ? `${from || "Inicio"} → ${to || "Hoy"}` : "Todas las fechas";
  }

  async function loadKitchenPerformance() {
    if (businessType !== "RESTAURANT" || userRole !== "Admin") return;
    try {
      const params = new URLSearchParams();
      const from = document.getElementById("kitchenPerformanceFrom")?.value;
      const to = document.getElementById("kitchenPerformanceTo")?.value;
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      const res = await fetch(`${API}/restaurant/kitchen/performance${params.size ? `?${params}` : ""}`, { headers: headers(), cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo cargar el rendimiento de cocina.");
      kitchenPerformance = {
        targetMinutes: Number(data.targetMinutes || 20),
        summary: data.summary || {},
        products: Array.isArray(data.products) ? data.products : [],
        hours: Array.isArray(data.hours) ? data.hours : [],
        orders: Array.isArray(data.orders) ? data.orders : []
      };
      renderKitchenPerformance();
    } catch (err) {
      alert(err.message);
    }
  }

  function clearActiveRangeButtons() {
    document.querySelectorAll("#kitchenPerformanceFilters .sales-quick-filters button").forEach(button => button.classList.remove("active"));
  }

  function setKitchenPerformanceRange(range, button) {
    const today = new Date();
    let from = new Date(today);
    if (range === "week") from.setDate(today.getDate() - 6);
    if (range === "month") from = new Date(today.getFullYear(), today.getMonth(), 1);
    document.getElementById("kitchenPerformanceFrom").value = localDateValue(from);
    document.getElementById("kitchenPerformanceTo").value = localDateValue(today);
    clearActiveRangeButtons();
    if (button) button.classList.add("active");
    loadKitchenPerformance();
  }

  function applyKitchenPerformanceFilters() {
    const from = document.getElementById("kitchenPerformanceFrom").value;
    const to = document.getElementById("kitchenPerformanceTo").value;
    if (from && to && from > to) return alert("La fecha Desde no puede ser posterior a Hasta.");
    clearActiveRangeButtons();
    loadKitchenPerformance();
  }

  function clearKitchenPerformanceFilters() {
    document.getElementById("kitchenPerformanceFrom").value = "";
    document.getElementById("kitchenPerformanceTo").value = "";
    clearActiveRangeButtons();
    loadKitchenPerformance();
  }

  function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function exportKitchenPerformance() {
    if (!kitchenPerformance.orders.length) return alert("No hay pedidos terminados para exportar.");
    const headings = ["Pedido", "Mesa", "Mesero", "Clientes", "Estado", "Recibido", "Inicio preparación", "Listo", "Espera min", "Preparación min", "Total cocina min", "Código", "Producto", "Cantidad"];
    const rows = [];
    kitchenPerformance.orders.forEach(order => {
      const items = order.items.length ? order.items : [{ code: "", name: "", quantity: 0 }];
      items.forEach(item => rows.push([
        order.id, order.tableName, order.serverName, order.guests, order.orderStatus,
        order.receivedAt, order.startedAt, order.readyAt, order.waitingMinutes,
        order.preparationMinutes, order.totalMinutes, item.code, item.name, item.quantity
      ]));
    });
    const csv = [headings, ...rows].map(row => row.map(csvCell).join(",")).join("\r\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    const from = document.getElementById("kitchenPerformanceFrom").value || "inicio";
    const to = document.getElementById("kitchenPerformanceTo").value || "hoy";
    link.download = `rendimiento-cocina-${from}-${to}.csv`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  window.loadKitchenPerformance = loadKitchenPerformance;
  window.setKitchenPerformanceRange = setKitchenPerformanceRange;
  window.applyKitchenPerformanceFilters = applyKitchenPerformanceFilters;
  window.clearKitchenPerformanceFilters = clearKitchenPerformanceFilters;
  window.exportKitchenPerformance = exportKitchenPerformance;
})();
