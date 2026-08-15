// Interne Seitenwechsel ohne echtes Neuladen: geholt wird die Zielseite trotzdem,
// ausgetauscht wird aber nur <main>.
//
// Das ist kein Selbstzweck und keine Geschwindigkeitsübung. iOS gibt die
// Bildschirmsperre bei jedem Dokumentwechsel frei und verweigert sie der frisch
// geladenen Seite mangels Nutzergeste — wer ein Rezept öffnet und das Telefon
// weglegt, steht sonst vor einem dunklen Display. Solange das Dokument bestehen
// bleibt, übersteht die einmal geholte Sperre den ganzen Besuch. Siehe wakelock.js.
//
// Ohne JavaScript, in alten Browsern und bei jedem Fehler hier bleiben es ganz
// normale Links: Dann lädt der Browser die Seite eben selbst.
(function () {
  const main = document.querySelector("main");
  const kopf = document.querySelector(".site-header");
  if (!main || !kopf || !window.fetch || !window.DOMParser || !history.pushState) return;

  // Damit Tastatur und Vorlesehilfen nach dem Wechsel im neuen Inhalt landen.
  main.tabIndex = -1;

  // Wir tauschen den Inhalt selbst aus, also stellen wir auch die Scrollposition
  // selbst wieder her — sonst springt der Browser ins Leere.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  const parser = new DOMParser();

  // Nur echte Seiten abfangen. Die enden auf dieser Seite alle auf "/", Bilder
  // (Lightbox-Links!) und alles Externe damit von allein nicht.
  function ziel(a) {
    if (!a || !a.getAttribute("href") || a.target || a.hasAttribute("download")) return null;
    let url;
    try { url = new URL(a.href); } catch { return null; }
    if (url.origin !== location.origin) return null;
    if (!url.pathname.endsWith("/")) return null;
    return url;
  }

  async function wechsle(url, neuerEintrag) {
    const antwort = await fetch(url, { credentials: "same-origin" });
    if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
    const doc = parser.parseFromString(await antwort.text(), "text/html");
    const inhalt = doc.querySelector("main");
    if (!inhalt) throw new Error("kein <main> in der Antwort");

    if (neuerEintrag) {
      history.replaceState({ y: window.scrollY }, "");
      history.pushState({ y: 0 }, "", url);
    }
    document.title = doc.title;

    // Die Lightbox hängt an <body>, nicht in <main>, und überlebt den Austausch sonst.
    document.querySelectorAll(".lightbox").forEach((alt) => alt.remove());

    // Skripte, die per innerHTML hereinkommen, laufen nicht los. Also hängen wir sie
    // hinterher neu ein — so bekommen Suche und Lightbox ihre neuen Elemente zu fassen.
    const skripte = Array.from(inhalt.querySelectorAll("script"));
    skripte.forEach((s) => s.remove());
    main.innerHTML = inhalt.innerHTML;
    for (const vorlage of skripte) {
      const s = document.createElement("script");
      if (vorlage.src) s.src = vorlage.src;
      else s.textContent = vorlage.textContent;
      main.append(s);
    }

    // "← Alle Rezepte" steht in der Kopfzeile, die wir bewusst stehen lassen: dort
    // sitzt der Schalter für die Bildschirmsperre, den wir nicht wegwerfen wollen.
    const zurueckNeu = doc.querySelector(".site-header .back");
    const zurueckAlt = kopf.querySelector(".back");
    if (zurueckNeu && !zurueckAlt) kopf.insertBefore(document.importNode(zurueckNeu, true), kopf.querySelector(".wakelock-toggle"));
    else if (!zurueckNeu && zurueckAlt) zurueckAlt.remove();

    main.focus({ preventScroll: true });
  }

  document.addEventListener("click", (event) => {
    // Die Lightbox hat den Klick eventuell schon für sich verbucht.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const a = event.target.closest?.("a");
    const url = ziel(a);
    if (!url) return;

    event.preventDefault();
    if (url.href === location.href) return;

    wechsle(url, true)
      .then(() => window.scrollTo(0, 0))
      .catch(() => { location.href = url.href; });
  });

  window.addEventListener("popstate", (event) => {
    const y = typeof event.state?.y === "number" ? event.state.y : 0;
    wechsle(location.href, false)
      .then(() => window.scrollTo(0, y))
      .catch(() => location.reload());
  });
})();
