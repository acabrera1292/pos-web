(function () {
  let kitchenOrders = [];
  let kitchenRefresh = null;
  let kitchenTimer = null;
  let kitchenUpdating = false;

  function headers() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>'"]/g, char => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
    })[char]);
  }

  function elapsedText(value, endValue = "") {
    if (!value) return "0 min";
    const end = endValue ? new Date(endValue).getTime() : Date.now();
    const milliseconds = end - new Date(value).getTime();
    if (!Number.isFinite(milliseconds)) return "0 min";
    const minutes = Math.max(0, Math.floor(milliseconds / 60000));
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  }

  function timerHtml(order) {
    if (order.kitchenStatus === "NEW") {
      return `<span data-kitchen-time="${escapeHtml(order.kitchenReceivedAt)}" data-kitchen-label="Esperando">Esperando: ${elapsedText(order.kitchenReceivedAt)}</span>`;
    }
    const end = order.kitchenStatus === "READY" ? order.kitchenReadyAt : "";
    const cookingLabel = order.kitchenStatus === "READY" ? "Preparación" : "Cocinando";
    return `<span data-kitchen-time="${escapeHtml(order.kitchenStartedAt)}" data-kitchen-end="${escapeHtml(end)}" data-kitchen-label="${cookingLabel}">${cookingLabel}: ${elapsedText(order.kitchenStartedAt, end)}</span>
      <small data-kitchen-time="${escapeHtml(order.kitchenReceivedAt)}" data-kitchen-end="${escapeHtml(end)}" data-kitchen-label="Total cocina">Total cocina: ${elapsedText(order.kitchenReceivedAt, end)}</small>`;
  }

  function statusInfo(status) {
    if (status === "COOKING") return { label: "Cocinando", className: "cooking" };
    if (status === "READY") return { label: "Listo", className: "ready" };
    return { label: "Nuevo", className: "new" };
  }

  function modifierText(item) {
    return (Array.isArray(item.selectedModifiers) ? item.selectedModifiers : []).flatMap(selection =>
      (selection.options || []).map(option => `${selection.group}: ${option.name}`)
    ).join(" · ");
  }

  function renderKitchenSummary() {
    const summary = new Map();
    kitchenOrders
      .filter(order => order.kitchenStatus !== "READY")
      .forEach(order => order.items.forEach(item => {
        const label = [item.name, modifierText(item)].filter(Boolean).join(" — ");
        const current = summary.get(label) || 0;
        summary.set(label, current + Number(item.quantity || 0));
      }));
    const container = document.getElementById("kitchenProductSummary");
    const empty = document.getElementById("kitchenProductSummaryEmpty");
    if (!container || !empty) return;
    container.innerHTML = Array.from(summary.entries())
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "es"))
      .map(([name, quantity]) => `<span class="kitchen-summary-item"><strong>${quantity}×</strong> ${escapeHtml(name)}</span>`)
      .join("");
    empty.classList.toggle("hidden", summary.size > 0);
  }

  function renderKitchenOrders() {
    const board = document.getElementById("kitchenBoard");
    const empty = document.getElementById("kitchenEmpty");
    if (!board || !empty) return;
    const counts = { NEW: 0, COOKING: 0, READY: 0 };
    kitchenOrders.forEach(order => { counts[order.kitchenStatus] = (counts[order.kitchenStatus] || 0) + 1; });
    document.getElementById("kitchenNewCount").textContent = counts.NEW || 0;
    document.getElementById("kitchenCookingCount").textContent = counts.COOKING || 0;
    document.getElementById("kitchenReadyCount").textContent = counts.READY || 0;
    board.innerHTML = kitchenOrders.map(order => {
      const info = statusInfo(order.kitchenStatus);
      const items = order.items.map(item => {
        const notes = [modifierText(item), item.note, item.discountPercent ? `${item.discountPercent}% desc.${item.discountReason ? ` · ${item.discountReason}` : ""}` : ""]
          .filter(Boolean).map(note => `<small>${escapeHtml(note)}</small>`).join("");
        return `<li><strong>${Number(item.quantity)}×</strong><span>${escapeHtml(item.name)}${notes}</span></li>`;
      }).join("");
      const action = order.kitchenStatus === "NEW"
        ? `<button type="button" onclick="changeKitchenOrderStatus(${order.id}, 'START')">Iniciar preparación</button>`
        : order.kitchenStatus === "COOKING"
          ? `<button type="button" onclick="changeKitchenOrderStatus(${order.id}, 'READY')">Marcar listo</button>`
          : `<strong class="kitchen-ready-message">Listo para servir</strong>`;
      return `<article class="kitchen-ticket ${info.className}">
        <header><div><strong>${escapeHtml(order.tableName)}</strong><span>Pedido #${order.id}</span></div><span class="kitchen-status">${info.label}</span></header>
        <div class="kitchen-ticket-meta"><span>${Number(order.guests)} cliente${Number(order.guests) === 1 ? "" : "s"}</span><span>${escapeHtml(order.serverName || "Sin mesero")}</span></div>
        <div class="kitchen-timer">${timerHtml(order)}</div>
        <ul>${items}</ul><footer>${action}</footer></article>`;
    }).join("");
    empty.classList.toggle("hidden", kitchenOrders.length > 0);
    renderKitchenSummary();
  }

  function updateKitchenTimers() {
    document.querySelectorAll("[data-kitchen-time]").forEach(element => {
      element.textContent = `${element.dataset.kitchenLabel}: ${elapsedText(element.dataset.kitchenTime, element.dataset.kitchenEnd)}`;
    });
  }

  async function loadKitchenOrders(silent = false) {
    if (businessType !== "RESTAURANT" || kitchenUpdating) return;
    try {
      const res = await fetch(`${API}/restaurant/kitchen/orders`, { headers: headers(), cache: "no-store" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo cargar Cocina.");
      kitchenOrders = Array.isArray(data) ? data : [];
      renderKitchenOrders();
    } catch (err) {
      if (!silent) alert(err.message);
    }
  }

  async function changeKitchenOrderStatus(id, status) {
    if (kitchenUpdating) return;
    kitchenUpdating = true;
    try {
      const res = await fetch(`${API}/restaurant/kitchen/orders/${id}/status`, {
        method: "PUT",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ status })
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "No se pudo actualizar el pedido.");
      await loadKitchenOrders();
      if (typeof window.loadRestaurantTables === "function") window.loadRestaurantTables(true);
    } catch (err) {
      alert(err.message);
    } finally {
      kitchenUpdating = false;
      await loadKitchenOrders(true);
    }
  }

  function initializeKitchen() {
    clearInterval(kitchenRefresh);
    clearInterval(kitchenTimer);
    kitchenRefresh = setInterval(() => {
      if (businessType === "RESTAURANT" && !document.getElementById("cocina")?.classList.contains("hidden")) {
        loadKitchenOrders(true);
      }
    }, 5000);
    kitchenTimer = setInterval(updateKitchenTimers, 1000);
  }

  window.initializeKitchen = initializeKitchen;
  window.loadKitchenOrders = loadKitchenOrders;
  window.changeKitchenOrderStatus = changeKitchenOrderStatus;
})();
