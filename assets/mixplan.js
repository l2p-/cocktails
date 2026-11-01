// Mixplan: Drinks für einen Abend vormerken, zusammensuchen und der Reihe nach mixen
// (README, Mixplan). Wie ein Warenkorb, nur dass am Ende nichts gekauft, sondern
// gemixt wird.
//
// Der Plan lebt nur in diesem Browser (localStorage) — die Seite ist statisch, es gibt
// keinen Server, der ihn sich merken könnte. Deshalb zeichnet dieses Skript alles, was
// vom Plan abhängt: die Zahl in der Kopfzeile, das „+" auf den Karten der Übersicht, Knopf,
// Zähler und hochgerechnete Mengen auf der Rezeptseite, die Mixleiste und die Seiten
// Mixplan und Besorgen.
//
// Es läuft einmal pro Dokument (base.njk), wie wakelock.js und share.js. Kein Skript in
// <main>: nav.js hängt solche bei jedem Wechsel neu ein, sie häuften Listener an und
// liefen erst nach der wiederhergestellten Scrollposition. Stattdessen meldet nav.js
// jeden Wechsel als „seitenwechsel", und zeichne() schaut nach, was in <main> steht.
// Geladen wird es vor nav.js, damit die Listen beim Neuladen schon dastehen, wenn nav.js
// die Scrollposition wiederherstellt.
(function () {
  const planKnopf = document.querySelector(".mixplan-knopf");
  if (!planKnopf) return;
  const planAdresse = planKnopf.getAttribute("href");

  // slug → { titel, adresse } aus dem Datenblock in base.njk. Was hier fehlt, gibt es in
  // diesem Build nicht (mehr) — etwa ein umbenanntes Rezept.
  const index = new Map();
  try {
    for (const [slug, titel, adresse] of JSON.parse(document.getElementById("rezept-index")?.textContent || "[]")) {
      index.set(slug, { titel, adresse });
    }
  } catch { /* ohne Index kennt der Plan kein Rezept; dann bleibt eben alles versteckt */ }
  const zumRezept = (slug) => index.get(slug).adresse + "#titel";

  const glaeser = (n) => (n === 1 ? "1 Glas" : `${n} Gläser`);
  const drinks = (n) => (n === 1 ? "1 Drink" : `${n} Drinks`);
  const summeGlaeser = (liste) => liste.reduce((summe, d) => summe + d.anzahl, 0);
  // „2 Drinks · 3 Gläser" — bricht nur am Punkt um, nie zwischen Zahl und Wort.
  const umfang = (liste) => `${drinks(liste.length)} · ${glaeser(summeGlaeser(liste))}`.replace(/(\d) /g, "$1\u00a0");

  // --- Speicher -------------------------------------------------------------------------

  // Neues Format = neuer Schlüssel: Ein Tab mit altem Stand schreibt dann nur noch in den
  // alten, den keiner mehr liest, statt neue Daten zu zerschießen.
  const KEY = "cocktails-mixplan.v1";
  const MAX_GLAESER = 99;
  const SPEICHER_HINWEIS = "Dieser Browser speichert nichts — der Mixplan hält nur, solange die Seite offen ist.";

  // Alle Projektseiten unter l2p-.github.io teilen sich einen Ursprung und damit einen
  // localStorage. Gelesen wird deshalb nichts ungeprüft, und angezeigt wird Gespeichertes
  // nur über textContent. pruefe() liefert außerdem immer eine frische Kopie.
  function pruefe(roh) {
    const stand = { v: 1, drinks: [], haken: {} };
    if (!roh || typeof roh !== "object" || roh.v !== 1) return stand;
    const gesehen = new Set();
    for (const d of Array.isArray(roh.drinks) ? roh.drinks : []) {
      if (stand.drinks.length >= 100) break;
      if (!d || typeof d.slug !== "string" || !/^[a-z0-9][a-z0-9-]{0,80}$/.test(d.slug) || gesehen.has(d.slug)) continue;
      if (!Number.isInteger(d.anzahl) || d.anzahl < 1) continue;
      gesehen.add(d.slug);
      const titel = typeof d.titel === "string" && d.titel && d.titel.length <= 80 ? d.titel : d.slug;
      stand.drinks.push({ slug: d.slug, anzahl: Math.min(d.anzahl, MAX_GLAESER), titel });
    }
    if (roh.haken && typeof roh.haken === "object") {
      for (const [key, wert] of Object.entries(roh.haken)) {
        if (key.length <= 100 && /^(z:|glas:|werkzeug:)/.test(key) && typeof wert === "string" && wert.length <= 120) {
          stand.haken[key] = wert;
        }
      }
      // Haken für längst geänderte Mengen sammeln sich an — die ältesten fallen weg.
      const keys = Object.keys(stand.haken);
      for (const key of keys.slice(0, Math.max(0, keys.length - 300))) delete stand.haken[key];
    }
    return stand;
  }

  // Safari kann localStorage sperren (wie in wakelock.js). Dann lebt der Plan nur hier im
  // Speicher — und weil nav.js das Dokument am Leben hält, immerhin den ganzen Besuch lang.
  let speicher = pruefe(null);
  let nurSpeicher = false;

  function lies() {
    if (!nurSpeicher) {
      let text = null;
      try { text = localStorage.getItem(KEY); } catch { nurSpeicher = true; }
      if (!nurSpeicher) {
        let roh = null;
        // Kaputter Inhalt gilt als leerer Plan, wird aber erst beim nächsten Tipp ersetzt.
        try { roh = text === null ? null : JSON.parse(text); } catch { /* s. o. */ }
        speicher = pruefe(roh);
      }
    }
    return pruefe(speicher);
  }

  // Was dieses Dokument zuletzt geschrieben hat — weicht der Speicher davon ab, hat ein
  // anderer Tab etwas geändert, auch wenn sein storage-Ereignis nie ankam (s. u.).
  let zuletzt;
  function schreib(stand) {
    speicher = stand;
    if (nurSpeicher) return;
    zuletzt = JSON.stringify(stand);
    try { localStorage.setItem(KEY, zuletzt); } catch { nurSpeicher = true; }
  }
  function fremdGeaendert() {
    if (nurSpeicher) return false;
    try { return localStorage.getItem(KEY) !== zuletzt; } catch { return false; }
  }

  // Rückgängig-Stände und Grabsteine gelten nur für die gerade gezeigte Seite.
  let vorLeeren = null;          // Plan vor „Mixplan leeren"
  let vorHakenWeg = null;        // Haken vor „Alle Haken entfernen"
  let entfernte = [];            // Mixplan-Seite: { slug, titel, anzahl, stelle, hoehe }
  const wiederDazu = new Map();  // Rezeptseite: slug → alte Stelle im Plan

  // Der einzige Schreibweg, und nur aus einem Tipp heraus — nie beim Zeichnen, nie auf
  // storage oder pageshow; nach einem Seitenwechsel nur, wenn ein geteilter Link ankommt
  // (nimmGeteiltenAn, einmal je Link). Zwei Tabs, die auf jede Meldung des anderen mit
  // einem Schreiben antworteten, spielten sich den Plan endlos zu. Gelesen wird frisch,
  // damit die Änderung eines anderen Tabs nicht von einer alten Kopie überschrieben wird.
  // Jede Änderung macht ein angebotenes Rückgängig ungültig — es stellte sonst einen Stand
  // wieder her, der das Neue verschluckt. Nur das eine, das die Änderung selbst anbietet,
  // bleibt (behalte: "leeren", "haken" oder "angebot").
  function aendere(fn, { behalte = null } = {}) {
    const stand = lies();
    fn(stand);
    // Mehr als 100 Einträge (fremde oder verschwundene Rezepte): pruefe() schnitte hinten
    // etwas ab, womöglich den Drink eines anderen Tabs. Ein voller Plan nimmt nichts an.
    if (stand.drinks.length > 100) { zeichne(); return; }
    const neu = pruefe(stand);
    for (const d of neu.drinks) if (index.has(d.slug)) d.titel = index.get(d.slug).titel;
    schreib(neu);
    if (behalte !== "leeren") vorLeeren = null;
    if (behalte !== "haken") vorHakenWeg = null;
    if (behalte !== "angebot") angebotVerfaellt();
    zeichne();
  }

  // --- Bausteine ------------------------------------------------------------------------

  function el(tag, klasse, text) {
    const e = document.createElement(tag);
    if (klasse) e.className = klasse;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  const NS = "http://www.w3.org/2000/svg";
  const PFADE = {
    plus: "M12 5v14M5 12h14",
    minus: "M5 12h14",
    weg: "M4 7h16M9.5 7V4.5h5V7M6.5 7l1 12.5h9l1-12.5M10 11v5M14 11v5",
    haken: "M5 12.5l4.5 4.5L19 7.5",
    zurueck: "M15 5l-7 7 7 7",
    weiter: "M9 5l7 7-7 7",
    liste: "M9 4.5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-12a2 2 0 0 0-2-2h-2M9 3h6v3H9zM9 11h6M9 15h4",
  };
  function symbol(name) {
    const svg = document.createElementNS(NS, "svg");
    for (const [k, v] of Object.entries({ viewBox: "0 0 24 24", "aria-hidden": "true", fill: "none", stroke: "currentColor",
      "stroke-width": "2", "stroke-linecap": "round", "stroke-linejoin": "round" })) svg.setAttribute(k, v);
    const pfad = document.createElementNS(NS, "path");
    pfad.setAttribute("d", PFADE[name]);
    svg.append(pfad);
    return svg;
  }
  function setzeSymbol(knopf, name) {
    if (knopf.dataset.symbol === name) return;
    knopf.dataset.symbol = name;
    knopf.querySelector("svg")?.remove();
    knopf.prepend(symbol(name));
  }

  // Schonzeit: Wechselt ein Knopf unter dem Finger seine Bedeutung — aus „Auf den Mixplan"
  // wird „Im Mixplan", aus „−" der Mülleimer, aus der Zeile ein „Rückgängig" —, landet
  // der zweite Tipp eines Doppeltipps sonst auf dem neuen Knopf (Review N1, nasser Daumen).
  // Kurz danach schluckt der Block deshalb Klicks. Reines Weiterzählen (2 → 3 → 4) setzt
  // keine Schonzeit, schnelles „+ + +" zählt also jeden Tipp.
  const SCHONZEIT = 400;
  function schone(block) {
    if (block) block.dataset.schonzeitBis = String(performance.now() + SCHONZEIT);
  }
  // Blöcke können ineinander stecken (<main> nach einem Seitenwechsel, darin das Feld) —
  // es zählt jeder, der gerade schont, nicht nur der innerste.
  document.addEventListener("click", (event) => {
    for (let block = event.target.closest?.("[data-schonzeit-bis]"); block;
      block = block.parentElement?.closest("[data-schonzeit-bis]")) {
      if (performance.now() < Number(block.dataset.schonzeitBis)) {
        event.preventDefault();   // auch Links: nav.js sieht den zweiten Tipp gar nicht erst
        event.stopPropagation();
        return;
      }
    }
  }, true);

  // Vorlesehilfen: Jede Seite hat eine eigene Statuszeile für den Mixplan (.mixplan-status),
  // schon im HTML. Gefüllt wird erst nach kurzer Ruhe — schnelles „+ + +" wird einmal
  // angesagt, nicht dreimal (wie in search.js).
  const ansageTimer = new WeakMap();
  function ansage(text) {
    const status = document.querySelector("main .mixplan-status");
    if (!status) return;
    clearTimeout(ansageTimer.get(status));
    ansageTimer.set(status, setTimeout(() => { status.textContent = text; }, 300));
  }

  // Zeichnen ersetzt Zeilen, und mit ihnen kann der Fokus verschwinden. Gemerkt wird
  // deshalb, welcher Knopf ihn hatte, und hinterher derselbe wieder fokussiert.
  function merkeFokus() {
    const a = document.activeElement;
    if (!a?.dataset || !(a.dataset.aktion || a.dataset.key)) return null;
    return { element: a, aktion: a.dataset.aktion, slug: a.dataset.slug, key: a.dataset.key };
  }
  function stelleFokusWieder(gemerkt) {
    if (!gemerkt || gemerkt.element.isConnected) return;
    if (document.activeElement && document.activeElement !== document.body) return;
    const wahl = gemerkt.key
      ? `[data-key="${CSS.escape(gemerkt.key)}"]`
      : `[data-aktion="${CSS.escape(gemerkt.aktion)}"]${gemerkt.slug ? `[data-slug="${CSS.escape(gemerkt.slug)}"]` : ""}`;
    document.querySelector(`main ${wahl}`)?.focus({ preventScroll: true });
  }

  // − / Zahl / + — auf der Rezeptseite und in jeder Zeile des Mixplans gleich.
  function baueStepper(slug, titel) {
    const stepper = el("div", "stepper");
    stepper.setAttribute("role", "group");
    stepper.setAttribute("aria-label", `Mixplan: ${titel}`);
    const weniger = el("button", "stepper-knopf");
    const mehr = el("button", "stepper-knopf");
    for (const [knopf, aktion] of [[weniger, "weniger"], [mehr, "mehr"]]) {
      knopf.type = "button";
      knopf.dataset.aktion = aktion;
      knopf.dataset.slug = slug;
    }
    setzeSymbol(mehr, "plus");
    mehr.setAttribute("aria-label", `Ein Glas mehr: ${titel}`);
    stepper.append(weniger, el("span", "stepper-zahl"), mehr);
    return stepper;
  }
  function aktualisiereStepper(stepper, d, titel, nurZahl) {
    const [weniger, zahl, mehr] = stepper.children;
    // Bei einem Glas wird „−" zum Mülleimer: Der nächste Tipp nimmt den Drink vom Plan.
    setzeSymbol(weniger, d.anzahl > 1 ? "minus" : "weg");
    weniger.setAttribute("aria-label", d.anzahl > 1 ? `Ein Glas weniger: ${titel}` : `${titel} vom Mixplan nehmen`);
    // Bei 99 ist Schluss — aber per aria-disabled statt disabled: Ein abgeschalteter Knopf
    // gäbe den Fokus an <body> ab, und weitere Tastendrücke landeten im Nichts oder, mit
    // dem Fokus auf „−", zählten sie rückwärts. So zählt mehr() einfach nicht weiter.
    if (d.anzahl >= MAX_GLAESER) mehr.setAttribute("aria-disabled", "true");
    else mehr.removeAttribute("aria-disabled");
    // In der Liste zeigt der Bildschirm nur die Zahl, „Gläser" hören Vorlesehilfen und
    // steht auf Papier (style.css, .einheit).
    if (nurZahl) zahl.replaceChildren(String(d.anzahl), el("span", "einheit", d.anzahl === 1 ? " Glas" : " Gläser"));
    else zahl.textContent = glaeser(d.anzahl);
  }

  // --- Zeichnen -------------------------------------------------------------------------

  // Schaut nach, was gerade in <main> steht, und zeichnet nur das. Jedes Element wird
  // einmal aufgebaut und danach an Ort und Stelle nachgeführt — so bleiben Fokus,
  // offene Auswahl und Scrollposition, wo sie sind.
  function zeichne() {
    const stand = lies();
    const fokus = merkeFokus();
    const bekannte = stand.drinks.filter((d) => index.has(d.slug));
    zeichneKopf(bekannte);
    const main = document.querySelector("main");
    if (main) {
      zeichneKarten(main, stand);
      const feld = main.querySelector(".mixplan-feld");
      if (feld) zeichneFeld(feld, stand);
      const zutaten = main.querySelector(".ingredients");
      if (feld && zutaten) zeichneZutaten(zutaten, feld.dataset.slug, stand);
      const leiste = main.querySelector(".mixleiste");
      if (leiste) zeichneLeiste(leiste, bekannte);
      const plan = main.querySelector("#mixplan");
      if (plan) zeichnePlan(plan, stand, bekannte);
      const seite = plan ?? main.querySelector("#besorgen");
      if (seite) zeichneAngebot(seite, bekannte);
      const besorgen = main.querySelector("#besorgen");
      if (besorgen) zeichneBesorgen(besorgen, stand, bekannte);
      for (const hinweis of main.querySelectorAll(".mixplan-hinweis")) hinweis.hidden = !nurSpeicher;
    }
    stelleFokusWieder(fokus);
  }

  // Kopfzeile: die Zahl der geplanten Drinks am Mixplan-Symbol, wie am Warenkorb.
  function zeichneKopf(bekannte) {
    const zahl = planKnopf.querySelector(".mixplan-zahl");
    planKnopf.setAttribute("aria-label", bekannte.length
      ? `Mixplan: ${drinks(bekannte.length)}, ${glaeser(summeGlaeser(bekannte))}`
      : "Mixplan, noch leer");
    if (zahl) {
      zahl.textContent = String(bekannte.length);
      zahl.hidden = !bekannte.length;
    }
    if (planKnopf.pathname === location.pathname) planKnopf.setAttribute("aria-current", "page");
    else planKnopf.removeAttribute("aria-current");
    planKnopf.hidden = false;
  }

  // Name eines Knopfs, der ein Glas mehr einplant (Auswahl, Karten der Übersicht). Er
  // beginnt mit dem, was zu sehen ist: dem Namen des Drinks und, falls geplant, der Zahl.
  const waehlenName = (titel, d) => (d ? `${titel}, ${d.anzahl} geplant: ein Glas mehr` : `${titel} auf den Mixplan`);

  // Übersicht: „+" oben rechts im Bild jeder Karte. Jeder Tipp ist ein Glas mehr, wie in
  // der Auswahl auf der Mixplan-Seite; geplant trägt der Knopf die Akzentfarbe und die Zahl.
  function zeichneKarten(main, stand) {
    for (const knopf of main.querySelectorAll(".karten-plus")) {
      const titel = index.get(knopf.dataset.slug)?.titel;
      if (!titel) continue;
      const d = stand.drinks.find((x) => x.slug === knopf.dataset.slug);
      knopf.classList.toggle("geplant", Boolean(d));
      knopf.setAttribute("aria-label", waehlenName(titel, d));
      knopf.title = d ? "Noch ein Glas auf den Mixplan" : "Auf den Mixplan";
      const zahl = knopf.querySelector(".karten-zahl");
      zahl.textContent = d ? String(d.anzahl) : "";
      zahl.hidden = !d;
      knopf.hidden = false;
    }
  }

  // Rezeptseite: Steht der Drink mit mehreren Gläsern im Plan, zeigt die Zutatentabelle
  // die Mengen für alle zusammen — gerechnet wie auf der Besorgen-Liste. Was der Build
  // nicht zerlegen konnte („zum Auffüllen"), hat kein data-teile und bleibt, wie es ist.
  function zeichneZutaten(abschnitt, slug, stand) {
    const anzahl = stand.drinks.find((d) => d.slug === slug)?.anzahl ?? 1;
    for (const zelle of abschnitt.querySelectorAll("td[data-teile]")) {
      zelle.dataset.original ??= zelle.textContent;
      let teile = null;
      try { teile = JSON.parse(zelle.dataset.teile); } catch { /* bleibt wörtlich */ }
      zelle.textContent = anzahl > 1 && teile ? mengen(fuelle(new Map(), teile, anzahl)).join(" + ") : zelle.dataset.original;
    }
    const fuer = abschnitt.querySelector(".zutaten-fuer");
    if (fuer) fuer.textContent = anzahl > 1 ? ` für ${glaeser(anzahl).replace(" ", NB)}` : "";
  }

  // Rezeptseite: „Auf den Mixplan", danach „Im Mixplan" mit − / + an derselben Stelle.
  // Die Seite wechselt dabei nicht — sie ist ja das, was man gerade mixen will.
  function zeichneFeld(feld, stand) {
    const slug = feld.dataset.slug;
    const titel = index.get(slug)?.titel;
    if (!titel) return;
    if (!feld.dataset.gebaut) {
      feld.dataset.gebaut = "1";
      const dazu = el("button", "mixplan-dazu");
      dazu.type = "button";
      dazu.dataset.aktion = "dazu";
      dazu.dataset.slug = slug;
      dazu.append(symbol("plus"), el("span", null, "Auf den Mixplan"));
      const im = el("a", "mixplan-im");
      im.href = planAdresse;
      im.setAttribute("aria-label", "Im Mixplan — Mixplan öffnen");
      im.append(symbol("haken"), el("span", null, "Im Mixplan"), symbol("weiter"));
      const hinweis = el("p", "mixplan-hinweis", SPEICHER_HINWEIS);
      hinweis.hidden = true;
      feld.append(dazu, im, baueStepper(slug, titel), hinweis);
      feld.hidden = false;
    }
    const d = stand.drinks.find((x) => x.slug === slug);
    feld.querySelector(".mixplan-dazu").hidden = Boolean(d);
    feld.querySelector(".mixplan-im").hidden = !d;
    const stepper = feld.querySelector(".stepper");
    stepper.hidden = !d;
    if (d) aktualisiereStepper(stepper, d, titel, false);
  }

  // Mixleiste: zurück, wie viele Gläser von diesem Drink, weiter — mit dem Namen des
  // nächsten, damit man dessen Glas schon herrichten kann. Alles normale Links, die nav.js
  // weich wechselt: Die Bildschirmsperre hält über alle Drinks, und die Zurück-Taste des
  // Systems heißt „vorheriger Drink". Am Anfang und am Ende führt sie zum Mixplan.
  function zeichneLeiste(leiste, bekannte) {
    const stelle = bekannte.findIndex((d) => d.slug === leiste.dataset.slug);
    leiste.hidden = stelle < 0;
    if (stelle < 0) return;
    if (!leiste.dataset.gebaut) {
      leiste.dataset.gebaut = "1";
      const mitte = el("a", "leiste-mitte");
      mitte.append(el("span", "leiste-glaeser"), el("span", "leiste-stelle"));
      const weiter = el("a", "leiste-weiter");
      const text = el("span", "leiste-text");
      text.append(el("span", "leiste-klein"), el("span", "leiste-name"));
      weiter.append(text);
      leiste.append(el("a", "leiste-zurueck"), mitte, weiter);
    }
    const [zurueck, mitte, weiter] = leiste.children;
    const d = bekannte[stelle];
    const vorher = bekannte[stelle - 1];
    const nachher = bekannte[stelle + 1];

    zurueck.href = vorher ? zumRezept(vorher.slug) : planAdresse;
    zurueck.setAttribute("aria-label", vorher ? `Vorheriger Drink: ${index.get(vorher.slug).titel}` : "Zurück zum Mixplan");
    zurueck.replaceChildren(symbol(vorher ? "zurueck" : "liste"));

    // Die Namen beginnen mit dem, was zu sehen ist — wer per Sprache steuert, sagt das.
    const position = `Drink ${stelle + 1} von ${bekannte.length}`;
    mitte.href = planAdresse;
    mitte.setAttribute("aria-label", `${glaeser(d.anzahl)}, ${position} — Mixplan öffnen`);
    mitte.querySelector(".leiste-glaeser").textContent = glaeser(d.anzahl);
    mitte.querySelector(".leiste-stelle").textContent = position;

    weiter.href = nachher ? zumRezept(nachher.slug) : planAdresse;
    weiter.setAttribute("aria-label", nachher ? `Weiter: ${index.get(nachher.slug).titel}` : "Fertig: Mixplan öffnen");
    weiter.querySelector(".leiste-klein").textContent = nachher ? "Weiter" : "Fertig";
    weiter.querySelector(".leiste-name").textContent = nachher ? index.get(nachher.slug).titel : "Mixplan";
    if (!weiter.querySelector("svg")) weiter.append(symbol("weiter"));
  }

  // Seite Mixplan: Summe, die Liste in Mix-Reihenfolge, Besorgen und Mixen, die Auswahl.
  function zeichnePlan(seite, stand, bekannte) {
    seite.querySelector(".mixplan-ui").hidden = false;
    const auswahl = seite.querySelector(".mixplan-auswahl");

    // Grabsteine von Drinks, die inzwischen wieder im Plan stehen (Auswahl, anderer Tab),
    // haben sich erledigt.
    entfernte = entfernte.filter((t) => !stand.drinks.some((d) => d.slug === t.slug));

    seite.querySelector(".mixplan-summe").textContent = vorLeeren ? "Mixplan geleert."
      : bekannte.length ? umfang(bekannte)
      : "Noch nichts geplant.";
    const leeren = seite.querySelector('[data-aktion="leeren"]');
    leeren.replaceChildren(vorLeeren ? "Rückgängig" : "Mixplan leeren");
    if (vorLeeren) leeren.setAttribute("aria-label", "Rückgängig: Mixplan wiederherstellen");
    else leeren.removeAttribute("aria-label");
    // Unsichtbar statt weg: Der Platz bleibt, nichts rückt nach.
    leeren.classList.toggle("unsichtbar", !stand.drinks.length && !vorLeeren);
    seite.querySelector(".mixplan-leer").hidden = stand.drinks.length > 0;

    const aktionen = seite.querySelector(".plan-aktionen");
    aktionen.hidden = !bekannte.length;
    if (bekannte.length) {
      const mixen = aktionen.querySelector('[data-rolle="mixen"]');
      mixen.href = zumRezept(bekannte[0].slug);
      mixen.setAttribute("aria-label", `Mixen, beginnend mit ${index.get(bekannte[0].slug).titel}`);
    }

    // Soll-Reihenfolge: jeder Grabstein vor dem Drink, der jetzt an seiner alten Stelle
    // steht — so bleibt „Rückgängig" genau dort, wo die Zeile war. Mehrere an derselben
    // Stelle in der Reihenfolge von entfernte, die der auf dem Bildschirm entspricht.
    // Die Stellen führt nur dieser Tab nach: Nimmt ein anderer währenddessen einen Drink
    // darüber weg, rutscht der Grabstein eine Zeile tiefer. Selten genug, um es so zu lassen.
    const liste = seite.querySelector(".plan-liste");
    const soll = [];
    stand.drinks.forEach((d, i) => {
      for (const t of entfernte) if (t.stelle === i) soll.push(["t:" + t.slug, t]);
      soll.push(["d:" + d.slug, d]);
    });
    for (const t of entfernte) if (t.stelle >= stand.drinks.length) soll.push(["t:" + t.slug, t]);
    const vorhanden = new Map([...liste.children].map((li) => [li.dataset.zeile, li]));
    const zeilen = soll.map(([key, eintrag]) => {
      const alt = vorhanden.get(key);
      vorhanden.delete(key);
      const li = key.startsWith("d:") ? zeichneZeile(alt, eintrag, auswahl) : zeichneGrabstein(alt, eintrag);
      li.dataset.zeile = key;
      return li;
    });
    for (const alt of vorhanden.values()) alt.remove();
    zeilen.forEach((li, i) => {
      if (liste.children[i] !== li) liste.insertBefore(li, liste.children[i] ?? null);
    });

    // Leerer Plan beim ersten Zeichnen: Auswahl gleich offen — die leere Liste ist dann
    // auch die Seite zum Auswählen. Später bleibt sie, wie man sie gelassen hat.
    if (!auswahl.dataset.gebaut) {
      auswahl.dataset.gebaut = "1";
      if (!bekannte.length) auswahl.open = true;
    }
    for (const knopf of auswahl.querySelectorAll(".auswahl-zeile")) {
      const titel = index.get(knopf.dataset.slug)?.titel;
      const d = stand.drinks.find((x) => x.slug === knopf.dataset.slug);
      const zahl = knopf.querySelector(".auswahl-zahl");
      zahl.hidden = !d;
      zahl.textContent = d ? String(d.anzahl) : "";
      knopf.setAttribute("aria-label", waehlenName(titel, d));
    }
  }

  function zeichneZeile(li, d, auswahl) {
    const rezept = index.get(d.slug);
    const art = rezept ? "bekannt" : "veraltet";
    if (!li || li.dataset.art !== art) {
      li = el("li", "plan-zeile");
      li.dataset.art = art;
      if (rezept) {
        const link = el("a", "plan-link");
        link.href = zumRezept(d.slug);
        // Das Vorschaubild ist schon in der Auswahl — von dort geborgt, braucht die Seite
        // keinen eigenen Datenblock.
        const bild = auswahl?.querySelector(`[data-slug="${CSS.escape(d.slug)}"] .auswahl-bild`)?.cloneNode(true);
        if (bild) {
          bild.classList.replace("auswahl-bild", "plan-bild");
          link.append(bild);
        }
        link.append(el("span", "plan-name", rezept.titel));
        li.append(link, baueStepper(d.slug, rezept.titel));
      } else {
        // Umbenannt oder gelöscht: Die Zeile bleibt sichtbar und geht nur auf Tipp weg.
        // Von selbst aufräumen könnte ein Tab mit älterem Stand sonst einen Drink, den ein
        // neuerer gerade hinzugefügt hat.
        const name = el("p", "plan-name");
        name.append(el("span", null, d.titel), " ", el("span", "veraltet-hinweis", "gibt es nicht mehr"));
        const weg = el("button", "stepper-knopf");
        weg.type = "button";
        weg.dataset.aktion = "weg";
        weg.dataset.slug = d.slug;
        weg.setAttribute("aria-label", `${d.titel} entfernen`);
        setzeSymbol(weg, "weg");
        li.append(name, weg);
      }
    }
    if (rezept) aktualisiereStepper(li.querySelector(".stepper"), d, rezept.titel, true);
    return li;
  }

  // Eine entfernte Zeile wird zum Grabstein gleicher Höhe — tippt der Daumen weiter,
  // landet er auf „Rückgängig" statt auf dem „−" des nächsten Drinks.
  function zeichneGrabstein(li, t) {
    if (li) return li;
    li = el("li", "plan-zeile entfernt");
    if (t.hoehe) li.style.minHeight = `${t.hoehe}px`;
    const zurueck = el("button", "leise", "Rückgängig");
    zurueck.type = "button";
    zurueck.dataset.aktion = "zurueck";
    zurueck.dataset.slug = t.slug;
    zurueck.setAttribute("aria-label", `Rückgängig: ${t.titel} wieder auf den Mixplan`);
    li.append(el("p", "plan-name", `${t.titel} entfernt`), zurueck);
    return li;
  }

  // --- Besorgen -------------------------------------------------------------------------

  // Die Zutaten aller Rezepte stehen schon zerlegt im Datenblock der Seite (Filter
  // besorgenDaten). Gemerkt pro Block: Nach einem Seitenwechsel ist es ein neuer.
  const datenCache = new WeakMap();
  function besorgenDaten(seite) {
    const block = seite.querySelector("#besorgen-daten");
    if (!block) return null;
    if (!datenCache.has(block)) {
      let daten = null;
      try { daten = JSON.parse(block.textContent); } catch { /* bleibt null */ }
      datenCache.set(block, daten);
    }
    return datenCache.get(block);
  }

  // Zahlen wie in den Rezepten: ganze Zahlen ganz, halbe Teelöffel als ½, sonst mit Komma.
  function zahl(n, bruch) {
    const gerundet = Math.round(n * 100) / 100;
    const ganz = Math.trunc(gerundet);
    const rest = Math.round((gerundet - ganz) * 100) / 100;
    if (!rest) return String(ganz);
    const glyphe = bruch && { 0.25: "¼", 0.5: "½", 0.75: "¾" }[rest];
    if (glyphe) return (ganz || "") + glyphe;
    return String(gerundet).replace(".", ",");
  }
  // Ein Eimer je Einheit: gleiche Einheiten werden addiert, mal der Zahl der Gläser.
  function fuelle(eimer, teile, faktor) {
    for (const t of teile) {
      const b = eimer.get(t.einheit) ?? { von: 0, bis: 0, ca: false, bruch: false };
      b.von += t.von * faktor;
      b.bis += t.bis * faktor;
      b.ca ||= t.ca;
      b.bruch ||= t.bruch;
      eimer.set(t.einheit, b);
    }
    return eimer;
  }
  const MEHRZAHL = { Prise: "Prisen", Blatt: "Blätter" };
  // Geschützte Leerzeichen in jeder Angabe: Die Mengenspalte darf umbrechen, aber nur
  // zwischen den Teilen („+"), nicht zwischen Zahl und Einheit.
  const NB = " ";
  function mengen(eimer) {
    return [...eimer].map(([einheit, b]) => {
      const betrag = b.von === b.bis ? zahl(b.von, b.bruch) : `${zahl(b.von, b.bruch)}${NB}–${NB}${zahl(b.bis, b.bruch)}`;
      return `${b.ca ? `ca.${NB}` : ""}${betrag}${NB}${b.bis > 1 ? MEHRZAHL[einheit] ?? einheit : einheit}`;
    });
  }

  // Zählt den Plan zur Besorgen-Liste zusammen (README, „Wie Mengen zusammengezählt werden"):
  // gleiche Einheit wird addiert, „ca." steckt an, Bereiche bleiben Bereiche, Wörtliches
  // („zum Auffüllen") bleibt wörtlich, „(optional)" wird getrennt geführt.
  function rechne(daten, bekannte) {
    const posten = new Map();
    const glasZahl = new Map();
    const werkzeug = new Set();
    for (const d of bekannte) {
      const rezept = daten.rezepte[d.slug];
      if (!rezept) continue;
      const wer = d.anzahl > 1 ? `${index.get(d.slug).titel} ×${d.anzahl}` : index.get(d.slug).titel;
      for (const p of rezept.posten) {
        let z = posten.get(p.key);
        if (!z) {
          z = { key: p.key, gruppe: p.gruppe, rang: p.rang ?? Infinity, name: null, nameOptional: null,
            pflicht: new Map(), optional: new Map(), textePflicht: [], texteOptional: [], fuer: [] };
          posten.set(p.key, z);
        }
        if (p.optional) z.nameOptional ??= p.name;
        else z.name ??= p.name;
        fuelle(p.optional ? z.optional : z.pflicht, p.teile ?? [], d.anzahl);
        if (p.text) {
          const texte = p.optional ? z.texteOptional : z.textePflicht;
          if (!texte.includes(p.text)) texte.push(p.text);
        }
        z.fuer.push(wer + (p.optional ? " (optional)" : p.text ? ` (${p.text})` : ""));
      }
      const g = glasZahl.get(rezept.glas) ?? { anzahl: 0, fuer: [] };
      g.anzahl += d.anzahl;
      g.fuer.push(wer);
      glasZahl.set(rezept.glas, g);
      for (const w of rezept.werkzeug) werkzeug.add(w);
    }

    const gruppen = daten.gruppen.map(([id, name]) => ({ id, name, zeilen: [] }));
    const gruppeVon = new Map(gruppen.map((g) => [g.id, g]));
    // Map behält die Reihenfolge des ersten Auftretens, sort() ist stabil: Was die Daten
    // nicht einordnen („Sonstiges"), steht in Plan-Reihenfolge.
    for (const z of [...posten.values()].sort((a, b) => a.rang - b.rang)) {
      const pflicht = [...mengen(z.pflicht), ...z.textePflicht];
      const optional = [...mengen(z.optional), ...z.texteOptional];
      const menge = (pflicht.length ? pflicht : optional).join(" + ");
      const zusatz = pflicht.length && optional.length ? `+ ${optional.join(" + ")} optional` : "";
      (gruppeVon.get(z.gruppe) ?? gruppeVon.get("sonstiges")).zeilen.push({
        key: "z:" + z.key,
        name: z.name ?? z.nameOptional,
        optional: !pflicht.length,
        menge,
        zusatz,
        fuer: z.fuer.join(" · "),
        // Ein Haken gilt für genau die Menge, bei der er gesetzt wurde (README).
        signatur: zusatz ? `${menge} | ${zusatz}` : menge,
      });
    }
    const glasReihe = (glas) => (daten.glaeser.includes(glas) ? daten.glaeser.indexOf(glas) : Infinity);
    gruppen.push({ id: "glaeser", name: "Gläser", zeilen: [...glasZahl]
      .sort(([a], [b]) => glasReihe(a) - glasReihe(b))
      .map(([glas, g]) => ({ key: "glas:" + glas.toLowerCase(), name: glas, menge: String(g.anzahl), fuer: g.fuer.join(" · "), signatur: String(g.anzahl) })) });
    gruppen.push({ id: "werkzeug", name: "Werkzeug", zeilen: [...werkzeug]
      .sort((a, b) => a.localeCompare(b, "de"))
      .map((w) => ({ key: "werkzeug:" + w.toLowerCase(), name: w, menge: "", signatur: "1" })) });
    return { gruppen: gruppen.filter((g) => g.zeilen.length) };
  }

  // Was schon gezeichnet ist, je Behälter — gleicht die neue Liste ihm, werden nur die
  // Haken nachgeführt. Die Kästchen bleiben dann dieselben, samt Fokus.
  const gezeichnet = new WeakMap();
  function zeichneBesorgen(seite, stand, bekannte) {
    const daten = besorgenDaten(seite);
    if (!daten) return;
    seite.querySelector(".mixplan-ui").hidden = false;
    const liste = rechne(daten, bekannte);

    const lead = seite.querySelector(".besorgen-lead");
    lead.textContent = bekannte.length ? `Für ${umfang(bekannte)}` : "";
    lead.hidden = !bekannte.length;
    seite.querySelector(".besorgen-leer").hidden = bekannte.length > 0;
    seite.querySelector(".besorgen-veraltet").replaceChildren(...stand.drinks
      .filter((d) => !index.has(d.slug))
      .map((d) => el("li", null, `${d.titel} fehlt im Rezeptbuch und ist nicht mitgezählt.`)));

    const behaelter = seite.querySelector(".besorgen-gruppen");
    const struktur = JSON.stringify(liste.gruppen);
    if (gezeichnet.get(behaelter) !== struktur) {
      gezeichnet.set(behaelter, struktur);
      let nr = 0;
      behaelter.replaceChildren(...liste.gruppen.map((gruppe) => {
        const abschnitt = el("section", "besorgen-gruppe");
        const ul = el("ul", "besorgen-liste");
        for (const z of gruppe.zeilen) {
          const label = el("label", "posten");
          const box = el("input");
          box.type = "checkbox";
          box.dataset.key = z.key;
          box.dataset.signatur = z.signatur;
          const name = el("span", "posten-name", z.name);
          if (z.optional) name.append(" ", el("span", "optional-marke", "optional"));
          label.append(box, name, el("span", "posten-menge", z.menge));
          if (z.zusatz) label.append(el("span", "posten-zusatz", z.zusatz));
          // Für wen: Gibt es den Lillet im Laden nicht, sieht man, welcher Drink wackelt.
          // Als Beschreibung des Kästchens, nicht als Teil seines Namens.
          if (z.fuer) {
            const fuer = el("span", "posten-fuer", z.fuer);
            fuer.id = `besorgen-fuer-${++nr}`;
            fuer.setAttribute("aria-hidden", "true");
            box.setAttribute("aria-describedby", fuer.id);
            label.append(fuer);
          }
          const li = el("li");
          li.append(label);
          ul.append(li);
        }
        abschnitt.append(el("h2", null, gruppe.name), ul);
        return abschnitt;
      }));
    }

    // Abgehakte Zeilen bleiben, wo sie sind — nichts springt unter dem Finger weg.
    let abgehakt = 0;
    const kaestchen = behaelter.querySelectorAll('input[type="checkbox"]');
    for (const box of kaestchen) {
      const an = stand.haken[box.dataset.key] === box.dataset.signatur;
      box.checked = an;
      box.closest(".posten").classList.toggle("abgehakt", an);
      if (an) abgehakt++;
    }
    seite.querySelector(".besorgen-stand").textContent = !kaestchen.length ? ""
      : abgehakt === kaestchen.length ? "Alles beisammen."
      : `${abgehakt} von ${kaestchen.length} abgehakt`;
    const hakenWeg = seite.querySelector('[data-aktion="haken-weg"]');
    hakenWeg.replaceChildren(vorHakenWeg ? "Rückgängig" : "Alle Haken entfernen");
    if (vorHakenWeg) hakenWeg.setAttribute("aria-label", "Rückgängig: Haken wiederherstellen");
    else hakenWeg.removeAttribute("aria-label");
    hakenWeg.classList.toggle("unsichtbar", !abgehakt && !vorHakenWeg);
  }

  // --- Teilen ---------------------------------------------------------------------------

  // Der Plan lebt im Browser — geteilt wird er deshalb als Adresse, die ihn mitbringt:
  // …/mixplan/?plan=negroni:2,white-lady,aperol-spritz:3 (ein Glas ohne Zahl). Lesbar statt
  // verschlüsselt, und kurz genug: Jeder Drink steht höchstens einmal darin, mit gut 17
  // Zeichen im Schnitt. Rezeptnamen statt Nummern, damit ein neues Rezept alte Links nicht
  // verschiebt. Haken reisen nicht mit — sie gehören dem, der abhakt.
  const planCode = (liste) => liste.map((d) => (d.anzahl > 1 ? `${d.slug}:${d.anzahl}` : d.slug)).join(",");

  // Gelesen wird großzügig: Chat-Apps hängen gern ein Satzzeichen an („…:3." am Satzende)
  // oder setzen Großbuchstaben. Was dieser Build nicht kennt, lässt sich hier nicht mixen und
  // fällt weg — wie viele, zählt verloren, damit die Seite es sagen kann.
  function liesPlanCode(code) {
    const liste = [];
    let verloren = 0;
    for (const roh of String(code).toLowerCase().replace(/[^a-z0-9]+$/, "").split(",")) {
      const teil = roh.trim();
      const m = /^([a-z0-9][a-z0-9-]{0,80})(?::(\d{1,6}))?$/.exec(teil);
      if (!m || !index.has(m[1])) {
        if (teil) verloren++;
        continue;
      }
      if (liste.some((d) => d.slug === m[1])) continue;
      const anzahl = Math.min(Math.max(Number(m[2] ?? 1), 1), MAX_GLAESER);
      liste.push({ slug: m[1], anzahl, titel: index.get(m[1]).titel });
      if (liste.length >= 100) break;
    }
    return { liste, verloren };
  }
  const fehltText = (verloren) =>
    (verloren ? ` ${verloren === 1 ? "Ein Drink" : `${verloren} Drinks`} aus dem Link gibt es hier nicht.` : "");

  // share.js fragt auf Mixplan und Besorgen nach der Adresse: dieselbe Seite samt Plan —
  // wer einkaufen geht, landet also gleich auf der Besorgen-Liste.
  document.addEventListener("teilen-adresse", (event) => {
    const bekannte = lies().drinks.filter((d) => index.has(d.slug));
    if (bekannte.length) event.detail.url = new URL(`${location.pathname}?plan=${planCode(bekannte)}`, location.href).href;
  });

  // Ein geteilter Plan, der auf einen eigenen trifft. { drinks } wird angeboten; mit vorher
  // ist er übernommen, und „Rückgängig" holt den eigenen Plan zurück; erledigt heißt, das
  // Rückgängig ist verfallen, weil eine andere Änderung dazwischenkam. Der Kasten bleibt dann
  // ohne Knöpfe stehen, bis die Seite wechselt — verschwände er, rückte alles darunter unter
  // den Finger, der gerade auf „+" oder ein Kästchen tippt.
  let angebot = null;
  function angebotVerfaellt() {
    if (angebot?.vorher) angebot = { drinks: angebot.drinks, verloren: angebot.verloren, erledigt: true };
  }

  // Die Adresse ändert sich hier ohne Seitenwechsel. nav.js merkt sich, zu welcher Adresse
  // der gezeigte Inhalt gehört, und erfährt es deshalb (Ereignis „adresse-ersetzt").
  function setzeAdresse(suche) {
    try { history.replaceState(history.state, "", location.pathname + suche + location.hash); } catch { return; }
    document.dispatchEvent(new Event("adresse-ersetzt"));
  }
  const bereinigeAdresse = () => setzeAdresse("");

  // Ankunft auf Mixplan oder Besorgen mit ?plan=: Ist der eigene Plan leer (verschwundene
  // Rezepte zählen nicht, die lassen sich ohnehin nicht mehr mixen) oder schon derselbe, gilt
  // der geteilte sofort; sonst bietet die Seite ihn an und fragt. Erst wenn das entschieden
  // ist, verschwindet ?plan= aus der Adresse — ein versehentliches Neuladen fragt also noch
  // einmal, statt den geteilten Plan zu verlieren.
  // Das ist der eine Schreibzugriff ohne eigenen Tipp: Einen geteilten Link zu öffnen ist
  // die Handlung, und sie geschieht genau einmal.
  function nimmGeteiltenAn() {
    angebot = null;
    if (!document.querySelector("main #mixplan, main #besorgen")) return;
    const code = new URLSearchParams(location.search).get("plan");
    if (code === null) return;
    const { liste: geteilt, verloren } = liesPlanCode(code);
    const eigen = lies().drinks.filter((d) => index.has(d.slug));
    if (geteilt.length && eigen.length && planCode(eigen) !== planCode(geteilt)) {
      angebot = { drinks: geteilt, verloren };
      return;
    }
    bereinigeAdresse();
    if (geteilt.length && !eigen.length) {
      aendere((stand) => { stand.drinks = geteilt; stand.haken = {}; });
      ansage(`Geteilten Mixplan übernommen.${fehltText(verloren)}`);
    } else if (!geteilt.length && verloren) {
      ansage("Im geteilten Link steht kein Drink, den es hier gibt.");
    }
  }

  // Der Kasten oben auf Mixplan und Besorgen: was geteilt wurde, was „Übernehmen" ersetzt.
  // „Übernehmen" wird an derselben Stelle zu „Rückgängig", wie beim Leeren. Titel und
  // Zeilen bleiben in jedem Zustand dieselben, und der Hinweis behält seine größte Höhe —
  // so wandert kein Knopf, und unter dem Kasten rückt nichts nach.
  function zeichneAngebot(seite, bekannte) {
    const kasten = seite.querySelector(".geteilt");
    if (!kasten) return;
    // Derselbe Plan steht inzwischen ohnehin da (derselbe Link in einem anderen Tab).
    if (angebot && !angebot.vorher && !angebot.erledigt && planCode(bekannte) === planCode(angebot.drinks)) {
      angebot = null;
      bereinigeAdresse();
    }
    kasten.hidden = !angebot;
    if (!angebot) return;
    if (!kasten.dataset.gebaut) {
      kasten.dataset.gebaut = "1";
      const knoepfe = el("div", "geteilt-knoepfe");
      for (const [aktion, klasse] of [["uebernehmen", "geteilt-uebernehmen"], ["behalten", "geteilt-behalten"]]) {
        const knopf = el("button", klasse);
        knopf.type = "button";
        knopf.dataset.aktion = aktion;
        knoepfe.append(knopf);
      }
      kasten.append(el("p", "geteilt-titel", "Geteilter Mixplan"), el("p", "geteilt-drinks"), el("p", "geteilt-hinweis"), knoepfe);
    }
    const { vorher, erledigt } = angebot;
    kasten.querySelector(".geteilt-drinks").textContent =
      angebot.drinks.map((d) => (d.anzahl > 1 ? `${d.titel}${NB}×${d.anzahl}` : d.titel)).join(" · ");
    const eigen = umfang(vorher ? vorher.drinks.filter((d) => index.has(d.slug)) : bekannte);
    const hinweis = kasten.querySelector(".geteilt-hinweis");
    const hoehe = hinweis.getBoundingClientRect().height;  // genau, offsetHeight rundet
    if (hoehe) hinweis.style.minHeight = `${Math.max(hoehe, parseFloat(hinweis.style.minHeight) || 0)}px`;
    hinweis.textContent = erledigt ? `Übernommen.${fehltText(angebot.verloren)}`
      : vorher ? `„Rückgängig“ holt den bisherigen zurück (${eigen}).`
      : `„Übernehmen“ ersetzt den jetzigen Mixplan (${eigen}).${fehltText(angebot.verloren)}`;
    const uebernehmen = kasten.querySelector(".geteilt-uebernehmen");
    uebernehmen.textContent = vorher || erledigt ? "Rückgängig" : "Übernehmen";
    uebernehmen.classList.toggle("unsichtbar", Boolean(erledigt));
    if (vorher) uebernehmen.setAttribute("aria-label", "Rückgängig: eigenen Mixplan wiederherstellen");
    else uebernehmen.removeAttribute("aria-label");
    // Unsichtbar statt weg: Der Platz bleibt.
    const behalten = kasten.querySelector(".geteilt-behalten");
    behalten.textContent = "Meinen behalten";
    behalten.classList.toggle("unsichtbar", Boolean(vorher || erledigt));
  }

  function uebernehmen(seite) {
    if (!angebot || angebot.erledigt) return;
    // Grabsteine gehörten zum Plan, der jetzt ersetzt wird.
    entfernte = [];
    if (angebot.vorher) {
      const { vorher } = angebot;
      angebot = { drinks: angebot.drinks, verloren: angebot.verloren };
      aendere((stand) => { stand.drinks = vorher.drinks; stand.haken = vorher.haken; }, { behalte: "angebot" });
      // Wieder offen — dann gehört der Plan auch wieder in die Adresse.
      setzeAdresse(`?plan=${planCode(angebot.drinks)}`);
      ansage("Eigener Mixplan wiederhergestellt.");
    } else {
      angebot = { drinks: angebot.drinks, verloren: angebot.verloren, vorher: lies() };
      aendere((stand) => { stand.drinks = angebot.drinks.map((d) => ({ ...d })); stand.haken = {}; }, { behalte: "angebot" });
      bereinigeAdresse();
      ansage("Geteilten Mixplan übernommen.");
    }
    // Die ganze Seite, nicht nur der Kasten: Darunter steht danach eine andere Liste.
    schone(seite);
  }

  function behalten(seite) {
    angebot = null;
    bereinigeAdresse();
    zeichne();
    // Der Kasten verschwindet, alles darunter rückt unter den Finger.
    schone(seite);
    ansage("Eigener Mixplan bleibt.");
    // Mit dem Kasten ist der Fokus weg — zurück an den Anfang des Inhalts, nicht auf den
    // nächsten Knopf: Das wäre „Mixplan leeren".
    document.querySelector("main")?.focus({ preventScroll: true });
  }

  // --- Tipps ----------------------------------------------------------------------------

  document.addEventListener("click", (event) => {
    const knopf = event.target.closest?.("main [data-aktion]");
    if (!knopf) return;
    const slug = knopf.dataset.slug;
    const titel = slug ? index.get(slug)?.titel ?? lies().drinks.find((d) => d.slug === slug)?.titel ?? slug : "";
    const bereich = knopf.closest(".mixplan-feld, .mixplan-seite");
    switch (knopf.dataset.aktion) {
      case "dazu": return dazu(slug, titel, bereich);
      case "mehr": return mehr(slug, titel);
      case "waehlen": {
        // Ein neuer Drink schiebt über der Auswahl eine Zeile ein — die getippte Zeile
        // bleibt trotzdem unter dem Finger, sonst träfe ein zweiter Tipp den Nachbarn.
        const vorher = knopf.getBoundingClientRect().top;
        mehr(slug, titel);
        const versatz = knopf.getBoundingClientRect().top - vorher;
        if (versatz) window.scrollBy(0, versatz);
        return;
      }
      case "weniger":
      case "weg": return weniger(slug, titel, knopf, bereich);
      case "zurueck": return zurueckHolen(slug, titel, bereich);
      case "leeren": return leeren(bereich);
      case "haken-weg": return hakenWeg(bereich);
      case "uebernehmen": return uebernehmen(bereich);
      case "behalten": return behalten(bereich);
    }
  });

  // Ein Plan mit 100 Einträgen (fremde oder verschwundene Rezepte) nimmt nichts mehr an —
  // dann wird auch nichts angesagt, was nicht passiert ist.
  const steht = (slug) => lies().drinks.some((d) => d.slug === slug);

  function dazu(slug, titel, feld) {
    const leiste = document.querySelector("main .mixleiste");
    const leisteNeu = leiste?.hidden;
    aendere((stand) => {
      if (stand.drinks.some((d) => d.slug === slug)) return;
      const neu = { slug, anzahl: 1, titel };
      // Gleich wieder hinzugefügt: zurück an den alten Platz — die Reihenfolge des Plans
      // ist die, in der gemixt wird.
      const stelle = wiederDazu.get(slug);
      if (stelle === undefined) stand.drinks.push(neu);
      else stand.drinks.splice(Math.min(stelle, stand.drinks.length), 0, neu);
    });
    if (!steht(slug)) return;
    wiederDazu.delete(slug);
    schone(feld);
    // Die Mixleiste taucht jetzt unten auf — womöglich genau unter dem Finger, der noch
    // einmal tippt. Sie bekommt deshalb dieselbe Schonzeit, und das Feld rückt über sie,
    // falls sie es verdeckt (scroll-padding in style.css).
    if (leisteNeu && !leiste.hidden) schone(leiste);
    feld.scrollIntoView({ block: "nearest" });
    ansage(`${titel} steht auf dem Mixplan.`);
    feld.querySelector('[data-aktion="mehr"]')?.focus({ preventScroll: true });
  }

  function mehr(slug, titel) {
    let anzahl = 0;
    aendere((stand) => {
      const d = stand.drinks.find((x) => x.slug === slug);
      if (d) anzahl = d.anzahl = Math.min(d.anzahl + 1, MAX_GLAESER);
      else stand.drinks.push({ slug, anzahl: (anzahl = 1), titel });
    });
    if (!steht(slug)) return;
    ansage(anzahl === 1 ? `${titel} steht auf dem Mixplan.` : `${titel}: ${glaeser(anzahl)}.`);
  }

  // „−" zählt herunter; bei einem Glas (und beim Mülleimer eines verschwundenen Rezepts)
  // nimmt es den Drink vom Plan. Auf der Mixplan-Seite bleibt ein Grabstein mit
  // „Rückgängig" stehen, auf der Rezeptseite merkt sich der Plan die alte Stelle.
  function weniger(slug, titel, knopf, bereich) {
    const zeile = knopf.closest(".plan-zeile");
    const hoehe = zeile?.offsetHeight;
    let anzahl = 0;
    let entfernt = false;
    aendere((stand) => {
      const stelle = stand.drinks.findIndex((x) => x.slug === slug);
      if (stelle < 0) return;
      const d = stand.drinks[stelle];
      if (d.anzahl > 1 && knopf.dataset.aktion === "weniger") {
        anzahl = --d.anzahl;
        return;
      }
      stand.drinks.splice(stelle, 1);
      entfernt = true;
      if (zeile) {
        // entfernte steht in Bildschirm-Reihenfolge: Der neue Grabstein kommt hinter die,
        // die schon über dem Drink standen, und vor die, die darunter stehen.
        const davor = entfernte.findIndex((t) => t.stelle > stelle);
        entfernte.splice(davor < 0 ? entfernte.length : davor, 0, { slug, titel, anzahl: d.anzahl, stelle, hoehe });
      } else wiederDazu.set(slug, stelle);
      for (const t of entfernte) if (t.stelle > stelle) t.stelle--;
    });
    if (entfernt) {
      ansage(knopf.dataset.aktion === "weg" ? `${titel} entfernt.` : `${titel} vom Mixplan genommen.`);
      if (zeile) {
        const grab = bereich.querySelector(`[data-zeile="t:${CSS.escape(slug)}"]`);
        schone(grab);
        grab?.querySelector("button")?.focus({ preventScroll: true });
      } else {
        schone(bereich);
        bereich.querySelector('[data-aktion="dazu"]')?.focus({ preventScroll: true });
      }
    } else if (anzahl) {
      // Aus „−" wird gleich der Mülleimer — ein Doppeltipp soll nicht durchrutschen.
      if (anzahl === 1) schone(zeile ?? bereich);
      ansage(`${titel}: ${glaeser(anzahl)}.`);
    }
  }

  function zurueckHolen(slug, titel, seite) {
    const grab = entfernte.find((t) => t.slug === slug);
    // Ein voller Plan nimmt nichts an (aendere) — dann bleibt auch der Grabstein stehen.
    if (!grab || lies().drinks.length >= 100) return;
    aendere((stand) => {
      const nr = entfernte.indexOf(grab);
      entfernte.splice(nr, 1);
      if (stand.drinks.some((d) => d.slug === slug)) return;
      stand.drinks.splice(Math.min(grab.stelle, stand.drinks.length), 0, { slug, anzahl: grab.anzahl, titel: grab.titel });
      // Was unter dem Grabstein stand, steht jetzt unter dem zurückgeholten Drink.
      entfernte.forEach((t, i) => { if (i >= nr) t.stelle++; });
    });
    ansage(`${titel} ist wieder auf dem Mixplan.`);
    const zeile = seite.querySelector(`[data-zeile="d:${CSS.escape(slug)}"]`);
    schone(zeile);
    zeile?.querySelector('[data-aktion="mehr"], [data-aktion="weg"]')?.focus({ preventScroll: true });
  }

  // Leeren und Haken entfernen ohne Rückfrage: confirm() kostet mit nassem Daumen bei
  // jedem Leeren zwei genaue Tipps, Rückgängig einen — und nur, wenn es danebenging. Der
  // Knopf wird an derselben Stelle zu „Rückgängig".
  function leeren(seite) {
    const zeile = seite.querySelector(".summen-zeile");
    if (vorLeeren) {
      const vorher = vorLeeren;
      aendere((stand) => { stand.drinks = vorher.drinks; stand.haken = vorher.haken; });
      ansage("Mixplan wiederhergestellt.");
    } else {
      vorLeeren = lies();
      entfernte = [];
      aendere((stand) => { stand.drinks = []; stand.haken = {}; }, { behalte: "leeren" });
      ansage("Mixplan geleert.");
    }
    schone(zeile);
  }

  function hakenWeg(seite) {
    const zeile = seite.querySelector(".summen-zeile");
    if (vorHakenWeg) {
      const vorher = vorHakenWeg;
      aendere((stand) => { stand.haken = vorher; });
      ansage("Haken wiederhergestellt.");
    } else {
      vorHakenWeg = lies().haken;
      aendere((stand) => { stand.haken = {}; }, { behalte: "haken" });
      ansage("Alle Haken entfernt.");
    }
    schone(zeile);
  }

  document.addEventListener("change", (event) => {
    const box = event.target;
    if (!(box instanceof HTMLInputElement) || box.type !== "checkbox" || !box.closest("#besorgen")) return;
    aendere((stand) => {
      if (box.checked) stand.haken[box.dataset.key] = box.dataset.signatur;
      else delete stand.haken[box.dataset.key];
    });
  });

  // --- Anlässe zum Neuzeichnen ----------------------------------------------------------

  // Neuer Inhalt in <main> (nav.js): Rückgängig und Grabsteine gehörten zur alten Seite.
  // Und unter dem Finger, der eben getippt hat, liegt jetzt etwas anderes — „Weiter" des
  // nächsten Drinks, ein Kästchen auf Besorgen, „Mixen" nach „Fertig". Ein Doppeltipp
  // träfe es. Der ganze neue Inhalt bekommt deshalb eine Schonzeit; absichtlich tippt
  // niemand so schnell auf etwas, das gerade erst erschienen ist.
  document.addEventListener("seitenwechsel", () => {
    vorLeeren = null;
    vorHakenWeg = null;
    entfernte = [];
    wiederDazu.clear();
    nimmGeteiltenAn();
    zeichne();
    schone(document.querySelector("main"));
  });

  // Zugeklappt wird die Auswahl auf einen Schlag gut 900 px kürzer, und auf einer kurzen
  // Seite rutscht dabei alles darüber unter den Finger. toggle steigt nicht auf, daher
  // die Capture-Phase.
  document.addEventListener("toggle", (event) => {
    if (event.target.matches?.(".mixplan-auswahl") && !event.target.open) schone(event.target.closest(".mixplan-seite"));
  }, true);

  // Ein anderer Tab hat den Plan geändert (key null: dort wurde alles geleert). Ein
  // angebotenes Rückgängig stellte jetzt einen Stand her, der dessen Änderung verschluckt.
  window.addEventListener("storage", (event) => {
    if (event.key !== KEY && event.key !== null) return;
    vorLeeren = null;
    vorHakenWeg = null;
    angebotVerfaellt();
    zeichne();
  });

  // iOS stellt eingefrorenen Tabs storage-Ereignisse nicht immer zu, und aus dem bfcache
  // kommt die Seite ohne Neustart dieses Skripts zurück — beides holt den Stand frisch.
  // Hat sich dabei etwas geändert, gilt dasselbe wie beim storage-Ereignis.
  function zurueckGekommen() {
    if (fremdGeaendert()) {
      vorLeeren = null;
      vorHakenWeg = null;
      angebotVerfaellt();
    }
    zeichne();
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") zurueckGekommen();
  });
  window.addEventListener("pageshow", (event) => {
    if (event.persisted) zurueckGekommen();
  });

  nimmGeteiltenAn();
  zeichne();
})();
