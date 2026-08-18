const intakeToken = new URLSearchParams(location.search).get("token") || "";

async function initializeIntake() {
  const form = document.getElementById("intakeForm");
  if (!intakeToken) return disableIntake("El enlace de registro está incompleto.");
  try {
    const res = await fetch(`/public/client-intake/${encodeURIComponent(intakeToken)}`);
    const data = await res.json();
    if (!res.ok) return disableIntake(data.error || "Este enlace no está disponible.");
    document.getElementById("intakeStoreName").textContent = data.storeName;
    form.addEventListener("submit", submitIntake);
  } catch {
    disableIntake("No se pudo conectar con la tienda. Intenta nuevamente.");
  }
}

function disableIntake(message) {
  document.getElementById("intakeForm").classList.add("hidden");
  const unavailable = document.getElementById("intakeUnavailable");
  unavailable.textContent = message;
  unavailable.classList.remove("hidden");
}

async function submitIntake(event) {
  event.preventDefault();
  const submit = event.currentTarget.querySelector("button[type=submit]");
  const payload = {
    idType: document.getElementById("intakeIdType").value,
    idNumber: document.getElementById("intakeIdNumber").value.trim(),
    razonSocial: document.getElementById("intakeName").value.trim(),
    nombreComercial: document.getElementById("intakeCommercialName").value.trim(),
    ciudad: document.getElementById("intakeCity").value.trim(),
    direccion: document.getElementById("intakeAddress").value.trim(),
    email: document.getElementById("intakeEmail").value.trim(),
    telefono: document.getElementById("intakePhone").value.trim(),
    celular: document.getElementById("intakeMobile").value.trim()
  };
  submit.disabled = true;
  submit.textContent = "Enviando...";
  try {
    const res = await fetch(`/public/client-intake/${encodeURIComponent(intakeToken)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) return alert(data.error || "No se pudieron guardar los datos.");
    document.getElementById("intakeForm").classList.add("hidden");
    document.getElementById("intakeSuccess").classList.remove("hidden");
  } catch {
    alert("No se pudo conectar con la tienda. Intenta nuevamente.");
  } finally {
    submit.disabled = false;
    submit.textContent = "Enviar datos";
  }
}

function resetIntakeForm() {
  document.getElementById("intakeForm").reset();
  document.getElementById("intakeSuccess").classList.add("hidden");
  document.getElementById("intakeForm").classList.remove("hidden");
}

initializeIntake();
