// Sofortfilter über Name, Basis, Zutaten und Stichwörter — bewusst ohne
// Beschreibung und Zubereitung: Wer eine Zutat sucht, soll nur Rezepte bekommen,
// in denen sie auch drin ist (siehe README, Abschnitt Suche).
// Ohne JavaScript bleiben alle Rezepte sichtbar — die Seite funktioniert dann nur ohne Suche.
(function () {
  const input = document.getElementById("q");
  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");
  const status = document.getElementById("search-status");
  const chips = document.getElementById("filter-chips");
  const clear = document.getElementById("q-clear");
  if (!input || !grid || !empty || !status) return;

  const cards = Array.from(grid.querySelectorAll(".card"));
  const total = cards.length;

  // Muss der searchable-Normalisierung in eleventy.config.js entsprechen.
  // NFC zuerst: eingefügter Text kann zerlegte Umlaute enthalten (a + ̈), die
  // das ä-Muster sonst verfehlen würde.
  const normalize = (s) =>
    s.normalize("NFC")
      .toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .normalize("NFKD").replace(/\p{Mn}/gu, "");

  // Gängige andere Namen für dieselbe Zutat — sonst findet "Prosecco" keinen der Sekt-Drinks.
  const synonyme = {
    prosecco: "sekt", champagner: "sekt", champagne: "sekt", cava: "sekt", cremant: "sekt",
    vodka: "wodka",
    lime: "limette",
    lemon: "zitrone",
  };

  let statusTimer;

  function apply(query) {
    const terms = normalize(query).split(/\s+/).filter(Boolean).map((t) => synonyme[t] ?? t);
    let shown = 0;
    for (const card of cards) {
      const hay = card.dataset.search || "";
      const match = terms.every((t) => hay.includes(t));
      card.hidden = !match;
      if (match) shown++;
    }
    empty.hidden = shown > 0;
    if (clear) clear.hidden = !input.value;

    // Der Chip zum aktuellen Suchbegriff bekommt eine Markierung.
    chips?.querySelectorAll("a").forEach((a) =>
      a.classList.toggle("active", normalize(a.textContent) === normalize(query.trim())));

    // Nicht bei jedem Tastendruck vorlesen lassen — erst, wenn kurz Ruhe ist.
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
      status.textContent = terms.length
        ? `${shown} von ${total} Rezepten`
        : total === 1 ? "1 Rezept" : `${total} Rezepte`;
    }, 300);
  }

  // Die Suche gehört in die Adresse: So überlebt der Filter Zurück und Vorwärts
  // (nav.js holt die Seite dann mit ?q= zurück), und eine geteilte Adresse zeigt
  // dieselbe Auswahl. replaceState statt pushState — Tippen soll den aktuellen
  // Eintrag ergänzen, keinen neuen anlegen. Beim Tippen leicht verzögert:
  // Safari erlaubt nur ~100 replaceState-Aufrufe pro 30 Sekunden.
  let urlTimer;
  function merkeQuery(query, sofort) {
    clearTimeout(urlTimer);
    const schreib = () => {
      try {
        history.replaceState(history.state, "", query ? "?q=" + encodeURIComponent(query) : location.pathname);
      } catch { /* gedrosselt — dann bleibt eben kurz die vorige Adresse stehen */ }
    };
    if (sofort) schreib();
    else urlTimer = setTimeout(schreib, 250);
  }

  input.addEventListener("input", () => {
    apply(input.value);
    merkeQuery(input.value.trim());
  });

  function leeren() {
    input.value = "";
    apply("");
    merkeQuery("", true);
  }
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") leeren();
  });

  // Das Kreuz lässt den Fokus, wo er war: Wer mit offener Tastatur tippt, tippt
  // gleich weiter; wer nur die Liste zurückwill, bekommt keine Tastatur
  // aufgeklappt. Mit der Tab-Taste angesteuert verschwände der Fokus mit dem
  // Knopf — dann geht er ins Feld.
  clear?.addEventListener("mousedown", (e) => e.preventDefault());
  clear?.addEventListener("click", () => {
    const hatteFokus = document.activeElement === clear;
    leeren();
    if (hatteFokus) input.focus();
  });
  input.form?.addEventListener("submit", (e) => e.preventDefault());

  // Ein Tipp auf einen Chip filtert, ein zweiter hebt den Filter wieder auf.
  chips?.addEventListener("click", (event) => {
    const a = event.target.closest("a");
    if (!a) return;
    event.preventDefault();
    const wort = a.textContent.trim();
    input.value = input.value.trim() === wort ? "" : wort;
    apply(input.value);
    merkeQuery(input.value, true);
  });

  // ?q=gin von den Stichwort-Links auf den Rezeptseiten
  const preset = new URLSearchParams(location.search).get("q");
  if (preset) input.value = preset;
  apply(input.value);
})();
