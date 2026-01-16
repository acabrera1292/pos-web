let cart = [];
function addToCart(item) {
  cart.push(item);
  renderCart();
}
async function saveSale() {
  const company = localStorage.getItem("company");
  for(let i of cart)
    await request("/sales/add","POST",{...i, company, date: new Date().toISOString()});
  cart=[];
  alert("Venta guardada");
}
