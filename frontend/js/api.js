const API = "https://pos-api-yvoj.onrender.com";

async function request(path, method = "GET", body = null) {
  const token = localStorage.getItem("token");
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = "Bearer " + token;

  const res = await fetch(API + path, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
    cache: "no-store" // 🔥 Disable cache to avoid 304 Not Modified issues
  });

  return res.json();
}
