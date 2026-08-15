// Hält den Bildschirm wach, solange die Seite offen ist — beim Mixen hat man selten
// eine trockene Hand frei, um das Telefon wieder zu entsperren.
//
// Die Sperre ist nichts, was man einmal holt und dann hat. Zwei Dinge machen sie
// besonders auf iOS flüchtig:
//   1. Der Browser gibt sie frei, sobald die Seite in den Hintergrund geht.
//   2. Für die Anfrage will iOS eine Nutzergeste sehen. Eine gerade geladene Seite
//      hat keine — der Tipp auf den Link zählt für das alte Dokument, nicht für das
//      neue. Wer ein Rezept öffnet und das Telefon weglegt, bekommt also nichts.
// Gegen (1) fragen wir bei jeder Gelegenheit neu nach. Gegen (2) hilft nur, das
// Dokument nicht mehr wegzuwerfen: nav.js tauscht bei internen Links bloß den Inhalt
// aus, damit die einmal geholte Sperre den ganzen Besuch übersteht. Deshalb läuft
// dieses Skript auf allen Seiten und nicht mehr nur auf den Rezeptseiten.
//
// Der Schalter in der Kopfzeile ist die Rückfallebene: der einzige Weg, bei dem
// garantiert eine Nutzergeste hinter der Anfrage steht. Und er sagt ehrlich, ob die
// Sperre gerade wirklich hält — vorher konnte man das nur am dunklen Display merken.
(function () {
  if (!("wakeLock" in navigator)) return;

  const KEY = "bildschirm";

  // Safari kann localStorage sperren (private Fenster, Speicher voll). Dann merken
  // wir uns die Wahl eben nur für diese Seite.
  const merker = {
    lies() { try { return localStorage.getItem(KEY); } catch { return null; } },
    schreib(wert) { try { localStorage.setItem(KEY, wert); } catch { /* egal */ } },
  };

  let sentinel = null;
  let laeuft = false;
  let absage = "";
  let gewuenscht = merker.lies() !== "aus";

  const haelt = () => sentinel !== null && !sentinel.released;

  async function hole() {
    // `laeuft` verhindert, dass zwei Anlässe kurz hintereinander (Tipp und
    // Sichtbarkeitswechsel) zwei Sperren holen, von denen wir nur eine kennen.
    if (laeuft || haelt() || !gewuenscht || document.visibilityState !== "visible") return;

    laeuft = true;
    try {
      sentinel = await navigator.wakeLock.request("screen");
      absage = "";
      sentinel.addEventListener("release", () => { sentinel = null; zeige(); });
    } catch (fehler) {
      // Akkusparmodus, fehlende Nutzergeste, verweigerte Erlaubnis. Kein Grund zur
      // Aufregung, aber wir merken uns den Namen für den Schalter — sonst rätselt
      // man beim nächsten Mal wieder, warum nichts passiert.
      sentinel = null;
      absage = fehler?.name || "unbekannt";
    } finally {
      laeuft = false;
      zeige();
    }
  }

  // Safari meldet die automatische Freigabe nicht verlässlich, und schon gar nicht
  // rechtzeitig. Wir geben deshalb selbst frei und vergessen die Sperre sofort —
  // sonst hält uns beim Zurückkommen eine längst tote Sperre für versorgt.
  function gibFrei() {
    const alt = sentinel;
    sentinel = null;
    if (alt && !alt.released) alt.release().catch(() => { /* schon weg */ });
    zeige();
  }

  // Ein Vorhängeschloss: zu = der Bildschirm bleibt an, offen = er darf ausgehen.
  // Innen kennen wir drei Zustände — der Wunsch kann anliegen, ohne dass der Browser
  // die Sperre hergibt. Beim Mixen hilft diese Unterscheidung niemandem, also zeigt
  // das Schloss schlicht die Wirklichkeit: zu ist es nur, wenn die Sperre auch hält.
  // Woran es sonst liegt, steht im Tooltip.
  const NS = "http://www.w3.org/2000/svg";
  const schloss = document.createElementNS(NS, "svg");
  schloss.setAttribute("viewBox", "0 0 24 24");
  schloss.setAttribute("aria-hidden", "true");
  schloss.setAttribute("fill", "none");
  schloss.setAttribute("stroke", "currentColor");
  schloss.setAttribute("stroke-width", "1.75");
  schloss.setAttribute("stroke-linecap", "round");
  schloss.setAttribute("stroke-linejoin", "round");

  const koerper = document.createElementNS(NS, "rect");
  koerper.setAttribute("x", "4.5");
  koerper.setAttribute("y", "10.5");
  koerper.setAttribute("width", "15");
  koerper.setAttribute("height", "10");
  koerper.setAttribute("rx", "2.5");

  // Beim offenen Schloss fehlt dem Bügel der rechte Schenkel — er ist hochgeklappt.
  const buegel = document.createElementNS(NS, "path");
  const BUEGEL_ZU = "M8 10.5V7.5a4 4 0 0 1 8 0v3";
  const BUEGEL_AUF = "M8 10.5V7.5a4 4 0 0 1 8 0";

  schloss.append(koerper, buegel);
  const schalter = document.createElement("button");
  schalter.type = "button";
  schalter.className = "wakelock-toggle";
  schalter.append(schloss);

  function zeige() {
    const zu = gewuenscht && haelt();

    schalter.dataset.state = zu ? "an" : "aus";
    schalter.setAttribute("aria-pressed", String(zu));
    buegel.setAttribute("d", zu ? BUEGEL_ZU : BUEGEL_AUF);

    const text = zu
      ? "Bildschirm bleibt an — zum Entsperren tippen"
      : "Bildschirm geht aus — zum Anlassen tippen";
    // Hat der Browser die Sperre verweigert, steht sein Grund dabei: beim Suchen
    // nach der Ursache ist das mehr wert als jede Vermutung.
    const grund = !zu && gewuenscht && absage ? ` (Browser: ${absage})` : "";

    schalter.setAttribute("aria-label", text + grund);
    schalter.title = text + grund;
  }

  schalter.addEventListener("click", () => {
    if (gewuenscht && haelt()) {
      gewuenscht = false;
      merker.schreib("aus");
      gibFrei();
    } else {
      // Hier steckt eine echte Nutzergeste dahinter — der Anlauf, der auf iOS zählt.
      gewuenscht = true;
      merker.schreib("an");
      hole();
    }
  });

  document.querySelector(".site-header")?.append(schalter);
  zeige();

  hole();

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") hole();
    else gibFrei();
  });

  // Zurück-Taste: Safari holt die Seite aus dem bfcache, das Skript läuft dann
  // nicht neu und `visibilitychange` bleibt aus. `pageshow` kommt in beiden Fällen.
  window.addEventListener("pageshow", hole);
  window.addEventListener("pagehide", gibFrei);

  // Jede Berührung ist ein weiterer Anlauf mit Nutzergeste — auch der Tipp auf einen
  // Rezept-Link, der dank nav.js kein neues Dokument mehr aufmacht.
  window.addEventListener("pointerdown", hole, { passive: true });
  window.addEventListener("click", hole);
})();
