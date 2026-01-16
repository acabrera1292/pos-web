function exportCSV() {
  const rows = [["Código","Nombre","Cantidad","Precio"]];
  document.querySelectorAll("#inventoryTable tbody tr").forEach(r => {
    const cols = Array.from(r.children).slice(0,4).map(td => td.textContent);
    rows.push(cols);
  });

  let csv = rows.map(r => r.join(",")).join("\n");
  let blob = new Blob([csv], { type: "text/csv" });
  let url = URL.createObjectURL(blob);
  let a = document.createElement("a");
  a.href = url;
  a.download = "inventario.csv";
  a.click();
}

function importCSV() {
  const fileInput = document.getElementById("csvFileInput");
  if (!fileInput.files.length) return alert("Selecciona un archivo .csv");

  const file = fileInput.files[0];
  const reader = new FileReader();

  reader.onload = e => {
    const lines = e.target.result.split("\n").slice(1);
    lines.forEach(line => {
      if (!line.trim()) return;
      let [code,name,qty,price] = line.split(",");
      request("/inventory/add", "POST", {
        code, name, quantity: parseInt(qty), price: parseFloat(price),
        company: localStorage.getItem("company")
      });
    });
    setTimeout(loadInventory, 300);
  };

  reader.readAsText(file);
}
