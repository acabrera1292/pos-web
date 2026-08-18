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
            <div class="app-dialog-icon" aria-hidden="true">${options.confirm || options.prompt ? "?" : "i"}</div>
            <div class="app-dialog-message-area"><p class="app-dialog-message"></p>${options.prompt ? `<input class="app-dialog-input" type="${options.inputType === "password" ? "password" : "text"}" autocomplete="off">` : ""}</div>
          </div>
          <footer class="app-dialog-actions">
            ${options.confirm || options.prompt ? '<button class="app-dialog-cancel" type="button">Cancelar</button>' : ""}
            <button class="app-dialog-primary" type="button">${options.confirm || options.prompt ? "Confirmar" : "Aceptar"}</button>
          </footer>
        </section>
      `;

      overlay.querySelector(".app-dialog-message").textContent = String(message ?? "");
      document.body.appendChild(overlay);

      const primary = overlay.querySelector(".app-dialog-primary");
      const cancel = overlay.querySelector(".app-dialog-cancel");
      const close = overlay.querySelector(".app-dialog-close");
      const input = overlay.querySelector(".app-dialog-input");
      if (input) input.value = options.defaultValue || "";

      function finish(result) {
        document.removeEventListener("keydown", onKeyDown);
        overlay.remove();
        resolve(result);
      }

      function onKeyDown(event) {
        if (event.key === "Escape") finish(options.prompt ? null : false);
        if (event.key === "Enter") finish(options.prompt ? input.value : true);
      }

      primary.addEventListener("click", () => finish(options.prompt ? input.value : true));
      close.addEventListener("click", () => finish(options.prompt ? null : false));
      if (cancel) cancel.addEventListener("click", () => finish(options.prompt ? null : false));
      overlay.addEventListener("click", event => {
        if (event.target === overlay) finish(options.prompt ? null : false);
      });
      document.addEventListener("keydown", onKeyDown);
      (input || primary).focus();
    });
  }

  function enqueue(message, options) {
    const result = dialogQueue.then(() => openDialog(message, options));
    dialogQueue = result.catch(() => false);
    return result;
  }

  window.appAlert = message => enqueue(message, { confirm: false });
  window.appConfirm = message => enqueue(message, { confirm: true });
  window.appPrompt = (message, defaultValue = "", options = {}) => enqueue(message, { prompt: true, defaultValue, ...options });
  window.alert = window.appAlert;
})();
