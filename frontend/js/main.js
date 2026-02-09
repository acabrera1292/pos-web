const tabMap = {
  inventario: () => import('./inventario.js').then(m => m.initInventario()),
  pos: () => import('./pos.js').then(m => m.initPOS()),
  ventas: () => import('./ventas.js').then(m => m.initVentas()),
  clientes: () => import('./clientes.js').then(m => m.initClientes()),
  config: () => import('./config.js').then(m => m.initConfig()),
};

window.showTab = async function(tabName) {
  const tabContent = document.getElementById("tab-content");
  tabContent.innerHTML = `<h2>Cargando módulo ${tabName}...</h2>`;

  try {
    await tabMap[tabName]?.();
  } catch (err) {
    tabContent.innerHTML = `<h2>Error al cargar el módulo: ${tabName}</h2><pre>${err}</pre>`;
    console.error(err);
  }
};

// Auto-load first tab
showTab('inventario');
