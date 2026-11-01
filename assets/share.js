// Teilen-Knopf in der Kopfzeile: schickt die Adresse der gerade gezeigten Seite
// über das Teilen-Menü des Telefons in den Gruppenchat. Die Vorschau dort (Foto,
// Untertitel) kommt aus den og:-Tags in base.njk — hier geht nur die Adresse raus.
// Auf Mixplan und Besorgen trägt sie den Plan mit (?plan=…, siehe unten).
//
// Wozu, wenn der Browser selbst teilen kann: Vom Home-Bildschirm gestartet gibt
// es keine Browserleiste und damit keinen Teilen-Knopf. Und auf der Übersicht
// nimmt dieser Knopf den aktuellen Filter mit (?q=gin), das Browsermenü teilt
// dagegen mitunter die Canonical-Adresse, und die kennt keinen Filter.
//
// Die Kopfzeile bleibt bei Seitenwechseln stehen (nav.js), das Skript läuft also
// einmal pro Besuch und liest die Adresse erst beim Tippen.
(function () {
  const knopf = document.querySelector(".teilen-knopf");
  const hinweis = document.querySelector(".teilen-hinweis");
  if (!knopf || !hinweis) return;

  const kannTeilen = typeof navigator.share === "function";
  const kannKopieren = typeof navigator.clipboard?.writeText === "function";
  // Ohne beides gäbe es nur eine tote Schaltfläche — dann lieber gar keine.
  if (!kannTeilen && !kannKopieren) return;

  // Mixplan und Besorgen leben im Browser — ihre nackte Adresse zeigte dem Empfänger
  // nur seinen eigenen Plan. Solche Seiten tragen data-teilen="plan" in <main>, und die
  // Adresse samt Plan liefert mixplan.js auf Anfrage (Ereignis „teilen-adresse"); dieses
  // Skript muss den Plan nicht kennen.
  const teiltPlan = () => Boolean(document.querySelector('main [data-teilen="plan"]'));

  // Am Rechner ohne Teilen-Menü wird kopiert; der Name sagt, was passiert. Der Tooltip
  // hängt an der Seite, und die Kopfzeile bleibt bei Seitenwechseln stehen — also bei
  // jedem Wechsel neu beschriften (nav.js meldet ihn als „seitenwechsel").
  knopf.setAttribute("aria-label", kannTeilen ? "Teilen" : "Link kopieren");
  function beschrifte() {
    const wohin = teiltPlan() ? "zu diesem Mixplan" : "zu dieser Seite";
    knopf.title = `Link ${wohin} ${kannTeilen ? "teilen" : "kopieren"}`;
  }
  beschrifte();
  document.addEventListener("seitenwechsel", beschrifte);
  knopf.hidden = false;

  // Die Adresse ohne Sprungmarke und ohne fremde Anhängsel (fbclid & Co.) — nur
  // die Suche gehört zur Seite. Auf der Übersicht gilt, was im Feld steht: Die
  // Adresszeile zieht beim Tippen erst verzögert nach (search.js). Auf Mixplan und
  // Besorgen fragt es mixplan.js — synchron, damit navigator.share die Nutzergeste
  // dieses Tipps noch sieht. null heißt: Der Plan ist leer, es gibt nichts zu teilen.
  function adresse() {
    if (teiltPlan()) {
      const anfrage = { url: null };
      document.dispatchEvent(new CustomEvent("teilen-adresse", { detail: anfrage }));
      return anfrage.url;
    }
    const url = new URL(location.href);
    const feld = document.getElementById("q");
    const q = feld ? feld.value.trim() : url.searchParams.get("q");
    url.hash = "";
    url.search = q ? "?q=" + encodeURIComponent(q) : "";
    return url.href;
  }

  let hinweisTimer;
  function zeigeHinweis(text) {
    hinweis.textContent = text;
    hinweis.classList.add("sichtbar");
    clearTimeout(hinweisTimer);
    hinweisTimer = setTimeout(() => hinweis.classList.remove("sichtbar"), 2500);
  }

  knopf.addEventListener("click", async () => {
    const url = adresse();
    if (!url) { zeigeHinweis("Der Mixplan ist leer"); return; }
    if (kannTeilen) {
      try {
        await navigator.share({ title: document.title, url });
        return;
      } catch (fehler) {
        // Abgebrochen, oder das Menü ist vom ersten Tipp noch offen: nichts zu tun.
        if (fehler?.name === "AbortError" || fehler?.name === "InvalidStateError") return;
        // Sonst (verweigert, nicht unterstützt) wenigstens kopieren.
        if (!kannKopieren) return;
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      zeigeHinweis("Link kopiert");
    } catch {
      zeigeHinweis("Kopieren nicht möglich");
    }
  });
})();
