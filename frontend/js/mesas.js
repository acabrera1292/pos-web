(function () {
  let restaurantTables = [];
  let restaurantServers = [];
  let restaurantTableHistory = [];
  let selectedRestaurantHistory = null;
  let selectedRestaurantServer = null;
  let selectedRestaurantTable = null;
  let restaurantTableRefresh = null;
  let restaurantTimerRefresh = null;

  function headers() {
    const token = localStorage.getItem("token");
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  function minutesSince(value) {
    if (!value) return 0;
    return Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 60000));
  }

  function formatDateTime(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("es-EC", { dateStyle: "short", timeStyle: "short" });
  }

  function renderServerSelect() {
    const select = document.getElementById("restaurantServerSelect");
    if (!select) return;
    const previous = select.value;
    const activeServers = restaurantServers.filter(server => Boolean(server.active));
    select.innerHTML = '<option value="">Sin mesero</option>';
    activeServers.forEach(server => {
      const option = document.createElement("option");
      option.value = server.id;
      option.textContent = server.name;
      select.appendChild(option);
    });
    if (activeServers.some(server => String(server.id) === previous)) select.value = previous;

    const historySelect = document.getElementById("restaurantHistoryServer");
    if (historySelect) {
      const historyPrevious = historySelect.value;
      historySelect.innerHTML = '<option value="">Todos</option>';
      restaurantServers.forEach(server => {
        const option = document.createElement("option");
        option.value = server.id;
        option.textContent = `${server.name}${server.active ? "" : " (inactivo)"}`;
        historySelect.appendChild(option);
      });
      if (restaurantServers.some(server => String(server.id) === historyPrevious)) historySelect.value = historyPrevious;
    }
  }

  function tableState(table) {
    if (!table.active) return { className: "inactive", label: "Inactiva" };
    if (table.sessionId && table.kitchenStatus === "READY" && Number(table.orderItemCount || 0)) return { className: "ready", label: "Comida lista" };
    if (table.sessionId && table.kitchenStatus === "COOKING") return { className: "cooking", label: "En cocina" };
    if (table.sessionId && table.kitchenStatus === "NEW" && Number(table.orderItemCount || 0)) return { className: "ordered", label: "Pedido enviado" };
    if (table.sessionId) return { className: "occupied", label: "Ocupada" };
    return { className: "available", label: "Disponible" };
  }

  function selectedStillExists() {
    if (!selectedRestaurantTable) return null;
    return restaurantTables.find(table => table.id === selectedRestaurantTable.id) || null;
  }

  function renderRestaurantTables() {
    const grid = document.getElementById("restaurantTablesGrid");
    const empty = document.getElementById("restaurantTablesEmpty");
    if (!grid || !empty) return;

    selectedRestaurantTable = selectedStillExists();
    grid.innerHTML = "";
    restaurantTables.forEach(table => {
      const state = tableState(table);
      const card = document.createElement("button");
      card.type = "button";
      card.className = `restaurant-table-card ${state.className}${selectedRestaurantTable?.id === table.id ? " selected" : ""}`;
      card.dataset.tableId = table.id;

      const name = document.createElement("strong");
      name.textContent = table.name;
      const status = document.createElement("span");
      status.className = "restaurant-table-status";
      status.textContent = state.label;
      const detail = document.createElement("span");
      detail.className = "restaurant-table-detail";
      detail.textContent = table.sessionId
        ? `${table.guests} cliente${Number(table.guests) === 1 ? "" : "s"} · ${minutesSince(table.openedAt)} min`
        : `Capacidad: ${table.capacity}`;
      const server = document.createElement("small");
      const orderItems = Number(table.orderItemCount || 0);
      server.textContent = table.sessionId
        ? `${orderItems ? `Pedido: ${orderItems} producto${orderItems === 1 ? "" : "s"} · ` : ""}Atiende: ${table.serverName}`
        : "";
      card.append(name, status, detail, server);
      card.addEventListener("click", () => selectRestaurantTable(table.id));
      grid.appendChild(card);
    });

    empty.classList.toggle("hidden", restaurantTables.length > 0);
    renderRestaurantTableSelection();
  }

  function renderRestaurantTableSelection() {
    const panel = document.getElementById("restaurantTableSelection");
    if (!panel) return;
    panel.classList.toggle("hidden", !selectedRestaurantTable);
    if (!selectedRestaurantTable) return;

    const table = selectedRestaurantTable;
    document.getElementById("selectedRestaurantTableName").textContent = table.name;
    document.getElementById("selectedRestaurantTableDetail").textContent = table.sessionId
      ? `${table.guests} cliente${Number(table.guests) === 1 ? "" : "s"} · ${minutesSince(table.openedAt)} min · ${table.serverName}${Number(table.orderItemCount || 0) ? ` · ${table.orderItemCount} producto${Number(table.orderItemCount) === 1 ? "" : "s"}` : ""}`
      : table.active ? `Disponible · capacidad ${table.capacity}` : "Mesa inactiva";

    document.getElementById("btnSeatRestaurantTable").classList.toggle("hidden", Boolean(table.sessionId) || !table.active);
    document.getElementById("btnOpenRestaurantOrder").classList.toggle("hidden", !table.sessionId);
    document.getElementById("restaurantSeatFields").classList.toggle("hidden", Boolean(table.sessionId) || !table.active);
    document.getElementById("btnCloseRestaurantTable").classList.toggle("hidden", !table.sessionId);
    document.getElementById("btnEditRestaurantTable").classList.toggle("hidden", userRole !== "Admin" || Boolean(table.sessionId));
    const deleteButton = document.getElementById("btnDeleteRestaurantTable");
    deleteButton.classList.toggle("hidden", userRole !== "Admin" || Boolean(table.sessionId));
    deleteButton.classList.toggle("danger-button", Boolean(table.active));
    deleteButton.textContent = table.active ? "Eliminar mesa" : "Activar mesa";
  }

  function selectRestaurantTable(id) {
    selectedRestaurantTable = restaurantTables.find(table => table.id === id) || null;
    renderRestaurantTables();
  }

  async function readResponse(res) {
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "No se pudo completar la operación.");
    return data;
  }

  async function loadRestaurantTables(silent = false) {
    if (businessType !== "RESTAURANT") return;
    try {
      const res = await fetch(`${API}/restaurant/tables`, { headers: headers(), cache: "no-store" });
      restaurantTables = await readResponse(res);
      renderRestaurantTables();
      if (!silent) {
        await loadRestaurantServers(true);
      }
    } catch (err) {
      if (!silent) alert(err.message);
    }
  }

  async function createRestaurantTable() {
    const nameInput = document.getElementById("restaurantTableName");
    const capacityInput = document.getElementById("restaurantTableCapacity");
    const name = nameInput.value.trim();
    const capacity = Number(capacityInput.value) || 4;
    if (!name) return alert("Escribe el nombre de la mesa.");
    try {
      const res = await fetch(`${API}/restaurant/tables`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ name, capacity })
      });
      await readResponse(res);
      nameInput.value = "";
      capacityInput.value = "4";
      await loadRestaurantTables();
    } catch (err) {
      alert(err.message);
    }
  }

  async function seatSelectedRestaurantTable() {
    if (!selectedRestaurantTable || selectedRestaurantTable.sessionId) return;
    const guests = Number(document.getElementById("restaurantGuestsInput")?.value);
    const restaurantServerId = Number(document.getElementById("restaurantServerSelect")?.value) || null;
    if (!Number.isInteger(guests) || guests < 1 || guests > 99) return alert("Ingresa una cantidad válida de clientes.");
    try {
      const res = await fetch(`${API}/restaurant/tables/${selectedRestaurantTable.id}/seat`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ guests, restaurantServerId })
      });
      await readResponse(res);
      await loadRestaurantTables();
    } catch (err) {
      alert(err.message);
    }
  }

  async function closeSelectedRestaurantTable() {
    if (!selectedRestaurantTable?.sessionId) return;
    if (!await appConfirm(`¿Liberar ${selectedRestaurantTable.name}? Se guardará el tiempo que estuvo ocupada.`)) return;
    try {
      const res = await fetch(`${API}/restaurant/tables/${selectedRestaurantTable.id}/close`, {
        method: "POST",
        headers: headers()
      });
      const result = await readResponse(res);
      await loadRestaurantTables();
      alert(`Mesa liberada. Duración: ${result.durationMinutes} min.`);
    } catch (err) {
      alert(err.message);
    }
  }

  async function openSelectedRestaurantOrder() {
    if (!selectedRestaurantTable?.sessionId) return;
    try {
      const res = await fetch(`${API}/restaurant/table-sessions/${selectedRestaurantTable.sessionId}/order`, {
        headers: headers(),
        cache: "no-store"
      });
      const order = await readResponse(res);
      await window.activateRestaurantOrder(order);
    } catch (err) {
      alert(err.message);
    }
  }

  async function loadRestaurantTableHistory(silent = false) {
    if (businessType !== "RESTAURANT") return;
    const tbody = document.getElementById("restaurantTableHistoryBody");
    if (!tbody) return;
    try {
      await loadRestaurantServers(true);
      const params = new URLSearchParams();
      const from = document.getElementById("restaurantHistoryFrom")?.value;
      const to = document.getElementById("restaurantHistoryTo")?.value;
      const serverId = document.getElementById("restaurantHistoryServer")?.value;
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (serverId) params.set("restaurantServerId", serverId);
      const query = params.toString();
      const res = await fetch(`${API}/restaurant/table-sessions${query ? `?${query}` : ""}`, { headers: headers(), cache: "no-store" });
      restaurantTableHistory = await readResponse(res);
      selectedRestaurantHistory = selectedRestaurantHistory
        ? restaurantTableHistory.find(session => String(session.id) === String(selectedRestaurantHistory.id)) || null
        : null;
      tbody.innerHTML = "";
      restaurantTableHistory.forEach(session => {
        const row = document.createElement("tr");
        row.dataset.sessionId = session.id;
        if (String(selectedRestaurantHistory?.id) === String(session.id)) row.classList.add("selected-row");
        [
          session.tableName || `Mesa ${session.tableId}`,
          session.serverName,
          session.guests,
          formatDateTime(session.openedAt),
          formatDateTime(session.closedAt),
          `${session.durationMinutes ?? 0} min`
        ].forEach(value => {
          const cell = document.createElement("td");
          cell.textContent = value;
          row.appendChild(cell);
        });
        row.addEventListener("click", () => {
          selectedRestaurantHistory = session;
          renderRestaurantTableHistory();
        });
        tbody.appendChild(row);
      });
      if (!restaurantTableHistory.length) tbody.innerHTML = '<tr><td colspan="6" class="empty-table">No hay atenciones con estos filtros.</td></tr>';
      renderRestaurantHistorySummary();
      updateRestaurantHistoryActions();
    } catch (err) {
      if (!silent) alert(err.message);
    }
  }

  function renderRestaurantTableHistory() {
    const tbody = document.getElementById("restaurantTableHistoryBody");
    if (!tbody) return;
    tbody.querySelectorAll("tr[data-session-id]").forEach(row => {
      row.classList.toggle("selected-row", String(row.dataset.sessionId) === String(selectedRestaurantHistory?.id));
    });
    updateRestaurantHistoryActions();
  }

  function updateRestaurantHistoryActions() {
    const actions = document.getElementById("restaurantHistoryAdminActions");
    const button = document.getElementById("btnDeleteRestaurantHistory");
    actions?.classList.toggle("hidden", userRole !== "Admin");
    if (button) button.disabled = userRole !== "Admin" || !selectedRestaurantHistory;
  }

  function renderRestaurantHistorySummary() {
    const durations = restaurantTableHistory.map(row => Number(row.durationMinutes) || 0);
    const totalGuests = restaurantTableHistory.reduce((sum, row) => sum + (Number(row.guests) || 0), 0);
    const average = durations.length ? Math.round(durations.reduce((sum, value) => sum + value, 0) / durations.length) : 0;
    document.getElementById("restaurantHistorySessions").textContent = restaurantTableHistory.length;
    document.getElementById("restaurantHistoryGuests").textContent = totalGuests;
    document.getElementById("restaurantHistoryAverage").textContent = average;
    document.getElementById("restaurantHistoryLongest").textContent = durations.length ? Math.max(...durations) : 0;
  }

  function applyRestaurantHistoryFilters() {
    const from = document.getElementById("restaurantHistoryFrom")?.value;
    const to = document.getElementById("restaurantHistoryTo")?.value;
    if (from && to && from > to) return alert("La fecha Desde no puede ser posterior a la fecha Hasta.");
    loadRestaurantTableHistory();
  }

  function clearRestaurantHistoryFilters() {
    document.getElementById("restaurantHistoryFrom").value = "";
    document.getElementById("restaurantHistoryTo").value = "";
    document.getElementById("restaurantHistoryServer").value = "";
    loadRestaurantTableHistory();
  }

  async function deleteSelectedRestaurantHistory() {
    if (userRole !== "Admin") return;
    if (!selectedRestaurantHistory) return alert("Selecciona una atención para eliminar.");
    const tableName = selectedRestaurantHistory.tableName || `Mesa ${selectedRestaurantHistory.tableId}`;
    if (!await appConfirm(`¿Eliminar la atención de ${tableName}? Esta acción no modifica las ventas.`)) return;
    try {
      const res = await fetch(`${API}/restaurant/table-sessions/${selectedRestaurantHistory.id}`, {
        method: "DELETE",
        headers: headers()
      });
      await readResponse(res);
      selectedRestaurantHistory = null;
      await loadRestaurantTableHistory();
    } catch (err) {
      alert(err.message);
    }
  }

  function csvCell(value) {
    return `"${String(value ?? "").replace(/"/g, '""')}"`;
  }

  function exportRestaurantHistory() {
    if (!restaurantTableHistory.length) return alert("No hay datos para exportar.");
    const rows = [["Mesa", "Mesero", "Clientes", "Inicio", "Fin", "Duración (minutos)"]];
    restaurantTableHistory.forEach(session => rows.push([
      session.tableName || `Mesa ${session.tableId}`,
      session.serverName,
      session.guests,
      formatDateTime(session.openedAt),
      formatDateTime(session.closedAt),
      session.durationMinutes ?? 0
    ]));
    const csv = rows.map(row => row.map(csvCell).join(",")).join("\n");
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "historial-atencion.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function renderRestaurantServers() {
    const tbody = document.getElementById("restaurantServersBody");
    if (!tbody) return;
    selectedRestaurantServer = selectedRestaurantServer
      ? restaurantServers.find(server => server.id === selectedRestaurantServer.id) || null
      : null;
    tbody.innerHTML = "";
    restaurantServers.forEach(server => {
      const row = document.createElement("tr");
      if (selectedRestaurantServer?.id === server.id) row.classList.add("selected");
      const name = document.createElement("td");
      const status = document.createElement("td");
      name.textContent = server.name;
      status.textContent = server.active ? "Activo" : "Inactivo";
      row.append(name, status);
      row.addEventListener("click", () => {
        selectedRestaurantServer = server;
        renderRestaurantServers();
      });
      tbody.appendChild(row);
    });
    if (!restaurantServers.length) tbody.innerHTML = '<tr><td colspan="2" class="empty-table">No hay meseros configurados.</td></tr>';

    const panel = document.getElementById("restaurantServerSelection");
    panel?.classList.toggle("hidden", !selectedRestaurantServer || userRole !== "Admin");
    if (selectedRestaurantServer) {
      document.getElementById("selectedRestaurantServerName").textContent = selectedRestaurantServer.name;
      document.getElementById("selectedRestaurantServerStatus").textContent = selectedRestaurantServer.active ? "Activo" : "Inactivo";
      const button = document.getElementById("btnToggleRestaurantServer");
      button.textContent = selectedRestaurantServer.active ? "Desactivar" : "Activar";
      button.classList.toggle("danger-button", Boolean(selectedRestaurantServer.active));
    }
    renderServerSelect();
  }

  async function loadRestaurantServers(silent = false) {
    if (businessType !== "RESTAURANT") return;
    try {
      const res = await fetch(`${API}/restaurant/servers`, { headers: headers(), cache: "no-store" });
      restaurantServers = await readResponse(res);
      renderRestaurantServers();
    } catch (err) {
      if (!silent) alert(err.message);
    }
  }

  async function createRestaurantServer() {
    if (userRole !== "Admin") return;
    const input = document.getElementById("restaurantServerName");
    const name = input.value.trim();
    if (!name) return alert("Escribe el nombre del mesero.");
    try {
      const res = await fetch(`${API}/restaurant/servers`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      await readResponse(res);
      input.value = "";
      await loadRestaurantServers();
    } catch (err) {
      alert(err.message);
    }
  }

  async function editSelectedRestaurantServer() {
    if (!selectedRestaurantServer || userRole !== "Admin") return;
    const name = await appPrompt("Nombre del mesero:", selectedRestaurantServer.name);
    if (name === null || !name.trim()) return;
    try {
      const res = await fetch(`${API}/restaurant/servers/${selectedRestaurantServer.id}`, {
        method: "PUT",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), active: Boolean(selectedRestaurantServer.active) })
      });
      await readResponse(res);
      await loadRestaurantServers();
    } catch (err) {
      alert(err.message);
    }
  }

  async function toggleSelectedRestaurantServer() {
    if (!selectedRestaurantServer || userRole !== "Admin") return;
    const active = !Boolean(selectedRestaurantServer.active);
    if (!await appConfirm(`¿${active ? "Activar" : "Desactivar"} a ${selectedRestaurantServer.name}?`)) return;
    try {
      const res = await fetch(`${API}/restaurant/servers/${selectedRestaurantServer.id}`, {
        method: "PUT",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ name: selectedRestaurantServer.name, active })
      });
      await readResponse(res);
      await loadRestaurantServers();
    } catch (err) {
      alert(err.message);
    }
  }

  async function editSelectedRestaurantTable() {
    if (!selectedRestaurantTable || userRole !== "Admin") return;
    if (selectedRestaurantTable.sessionId) return alert("Libera la mesa antes de editarla.");
    const name = await appPrompt("Nombre de la mesa:", selectedRestaurantTable.name);
    if (name === null) return;
    const capacityValue = await appPrompt("Capacidad de la mesa:", String(selectedRestaurantTable.capacity));
    if (capacityValue === null) return;
    const capacity = Number(capacityValue);
    if (!name.trim() || !Number.isInteger(capacity) || capacity < 1 || capacity > 30) return alert("Revisa el nombre y la capacidad.");
    try {
      const res = await fetch(`${API}/restaurant/tables/${selectedRestaurantTable.id}`, {
        method: "PUT",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), capacity, active: Boolean(selectedRestaurantTable.active) })
      });
      await readResponse(res);
      await loadRestaurantTables();
    } catch (err) {
      alert(err.message);
    }
  }

  async function deleteSelectedRestaurantTable() {
    if (!selectedRestaurantTable || userRole !== "Admin") return;
    if (selectedRestaurantTable.sessionId) return alert("No puedes eliminar una mesa ocupada.");
    if (!selectedRestaurantTable.active) {
      try {
        const res = await fetch(`${API}/restaurant/tables/${selectedRestaurantTable.id}`, {
          method: "PUT",
          headers: { ...headers(), "Content-Type": "application/json" },
          body: JSON.stringify({ name: selectedRestaurantTable.name, capacity: selectedRestaurantTable.capacity, active: true })
        });
        await readResponse(res);
        await loadRestaurantTables();
      } catch (err) {
        alert(err.message);
      }
      return;
    }
    if (!await appConfirm(`¿Eliminar ${selectedRestaurantTable.name}? Si tiene historial, quedará inactiva para conservar sus datos.`)) return;
    try {
      const res = await fetch(`${API}/restaurant/tables/${selectedRestaurantTable.id}`, {
        method: "DELETE",
        headers: headers()
      });
      await readResponse(res);
      selectedRestaurantTable = null;
      await loadRestaurantTables();
    } catch (err) {
      alert(err.message);
    }
  }

  function initializeRestaurantTables() {
    const admin = document.getElementById("restaurantTableAdmin");
    if (admin) admin.classList.toggle("hidden", userRole !== "Admin");
    clearInterval(restaurantTableRefresh);
    clearInterval(restaurantTimerRefresh);
    restaurantTableRefresh = setInterval(() => {
      if (businessType === "RESTAURANT" && !document.getElementById("mesas")?.classList.contains("hidden")) {
        loadRestaurantTables(true);
      }
    }, 15000);
    restaurantTimerRefresh = setInterval(() => {
      if (selectedRestaurantTable || restaurantTables.some(table => table.sessionId)) renderRestaurantTables();
    }, 60000);
  }

  function initializeRestaurantServers() {
    const admin = document.getElementById("restaurantServerAdmin");
    if (admin) admin.classList.toggle("hidden", userRole !== "Admin");
  }

  window.initializeRestaurantTables = initializeRestaurantTables;
  window.initializeRestaurantServers = initializeRestaurantServers;
  window.loadRestaurantTables = loadRestaurantTables;
  window.loadRestaurantTableHistory = loadRestaurantTableHistory;
  window.applyRestaurantHistoryFilters = applyRestaurantHistoryFilters;
  window.clearRestaurantHistoryFilters = clearRestaurantHistoryFilters;
  window.exportRestaurantHistory = exportRestaurantHistory;
  window.deleteSelectedRestaurantHistory = deleteSelectedRestaurantHistory;
  window.loadRestaurantServers = loadRestaurantServers;
  window.createRestaurantTable = createRestaurantTable;
  window.createRestaurantServer = createRestaurantServer;
  window.seatSelectedRestaurantTable = seatSelectedRestaurantTable;
  window.closeSelectedRestaurantTable = closeSelectedRestaurantTable;
  window.openSelectedRestaurantOrder = openSelectedRestaurantOrder;
  window.editSelectedRestaurantTable = editSelectedRestaurantTable;
  window.deleteSelectedRestaurantTable = deleteSelectedRestaurantTable;
  window.editSelectedRestaurantServer = editSelectedRestaurantServer;
  window.toggleSelectedRestaurantServer = toggleSelectedRestaurantServer;
})();
