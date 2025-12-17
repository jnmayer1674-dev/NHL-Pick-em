/****************************************************
 NHL PICK ’EM by MayerBros
 ONE PAGE GAME (game.html)

 ✔ Works with data/players.json shaped as:
   {
     meta: {...},
     players: [ {...}, {...} ]
   }

 ✔ Click any player anytime
 ✔ Auto-fills next valid slot
 ✔ FLEX = C / LW / RW only
 ✔ Single mode + VS snake draft
 ✔ Points hidden (blinded)
****************************************************/

/* =========================
   CONFIG
========================= */

const SLOTS = ["C","LW","RW","D","D","G","FLEX","FLEX"];
const FLEX_ALLOWED = new Set(["C","LW","RW"]);

const $ = (q) => document.querySelector(q);

/* =========================
   UTILITIES
========================= */

function getMode() {
  const m = new URLSearchParams(window.location.search).get("mode");
  return m === "vs" ? "vs" : "single";
}

function normalizePos(pos) {
  if (!pos) return new Set();
  return new Set(
    pos.toUpperCase()
       .replace("CENTER","C")
       .replace("LEFTWING","LW")
       .replace("RIGHTWING","RW")
       .replace("DEFENSE","D")
       .replace("DEFENCEMAN","D")
       .replace("GOALIE","G")
       .split(/[\/,|]/)
  );
}

function slotAccepts(slot, posSet) {
  if (slot === "FLEX") {
    return [...posSet].some(p => FLEX_ALLOWED.has(p));
  }
  return posSet.has(slot);
}

function nextSlotIndex(roster, posSet) {
  // Exact slots first
  for (let i = 0; i < roster.length; i++) {
    if (!roster[i].player && roster[i].slot !== "FLEX" && slotAccepts(roster[i].slot, posSet)) {
      return i;
    }
  }
  // Then FLEX
  for (let i = 0; i < roster.length; i++) {
    if (!roster[i].player && roster[i].slot === "FLEX" && slotAccepts("FLEX", posSet)) {
      return i;
    }
  }
  return -1;
}

function emptyRoster() {
  return SLOTS.map(s => ({ slot: s, player: null }));
}

function renderRoster(el, roster) {
  el.innerHTML = "";
  roster.forEach(r => {
    el.innerHTML += `
      <div class="slot">
        <div class="slot__pos">${r.slot}</div>
        <div class="slot__name">${r.player ? r.player.name : "—"}</div>
        <div class="slot__meta">${r.player ? `${r.player.team} • ${r.player.pos}` : ""}</div>
      </div>
    `;
  });
}

function renderPlayers(el, players, onPick) {
  el.innerHTML = "";
  players.forEach(p => {
    const row = document.createElement("div");
    row.className = "playerRow";
    row.innerHTML = `
      <div class="playerLeft">
        <div class="playerName">${p.name}</div>
        <div class="playerSub">${p.team} • ${p.pos}</div>
      </div>
      <div class="playerTag">Draft</div>
    `;
    row.onclick = () => onPick(p);
    el.appendChild(row);
  });
}

/* =========================
   LOAD DATA (MATCHES YOUR JSON)
========================= */

async function loadPlayers() {
  const res = await fetch("./data/players.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load players.json");

  const json = await res.json();
  if (!Array.isArray(json.players)) {
    throw new Error("players.json.players must be an array");
  }

  return json.players.map(p => ({
    id: p.id,
    name: p.name,
    team: p.team,
    pos: p.pos
  }));
}

/* =========================
   SINGLE PLAYER MODE
========================= */

function runSingle(players) {
  $("#layoutSingle").classList.remove("hidden");
  $("#teamBanner").classList.remove("hidden");

  let roster = emptyRoster();
  let drafted = new Set();

  const rosterEl = $("#rosterSingle");
  const listEl   = $("#playersListSingle");

  function pick(p) {
    const posSet = normalizePos(p.pos);
    const idx = nextSlotIndex(roster, posSet);
    if (idx === -1) return alert("No valid roster slot");

    roster[idx].player = p;
    drafted.add(p.id);

    renderRoster(rosterEl, roster);
    renderPlayers(listEl, players.filter(x => !drafted.has(x.id)), pick);
  }

  renderRoster(rosterEl, roster);
  renderPlayers(listEl, players, pick);
}

/* =========================
   VS MODE (SNAKE)
========================= */

function runVs(players) {
  $("#layoutVs").classList.remove("hidden");
  $("#turnPill").style.display = "inline-flex";

  let r1 = emptyRoster();
  let r2 = emptyRoster();
  let drafted = new Set();
  let pick = 0;

  const r1El = $("#rosterP1");
  const r2El = $("#rosterP2");
  const list = $("#playersListVs");

  function drafter() {
    const round = Math.floor(pick / 2);
    const forward = round % 2 === 0;
    return (pick % 2 === 0) === forward ? 1 : 2;
  }

  function pickPlayer(p) {
    const target = drafter() === 1 ? r1 : r2;
    const posSet = normalizePos(p.pos);
    const idx = nextSlotIndex(target, posSet);
    if (idx === -1) return alert("No valid slot");

    target[idx].player = p;
    drafted.add(p.id);
    pick++;

    renderRoster(r1El, r1);
    renderRoster(r2El, r2);
    renderPlayers(list, players.filter(x => !drafted.has(x.id)), pickPlayer);
  }

  renderRoster(r1El, r1);
  renderRoster(r2El, r2);
  renderPlayers(list, players, pickPlayer);
}

/* =========================
   BOOT
========================= */

(async function () {
  try {
    const players = await loadPlayers();
    const mode = getMode();

    if (mode === "vs") runVs(players);
    else runSingle(players);

  } catch (e) {
    console.error(e);
    alert(e.message);
  }
})();
