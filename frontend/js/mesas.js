(function () {
  let restaurantTables = [];
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

  function tableState(table) {
    if (!table.active) return { className: "inactive", label: "Inactiva" };
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
      server.textContent = table.sessionId ? `Atiende: ${table.serverName}` : "";
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
      ? `${table.guests} cliente${Number(table.guests) === 1 ? "" : "s"} · ${minutesSince(table.openedAt)} min · ${table.serverName}`
      : table.active ? `Disponible · capacidad ${table.capacity}` : "Mesa inactiva";

    document.getElementById("btnSeatRestaurantTable").classList.toggle("hidden", Boolean(table.sessionId) || !table.active);
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
    const value = await appPrompt(`¿Cuántos clientes ocuparán ${selectedRestaurantTable.name}?`, "2");
    if (value === null) return;
    const guests = Number(value);
    if (!Number.isInteger(guests) || guests < 1 || guests > 99) return alert("Ingresa una cantidad válida de clientes.");
    try {
      const res = await fetch(`${API}/restaurant/tables/${selectedRestaurantTable.id}/seat`, {
        method: "POST",
        headers: { ...headers(), "Content-Type": "application/json" },
        body: JSON.stringify({ guests })
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

  window.initializeRestaurantTables = initializeRestaurantTables;
  window.loadRestaurantTables = loadRestaurantTables;
  window.createRestaurantTable = createRestaurantTable;
  window.seatSelectedRestaurantTable = seatSelectedRestaurantTable;
  window.closeSelectedRestaurantTable = closeSelectedRestaurantTable;
  window.editSelectedRestaurantTable = editSelectedRestaurantTable;
  window.deleteSelectedRestaurantTable = deleteSelectedRestaurantTable;
})();
