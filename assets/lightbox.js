// Foto der Rezeptseite per Klick/Tipp in Originalgröße zeigen.
// Der Auslöser ist ein normaler Link auf die Bilddatei: ohne JavaScript öffnet
// er das Bild direkt im Browser, mit JavaScript stattdessen die Overlay-Ansicht.
(function () {
  const trigger = document.querySelector(".photo-zoom");
  if (!trigger || typeof HTMLDialogElement === "undefined") return;

  let dialog;

  function build() {
    dialog = document.createElement("dialog");
    dialog.className = "lightbox";
    dialog.setAttribute("aria-label", "Foto in Originalgröße");

    const img = document.createElement("img");
    img.src = trigger.href; // gleiche Datei wie auf der Seite, also schon im Cache
    img.alt = trigger.querySelector("img")?.alt || "";

    const close = document.createElement("button");
    close.type = "button";
    close.className = "lightbox-close";
    close.setAttribute("aria-label", "Schließen");
    close.textContent = "×";

    dialog.append(img, close);
    // Nur daneben oder auf die Schaltfläche klicken schließt — auf dem Bild selbst soll man
    // zoomen und schieben können, ohne dass das Overlay verschwindet. Escape kann das <dialog> selbst.
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog || event.target === close) dialog.close();
    });

    document.body.append(dialog);
  }

  trigger.addEventListener("click", (event) => {
    // Cmd/Ctrl/Shift-Klick weiter dem Browser überlassen (neuer Tab, neues Fenster).
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    event.preventDefault();
    if (!dialog) build();
    dialog.showModal();
  });
})();
