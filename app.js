/****************************************************
 NHL PICK ’EM by MayerBros
 ONE PAGE GAME (game.html)

 DATA SHAPE (CONFIRMED):
 {
   meta: {...},
   players: [
     { id, name, team, pos, draftPoints, bestSeason }
   ]
 }

 GUARANTEES:
 - NO fantasy points shown
 - Logos load from /assets/logos/{team}.png (lowercase)
 - Single mode = randomized team rounds
 - VS mode = snake draft
****************************************************/

/* =========================
   CONFIG
========================= */

const SLOTS = ["C","LW","RW","D","D","G","FLEX","FLEX"];
const FLEX_ALLOWED = new Set(["C","LW","RW"]);
const $ = (q) => document.querySelector(q);

/* =========================
   MODE
========================= */

function getMode() {
  const m = new URLSearchParams(window.location.search).get("mode");
  return m === "vs" ? "vs" : "single";
}

/* =========================
   LOGOS (CONFIRMED PATH)
========================= */

function logoUrl(teamCode) {
  if (!teamCode) return "";
  return `./assets/logos/${String(teamCode).toLowerCase()}.png`;
}

function safeImg(imgEl, src) {
  if (!imgEl) return;
  imgEl.src = src;
  imgEl.onerror = () => { imgEl.style.display = "none"; };
  imgEl.onload  = () => { imgEl.style.display = "block"; };
}

/* =========================
   POSITIONS / SLOTS
========================= */

function normalizePos(posRaw) {
  if (!posRaw) return new Set();
  return new Set(
    String(posRaw)
      .toUpperCase()
      .replace(/\s+/g,"")
      .split(/[\/,|]/)
      .filter(Boolean)
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
    if (!roster[i].player && roster[i].slot !== "FLEX" &&
        slotAccepts(roster[i].slot, posSet)) {
      return i;
    }
  }
  // Then FLEX
  for (let i = 0; i < roster.length; i++) {
    if (!roster[i].player && roster[i].slot === "FLEX" &&
        slotAccepts("FLEX", posSet)) {
      return i;
    }
  }
  return -1;
}

/* =========================
   ROSTERS
========================= */

function emptyRoster() {
  return SLOTS.map(s => ({ slot: s, player: null }));
}

