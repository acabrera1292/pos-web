async function login() {
  const username = document.getElementById("username").value;
  const password = document.getElementById("password").value;
  const res = await request("/auth/login","POST",{username,password});
  if(res.token) {
    localStorage.setItem("token",res.token);
    localStorage.setItem("company",res.company);
    window.location = "dashboard.html";
  } else alert("Credenciales inválidas");
}
