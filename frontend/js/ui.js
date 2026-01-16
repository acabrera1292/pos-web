function renderInventoryTable(products) {
  const tbody = document.querySelector("#inventoryTable tbody");
  tbody.innerHTML = "";

  products.forEach((p) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.code}</td>
      <td>${p.name}</td>
      <td>${p.quantity}</td>
      <td>$${p.price.toFixed(2)}</td>
      <td>
        <button onclick='editProduct(${JSON.stringify(p)})'>Editar</button>
        <button onclick='deleteProduct(${p.id})'>Eliminar</button>
      </td>
    `;
    tbody.appendChild(tr);
  });
}
function showTab(tab) {
  const sections = document.querySelectorAll('.tab-section');
  sections.forEach(s => s.classList.add('hidden'));
  document.getElementById(tab).classList.remove('hidden');
}
