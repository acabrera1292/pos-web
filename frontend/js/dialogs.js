(function () {
  let dialogQueue = Promise.resolve();

  function openDialog(message, options = {}) {
    return new Promise(resolve => {
      const overlay = document.createElement("div");
      overlay.className = "app-dialog-overlay";
      overlay.innerHTML = `
        <section class="app-dialog" role="dialog" aria-modal="true" aria-labelledby="appDialogTitle">
          <header class="app-dialog-titlebar">
            <span id="appDialogTitle">POS Simple</span>
            <button class="app-dialog-close" type="button" aria-label="Cerrar">&times;</button>
          </header>
          <div class="app-dialog-content">
            <div class="app-dialog-icon" aria-hidden="true">${options.confirm ? "?" : "i"}</div>
            <p class="app-dialog-message"></p>
          </div>
          <footer class="app-dialog-actions">
            ${options.confirm ? '<button class="app-dialog-cancel" type="button">Cancelar</button>' : ""}
            <button class="app-dialog-primary" type="button">${options.confirm ? "Confirmar" : "Aceptar"}</button>
          </footer>
        </section>
      `;

      overlay.querySelector(".app-dialog-message").textContent = String(message ?? "");
      document.body.appendChild(overlay);

      const primary = overlay.querySelector(".app-dialog-primary");
      const cancel = overlay.querySelector(".app-dialog-cancel");
      const close = overlay.querySelector(".app-dialog-close");

      function finish(result) {
        document.removeEventListener("keydown", onKeyDown);
        overlay.remove();
        resolve(result);
      }

      function onKeyDown(event) {
        if (event.key === "Escape") finish(false);
        if (event.key === "Enter") finish(true);
      }

      primary.addEventListener("click", () => finish(true));
      close.addEventListener("click", () => finish(false));
      if (cancel) cancel.addEventListener("click", () => finish(false));
      overlay.addEventListener("click", event => {
        if (event.target === overlay) finish(false);
      });
      document.addEventListener("keydown", onKeyDown);
      primary.focus();
    });
  }

  function enqueue(message, options) {
    const result = dialogQueue.then(() => openDialog(message, options));
    dialogQueue = result.catch(() => false);
    return result;
  }

  window.appAlert = message => enqueue(message, { confirm: false });
  window.appConfirm = message => enqueue(message, { confirm: true });
  window.alert = window.appAlert;
})();