function rosterFilledCount(roster) {
  return roster.filter(r => r.player).length;
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

/* =========================
   PLAYERS LIST
========================= */

function renderPlayers(el, players, onPick) {
  el.innerHTML = "";
  players.forEach(p => {
    const row = document.createElement("div");
    row.className = "playerRow";
    row.innerHTML = `
      <div class="playerLeft">
        <img class="playerLogo" />
        <div class="playerText">
          <div class="playerName">${p.name}</div>
          <div class="playerSub">${p.team} • ${p.pos}</div>
        </div>
      </div>
      <div class="playerTag">Draft</div>
    `;
    safeImg(row.querySelector("img"), logoUrl(p.team));
    row.onclick = () => onPick(p);
    el.appendChild(row);
  });
}

/* =========================
   HELPERS
========================= */

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function uniqTeams(players) {
  return [...new Set(players.map(p => p.team))].sort();
}

/* =========================
   LOAD DATA
========================= */

async function loadPlayers() {
  const res = await fetch("./data/players.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load players.json");

  const json = await res.json();
  if (!Array.isArray(json.players)) {
    throw new Error("players.json.players must be an array");
  }

  // IMPORTANT: ignore fantasy points entirely (blinded draft)
  return json.players.map(p => ({
    id: p.id,
    name: p.name,
    team: p.team,
    pos: String(p.pos || "").toUpperCase()
  }));
}

/* =========================
   SINGLE PLAYER MODE
========================= */

function initSingle(players) {
  $("#layoutSingle").classList.remove("hidden");
  $("#teamBanner").classList.remove("hidden");

  $("#modeTitle").textContent = "Single Player";
  $("#modeSubtitle").textContent = "Random team • Blinded";

  const rosterEl = $("#rosterSingle");
  const listEl = $("#playersListSingle");
  const teamNameEl = $("#currentTeamName");
  const teamLogoEl = $("#teamLogo");
  const searchEl = $("#searchSingle");
  const progressEl = $("#singleProgress");
  const btnNextTeam = $("#btnNextTeam");
  const btnReset = $("#btnReset");

  let roster = emptyRoster();
  let drafted = new Set();
  let teams = shuffle(uniqTeams(players));
  let currentTeam = teams[0];

  function setTeam(t) {
    currentTeam = t;
    teamNameEl.textContent = t;
    safeImg(teamLogoEl, logoUrl(t));
  }

  function pool() {
    const q = (searchEl.value || "").toLowerCase();
    return players.filter(p =>
      p.team === currentTeam &&
      !drafted.has(p.id) &&
      (!q || p.name.toLowerCase().includes(q))
    );
  }

  function pick(p) {
    const idx = nextSlotIndex(roster, normalizePos(p.pos));
    if (idx === -1) return alert("No valid roster slot.");
    roster[idx].player = p;
    drafted.add(p.id);
    renderRoster(rosterEl, roster);
    progressEl.textContent = `${rosterFilledCount(roster)} / 8`;
    renderPlayers(listEl, pool(), pick);
  }

  function nextTeam() {
    teams = teams.filter(t => t !== currentTeam);
    setTeam(teams[0] || "—");
    renderPlayers(listEl, pool(), pick);
  }

  function reset() {
    roster = emptyRoster();
    drafted.clear();
    teams = shuffle(uniqTeams(players));
    setTeam(teams[0]);
    searchEl.value = "";
    renderRoster(rosterEl, roster);
    progressEl.textContent = "0 / 8";
    renderPlayers(listEl, pool(), pick);
  }

  btnNextTeam.onclick = nextTeam;
  btnReset.onclick = reset;
  searchEl.oninput = () => renderPlayers(listEl, pool(), pick);

  setTeam(currentTeam);
  renderRoster(rosterEl, roster);
  progressEl.textContent = "0 / 8";
  renderPlayers(listEl, pool(), pick);
}

/* =========================
   VS MODE (SNAKE)
========================= */

function initVs(players) {
  $("#layoutVs").classList.remove("hidden");
  $("#turnPill").classList.remove("hidden");

  $("#modeTitle").textContent = "2 Player Head-to-Head";
  $("#modeSubtitle").textContent = "Snake draft • Blinded";

  const r1El = $("#rosterP1");
  const r2El = $("#rosterP2");
  const listEl = $("#playersListVs");
  const searchEl = $("#searchVs");
  const turnPill = $("#turnPill");
  const draftInfo = $("#draftInfo");
  const p1Progress = $("#p1Progress");
  const p2Progress = $("#p2Progress");
  const btnReset = $("#btnReset");

  let r1 = emptyRoster();
  let r2 = emptyRoster();
  let drafted = new Set();
  let pickIndex = 0;

  function drafter() {
    const round = Math.floor(pickIndex / 2);
    const forward = round % 2 === 0;
    return forward ? (pickIndex % 2 === 0 ? 1 : 2)
                   : (pickIndex % 2 === 0 ? 2 : 1);
  }

  function pool() {
    const q = (searchEl.value || "").toLowerCase();
    return players.filter(p =>
      !drafted.has(p.id) &&
      (!q || p.name.toLowerCase().includes(q))
    );
  }

  function updateHeader() {
    turnPill.textContent = `Turn: Player ${drafter()}`;
    draftInfo.textContent = `Pick ${pickIndex + 1} of 16 • Snake • Blinded`;
    p1Progress.textContent = `${rosterFilledCount(r1)} / 8`;
    p2Progress.textContent = `${rosterFilledCount(r2)} / 8`;
  }

  function pick(p) {
    if (pickIndex >= 16) return;
    const roster = drafter() === 1 ? r1 : r2;
    const idx = nextSlotIndex(roster, normalizePos(p.pos));
    if (idx === -1) return alert("No valid roster slot.");
    roster[idx].player = p;
    drafted.add(p.id);
    pickIndex++;
    renderRoster(r1El, r1);
    renderRoster(r2El, r2);
    updateHeader();
    renderPlayers(listEl, pool(), pick);
  }

  function reset() {
    r1 = emptyRoster();
    r2 = emptyRoster();
    drafted.clear();
    pickIndex = 0;
    searchEl.value = "";
    renderRoster(r1El, r1);
    renderRoster(r2El, r2);
    updateHeader();
    renderPlayers(listEl, pool(), pick);
  }

  btnReset.onclick = reset;
  searchEl.oninput = () => renderPlayers(listEl, pool(), pick);

  renderRoster(r1El, r1);
  renderRoster(r2El, r2);
  updateHeader();
  renderPlayers(listEl, pool(), pick);
}

/* =========================
   BOOT
========================= */

(async function boot() {
  try {
    const players = await loadPlayers();
    const mode = getMode();

    // reset UI
    $("#layoutSingle").classList.add("hidden");
    $("#layoutVs").classList.add("hidden");
    $("#teamBanner").classList.add("hidden");
    $("#turnPill").classList.add("hidden");

    mode === "vs" ? initVs(players) : initSingle(players);

  } catch (err) {
    console.error(err);
    alert(err.message || String(err));
  }
})();
