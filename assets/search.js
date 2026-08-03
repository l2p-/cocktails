// Sofortfilter über Name, Zutaten, Stichwörter und Zubereitung.
// Ohne JavaScript bleiben alle Rezepte sichtbar — die Seite funktioniert dann nur ohne Suche.
(function () {
  const input = document.getElementById("q");
  const grid = document.getElementById("grid");
  const empty = document.getElementById("empty");
  const status = document.getElementById("search-status");
  if (!input || !grid) return;

  const cards = Array.from(grid.querySelectorAll(".card"));
  const total = cards.length;

  const normalize = (s) =>
    s.toLowerCase()
      .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
      .normalize("NFKD").replace(/[̀-ͯ]/g, "");

  function apply(query) {
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    let shown = 0;
    for (const card of cards) {
      const hay = card.dataset.search || "";
      const match = terms.every((t) => hay.includes(t));
      card.hidden = !match;
      if (match) shown++;
    }
    empty.hidden = shown > 0;
    status.textContent = terms.length
      ? `${shown} von ${total} Rezepten`
      : `${total} Rezepte`;
  }

  input.addEventListener("input", () => apply(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      apply("");
    }
  });

  // ?q=gin von den Stichwort-Links auf den Rezeptseiten
  const preset = new URLSearchParams(location.search).get("q");
  if (preset) input.value = preset;
  apply(input.value);
})();
