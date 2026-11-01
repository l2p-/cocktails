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

  // Die Kopfzeile klebt oben (style.css) und bleibt über alle Seitenwechsel stehen. Bricht
  // sie bei sehr großer Schrift doch einmal um, rechnen die klebende Suche und die
  // Sprungziele mit ihrer echten Höhe statt mit der einen Zeile aus style.css.
  if (kopf && "ResizeObserver" in window) {
    new ResizeObserver(() => {
      document.documentElement.style.setProperty("--kopf-hoehe", `${kopf.getBoundingClientRect().height}px`);
    }).observe(kopf);
  }

  if (!main || !kopf || !window.fetch || !window.DOMParser || !history.pushState) return;

  // Damit Tastatur und Vorlesehilfen nach dem Wechsel im neuen Inhalt landen.
  main.tabIndex = -1;

  // Wir tauschen den Inhalt selbst aus, also stellen wir auch die Scrollposition
  // selbst wieder her — sonst springt der Browser ins Leere.
  if ("scrollRestoration" in history) history.scrollRestoration = "manual";

  const parser = new DOMParser();

  // Jeder History-Eintrag bekommt eine Nummer, unter der seine Scrollposition
  // laufend in einer Map liegt — das Dokument lebt hier ja absichtlich weiter,
  // also taugt es als Gedächtnis, und auch Vorwärts landet wieder richtig.
  // Für einen echten Reload wandert die Position zusätzlich in den History-State,
  // gedrosselt: Safari erlaubt nur ~100 replaceState-Aufrufe pro 30 Sekunden.
  const positionen = new Map();
  let eintragNr = typeof history.state?.nr === "number" ? history.state.nr : 0;
  let naechsteNr = eintragNr + 1;
  if (typeof history.state?.nr !== "number") {
    history.replaceState({ ...history.state, nr: eintragNr }, "");
  }

  let sicherung;
  window.addEventListener("scroll", () => {
    positionen.set(eintragNr, window.scrollY);
    clearTimeout(sicherung);
    sicherung = setTimeout(() => {
      history.replaceState({ ...history.state, y: positionen.get(eintragNr) ?? 0 }, "");
    }, 500);
  }, { passive: true });

  // Nach einem Reload stellt der Browser bei manueller Verwaltung nichts wieder
  // her — das übernehmen wir aus dem zuletzt gesicherten State.
  if (typeof history.state?.y === "number" && history.state.y > 0) {
    window.scrollTo(0, history.state.y);
  }

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

  // Ladeanzeige erst nach kurzer Gnadenfrist — schnelle Wechsel bleiben unsichtbar,
  // bei zähem WLAN sieht der Tipp nicht mehr wie ins Leere aus.
  let ladeTimer;
  function ladeanzeige(an) {
    clearTimeout(ladeTimer);
    if (an) ladeTimer = setTimeout(() => document.documentElement.classList.add("laedt"), 150);
    else document.documentElement.classList.remove("laedt");
  }

  // Ist unterwegs das Netz weg, bleiben wir auf der Seite, statt den Besuch an
  // eine Browser-Fehlerseite zu verlieren — mitsamt Sperre und Suchzustand.
  let hinweis, hinweisTimer;
  function melde() {
    if (!hinweis) {
      hinweis = document.createElement("p");
      hinweis.className = "verbindungs-hinweis";
      hinweis.setAttribute("role", "status");
      document.body.append(hinweis);
    }
    hinweis.textContent = "Keine Verbindung — bitte nochmal versuchen.";
    hinweis.classList.add("sichtbar");
    clearTimeout(hinweisTimer);
    hinweisTimer = setTimeout(() => hinweis.classList.remove("sichtbar"), 4000);
  }

  // Nur eine Navigation zur Zeit: Ein Doppeltipp oder ein Klick während des
  // Ladens bricht die alte ab, statt zwei Wechsel um History und <main> rennen
  // zu lassen. Wer das Rennen verliert, fliegt hier als AbortError raus.
  let laufende = null;

  // Zu welcher Adresse der gezeigte Inhalt gehört — ein popstate, das nur die
  // Sprungmarke wechselt, braucht dann keinen neuen Abruf. Schreibt ein anderes Skript
  // die Adresse um, ohne den Inhalt zu wechseln (mixplan.js nach einem geteilten Link),
  // sagt es das mit „adresse-ersetzt" — sonst hielte ein Tipp auf denselben Link die
  // Seite für eine andere und holte sie neu.
  let aktuellerPfad = location.pathname + location.search;
  document.addEventListener("adresse-ersetzt", () => { aktuellerPfad = location.pathname + location.search; });

  async function wechsle(url, neuerEintrag) {
    laufende?.abort();
    const nav = new AbortController();
    laufende = nav;
    ladeanzeige(true);
    try {
      const antwort = await fetch(url, { credentials: "same-origin", signal: nav.signal });
      if (!antwort.ok) throw new Error(`HTTP ${antwort.status}`);
      const doc = parser.parseFromString(await antwort.text(), "text/html");
      if (nav.signal.aborted) throw new DOMException("überholt", "AbortError");
      const inhalt = doc.querySelector("main");
      if (!inhalt) throw new Error("kein <main> in der Antwort");

      // Im Zurück/Vorwärts-Pfad kann sich die Adresse geändert haben, während
      // die Antwort unterwegs war — dann gehört dieser Inhalt nicht mehr hierhin.
      if (!neuerEintrag && url.pathname + url.search !== location.pathname + location.search) {
        throw new DOMException("überholt", "AbortError");
      }

      // Stammt die Antwort von einem neueren Deploy, hilft nur ein echter
      // Seitenwechsel: Nur er tauscht auch CSS, Skripte und Fußzeile aus. Das
      // kostet die Sperre genau einmal pro Deploy — alt und neu zu mischen
      // wäre teurer.
      const eigenerBuild = document.querySelector('meta[name="build"]')?.content;
      const neuerBuild = doc.querySelector('meta[name="build"]')?.content;
      if (eigenerBuild && neuerBuild && eigenerBuild !== neuerBuild) {
        // Steht die Adresse schon in der Leiste (Zurück/Vorwärts), wäre eine Zuweisung bei
        // einer Adresse mit Sprungmarke (#titel, Mixleiste) nur ein Sprung innerhalb der
        // Seite — mit neuem popstate, also einer Schleife. Dann eben neu laden.
        if (url.href === location.href) location.reload();
        else location.href = url.href;
        throw new DOMException("neuer Build, volle Navigation", "AbortError");
      }

      if (neuerEintrag) {
        // Doppeltipp auf denselben Link: Der erste Wechsel hat die Adresse
        // inzwischen gesetzt, ein zweiter Eintrag für dieselbe Seite wäre nur
        // ein Zurück-Knopf, der nicht zurückgeht.
        if (url.href === location.href) return;
        positionen.set(eintragNr, window.scrollY);
        history.replaceState({ ...history.state, y: window.scrollY }, "");
        eintragNr = naechsteNr++;
        history.pushState({ nr: eintragNr, y: 0 }, "", url);
      }
      document.title = doc.title;
      const beschreibungAlt = document.querySelector('meta[name="description"]');
      const beschreibungNeu = doc.querySelector('meta[name="description"]');
      if (beschreibungAlt && beschreibungNeu) beschreibungAlt.setAttribute("content", beschreibungNeu.getAttribute("content"));
      // Chrome auf Android teilt über sein eigenes Menü die Canonical-Adresse, nicht
      // die angezeigte — ohne diese Zeile also die Einstiegsseite statt des Rezepts.
      const kanonischAlt = document.querySelector('link[rel="canonical"]');
      const kanonischNeu = doc.querySelector('link[rel="canonical"]');
      if (kanonischAlt && kanonischNeu) kanonischAlt.setAttribute("href", kanonischNeu.getAttribute("href"));

      // Die Lightbox hängt an <body>, nicht in <main>, und überlebt den Austausch sonst.
      document.querySelectorAll(".lightbox").forEach((alt) => alt.remove());

      // Skripte, die per innerHTML hereinkommen, laufen nicht los. Also hängen wir sie
      // hinterher neu ein — so bekommen Suche und Lightbox ihre neuen Elemente zu fassen.
      // Datenblöcke (JSON-LD) bleiben, wo sie sind: Sie müssen nichts ausführen.
      const skripte = Array.from(inhalt.querySelectorAll("script"))
        .filter((s) => !s.type || s.type === "module" || s.type === "text/javascript");
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
      // Er gehört direkt hinter den Schriftzug, wie im ausgelieferten HTML.
      const zurueckNeu = doc.querySelector(".site-header .back");
      const zurueckAlt = kopf.querySelector(".back");
      if (zurueckNeu && !zurueckAlt) kopf.querySelector(".wordmark").after(document.importNode(zurueckNeu, true));
      else if (!zurueckNeu && zurueckAlt) zurueckAlt.remove();

      // Bei einem weichen Wechsel liest keine Vorlesehilfe den neuen Titel vor —
      // also sagen wir ihn selbst an.
      const ansage = document.getElementById("nav-status");
      if (ansage) requestAnimationFrame(() => { ansage.textContent = document.title; });

      aktuellerPfad = url.pathname + url.search;
      main.focus({ preventScroll: true });

      // Skripte aus base.njk laufen nur einmal pro Dokument. Wer von ihnen in <main>
      // zeichnet (mixplan.js), erfährt hier, dass der Inhalt neu ist — im selben Task,
      // also vor dem nächsten Malen und vor dem Scrollen unten im .then(). Ein Fehler
      // dort bricht den Seitenwechsel nicht ab, der Browser meldet ihn nur.
      document.dispatchEvent(new Event("seitenwechsel"));
    } finally {
      if (laufende === nav) {
        laufende = null;
        ladeanzeige(false);
      }
    }
  }

  document.addEventListener("click", (event) => {
    // Die Lightbox hat den Klick eventuell schon für sich verbucht.
    if (event.defaultPrevented || event.button !== 0) return;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;

    const a = event.target.closest?.("a");
    const url = ziel(a);
    if (!url) return;

    // Sprungmarken auf derselben Seite kann der Browser am besten selbst.
    if (url.pathname === location.pathname && url.search === location.search && url.hash) return;

    event.preventDefault();
    const gleicheAdresse = url.href === location.href;
    if (gleicheAdresse && url.pathname + url.search === aktuellerPfad) {
      // Tipp auf den Schriftzug, obwohl die Startseite schon offen ist:
      // wenigstens nach oben scrollen statt gar nichts zu tun.
      window.scrollTo({ top: 0 });
      return;
    }

    // Zeigt die Seite nach einem gescheiterten Zurück noch den alten Inhalt,
    // stimmt die Adresse schon — dann nur nachladen, keinen Eintrag anlegen.
    wechsle(url, !gleicheAdresse)
      .then(() => {
        const marke = url.hash && document.getElementById(decodeURIComponent(url.hash.slice(1)));
        if (marke) marke.scrollIntoView();
        else window.scrollTo(0, 0);
      })
      .catch((fehler) => {
        if (fehler.name === "AbortError") return;                 // von einer neueren Navigation überholt
        if (fehler instanceof TypeError) { melde(); return; }     // Netz weg: hierbleiben
        location.href = url.href;                                 // alles andere: normale Navigation
      });
  });

  window.addEventListener("popstate", (event) => {
    if (typeof event.state?.nr === "number") {
      eintragNr = event.state.nr;
      // Nach einem Reload mitten in der History kennt der Zähler die vorderen
      // Einträge nicht — sonst bekämen zwei Einträge dieselbe Nummer.
      naechsteNr = Math.max(naechsteNr, eintragNr + 1);
    } else {
      // Ein vom Browser angelegter Eintrag (Sprungmarke) hat keinen State —
      // er bekommt eine frische Nummer, statt die der Startseite zu kapern.
      eintragNr = naechsteNr++;
      history.replaceState({ ...history.state, nr: eintragNr }, "");
    }
    const y = positionen.get(eintragNr) ?? (typeof event.state?.y === "number" ? event.state.y : 0);
    // Auch ein Sprung zu einer Marke auf derselben Seite ist ein popstate —
    // der Inhalt stimmt aber schon, nichts holen und nichts austauschen. Eine
    // noch laufende Navigation zu einer anderen Adresse ist damit überholt.
    if (location.pathname + location.search === aktuellerPfad) {
      laufende?.abort();
      return;
    }
    wechsle(new URL(location.href), false)
      .then(() => window.scrollTo(0, y))
      .catch((fehler) => {
        if (fehler.name === "AbortError") return;
        if (fehler instanceof TypeError) { melde(); return; }
        location.reload();
      });
  });
})();
