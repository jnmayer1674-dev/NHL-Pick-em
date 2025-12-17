/****************************************************
 NHL Pick ’Em by MayerBros — One Page (game.html)

 Data shape:
   { meta: {...}, players: [...] }

 Logos:
   /assets/logos/wpg.png (lowercase)

 Behavior:
 ✅ NO fantasy points shown
 ✅ Single mode: random team rounds + team-locked pool + Next Team (no repeats)
 ✅ VS mode: snake draft BUT team rounds:
      - each round uses ONE randomized team
      - BOTH players pick from that SAME team
      - after 2 picks, advance to next team (no repeats)
 ✅ Click any player → auto-fill next valid roster slot
 ✅ FLEX = C/LW/RW only
****************************************************/

const SLOTS = ["C","LW","RW","D","D","G","FLEX","FLEX"];
const FLEX_ALLOWED = new Set(["C","LW","RW"]);
const $ = (q) => document.querySelector(q);

function getMode() {
  const m = new URLSearchParams(window.location.search).get("mode");
  return m === "vs" ? "vs" : "single";
}

/* ---------- Logos (assets/logos, lowercase) ---------- */
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

/* ---------- Positions / Slots ---------- */
function normalizePos(posRaw) {
  if (!posRaw) return new Set();
  return new Set(
    String(posRaw)
      .toUpperCase()
      .replace(/\s+/g, "")
      .split(/[\/,|]/)
      .filter(Boolean)
  );
}
function slotAccepts(slot, posSet) {
  if (slot === "FLEX") return [...posSet].some(p => FLEX_ALLOWED.has(p));
  return posSet.has(slot);
}
function nextSlotIndex(roster, posSet) {
  // Exact slots first
  for (let i = 0; i < roster.length; i++) {
    if (!roster[i].player && roster[i].slot !== "FLEX" && slotAccepts(roster[i].slot, posSet)) return i;
  }
  // Then FLEX
  for (let i = 0; i < roster.length; i++) {
    if (!roster[i].player && roster[i].slot === "FLEX" && slotAccepts("FLEX", posSet)) return i;
  }
  return -1;
}

/* ---------- Rosters ---------- */
function emptyRoster() {
  return SLOTS.map(s => ({ slot: s, player: null }));
}
function rosterFilledCount(roster) {
  return roster.filter(r => !!r.player).length;
}
function renderRoster(el, roster) {
  el.innerHTML = "";
  roster.forEach(r => {
    const name = r.player ? r.player.name : "—";
    const meta = r.player ? `${r.player.team} • ${r.player.pos}` : "";
    el.innerHTML += `
      <div class="slot">
        <div class="slot__pos">${r.slot}</div>
        <div class="slot__name">${name}</div>
        <div class="slot__meta">${meta}</div>
      </div>
    `;
  });
}

/* ---------- Players list (blinded; no points) ---------- */
function renderPlayers(el, players, onPick) {
  el.innerHTML = "";
  players.forEach(p => {
    const row = document.createElement("div");
    row.className = "playerRow";
    row.innerHTML = `
      <div class="playerLeft">
        <img class="playerLogo" alt="" />
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

/* ---------- Helpers ---------- */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
function uniqTeams(players) {
  const set = new Set();
  players.forEach(p => { if (p.team) set.add(p.team); });
  return Array.from(set).sort((a,b)=>a.localeCompare(b));
}

/* ---------- Load data ---------- */
async function loadPlayers() {
  const res = await fetch("./data/players.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Failed to load ./data/players.json");

  const json = await res.json();
  if (!Array.isArray(json.players)) throw new Error("players.json.players must be an array");

  // Ignore draftPoints/bestSeason: blinded draft
  return json.players.map(p => ({
    id: p.id,
    name: p.name,
    team: p.team,
    pos: String(p.pos || "").toUpperCase()
  }));
}

/* =========================
   SHARED TEAM BANNER
========================= */
function showTeamBanner(modeLabel, teamCode) {
  const banner = $("#teamBanner");
  const teamNameEl = $("#currentTeamName");
  const teamLogoEl = $("#teamLogo");

  banner.classList.remove("hidden");
  teamNameEl.textContent = teamCode || "—";
  safeImg(teamLogoEl, logoUrl(teamCode || ""));

  // Update subtitle to include current team context
  const sub = $("#modeSubtitle");
  if (sub && teamCode) sub.textContent = `${modeLabel} • Team: ${teamCode} • Blinded`;
}

/* =========================
   SINGLE MODE (Random Team Rounds)
========================= */
function initSingle(players) {
  $("#modeTitle").textContent = "Single Player";
  $("#modeSubtitle").textContent = "Random team rounds • Blinded";

  $("#layoutSingle").classList.remove("hidden");
  $("#layoutVs").classList.add("hidden");

  const rosterEl = $("#rosterSingle");
  const listEl = $("#playersListSingle");
  const searchEl = $("#searchSingle");
  const progressEl = $("#singleProgress");
  const btnNextTeam = $("#btnNextTeam");
  const btnReset = $("#btnReset");

  let roster = emptyRoster();
  let draftedIds = new Set();

  let teamsRemaining = shuffle(uniqTeams(players));
  let currentTeam = teamsRemaining[0] || "—";

  function updateProgress() {
    progressEl.textContent = `${rosterFilledCount(roster)} / ${roster.length}`;
  }
  function poolForTeam() {
    const q = (searchEl.value || "").trim().toLowerCase();
    const base = players
      .filter(p => p.team === currentTeam)
      .filter(p => !draftedIds.has(p.id));
    if (!q) return base;
    return base.filter(p => p.name.toLowerCase().includes(q));
  }
  function setTeam(team) {
    currentTeam = team || "—";
    showTeamBanner("Single", currentTeam);
  }

  function pickPlayer(p) {
    const idx = nextSlotIndex(roster, normalizePos(p.pos));
    if (idx === -1) return alert("No valid roster slot available for that player.");

    roster[idx].player = p;
    draftedIds.add(p.id);

    renderRoster(rosterEl, roster);
    updateProgress();
    renderPlayers(listEl, poolForTeam(), pickPlayer);
  }

  function nextTeam() {
    teamsRemaining = teamsRemaining.filter(t => t !== currentTeam);
    setTeam(teamsRemaining[0] || "—");
    renderPlayers(listEl, poolForTeam(), pickPlayer);
  }

  function reset() {
    roster = emptyRoster();
    draftedIds = new Set();
    teamsRemaining = shuffle(uniqTeams(players));
    setTeam(teamsRemaining[0] || "—");
    searchEl.value = "";
    renderRoster(rosterEl, roster);
    updateProgress();
    renderPlayers(listEl, poolForTeam(), pickPlayer);
  }

  btnNextTeam.onclick = nextTeam;
  btnReset.onclick = reset;
  searchEl.oninput = () => renderPlayers(listEl, poolForTeam(), pickPlayer);

  setTeam(currentTeam);
  renderRoster(rosterEl, roster);
  updateProgress();
  renderPlayers(listEl, poolForTeam(), pickPlayer);
}

/* =========================
   VS MODE (Snake + Team Rounds)
   - Each ROUND uses one randomized team
   - Both players pick from same team
   - After 2 picks, advance team (no repeats)
========================= */
function initVs(players) {
  $("#modeTitle").textContent = "2 Player Head-to-Head";
  $("#modeSubtitle").textContent = "Snake team rounds • Blinded";

  $("#layoutVs").classList.remove("hidden");
  $("#layoutSingle").classList.add("hidden");
  $("#turnPill").classList.remove("hidden");

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
  let draftedIds = new Set();

  // pickIndex counts individual picks 0..15
  let pickIndex = 0;

  // roundIndex counts rounds 0..7 (each round has 2 picks)
  let roundIndex = 0;

  // team rounds: no repeats
  let teamsRemaining = shuffle(uniqTeams(players));
  let currentTeam = teamsRemaining[0] || "—";

  function setTeam(team) {
    currentTeam = team || "—";
    showTeamBanner("VS", currentTeam);
  }

  // Snake drafter by round:
  // round 0: P1 then P2
  // round 1: P2 then P1
  function drafterForPick(roundIdx, pickInRound) {
    const forward = roundIdx % 2 === 0;
    if (forward) return pickInRound === 0 ? 1 : 2;
    return pickInRound === 0 ? 2 : 1;
  }

  function updateHeader() {
    const pickInRound = pickIndex % 2;
    const drafter = drafterForPick(roundIndex, pickInRound);

    turnPill.textContent = `Turn: Player ${drafter}`;
    draftInfo.textContent = `Round ${roundIndex + 1} of 8 • Team ${currentTeam} • Pick ${pickIndex + 1} of 16`;

    p1Progress.textContent = `${rosterFilledCount(r1)} / ${r1.length}`;
    p2Progress.textContent = `${rosterFilledCount(r2)} / ${r2.length}`;
  }

  function pool() {
    const q = (searchEl.value || "").trim().toLowerCase();

    // Only current team for this round, minus drafted
    const base = players
      .filter(p => p.team === currentTeam)
      .filter(p => !draftedIds.has(p.id));

    if (!q) return base;
    return base.filter(p => p.name.toLowerCase().includes(q));
  }

  function advanceTeamRound() {
    teamsRemaining = teamsRemaining.filter(t => t !== currentTeam);
    setTeam(teamsRemaining[0] || "—");
  }

  function pickPlayer(p) {
    if (pickIndex >= 16) return;

    const pickInRound = pickIndex % 2;
    const drafter = drafterForPick(roundIndex, pickInRound);

    const targetRoster = drafter === 1 ? r1 : r2;
    const idx = nextSlotIndex(targetRoster, normalizePos(p.pos));
    if (idx === -1) return alert("No valid roster slot available for that player.");

    targetRoster[idx].player = p;
    draftedIds.add(p.id);
    pickIndex++;

    // If we just finished the 2nd pick of the round, advance team + round
    if (pickIndex % 2 === 0) {
      roundIndex++;
      if (roundIndex < 8) advanceTeamRound();
    }

    renderRoster(r1El, r1);
    renderRoster(r2El, r2);
    updateHeader();
    renderPlayers(listEl, pool(), pickPlayer);
  }

  function reset() {
    r1 = emptyRoster();
    r2 = emptyRoster();
    draftedIds = new Set();
    pickIndex = 0;
    roundIndex = 0;

    teamsRemaining = shuffle(uniqTeams(players));
    setTeam(teamsRemaining[0] || "—");

    searchEl.value = "";
    renderRoster(r1El, r1);
    renderRoster(r2El, r2);
    updateHeader();
    renderPlayers(listEl, pool(), pickPlayer);
  }

  btnReset.onclick = reset;
  searchEl.oninput = () => renderPlayers(listEl, pool(), pickPlayer);

  setTeam(currentTeam);
  renderRoster(r1El, r1);
  renderRoster(r2El, r2);
  updateHeader();
  renderPlayers(listEl, pool(), pickPlayer);
}

/* =========================
   BOOT
========================= */
(async function boot() {
  try {
    const players = await loadPlayers();
    const mode = getMode();

    // clean slate
    $("#layoutSingle").classList.add("hidden");
    $("#layoutVs").classList.add("hidden");
    $("#teamBanner").classList.add("hidden");
    $("#turnPill").classList.add("hidden");

    if (mode === "vs") initVs(players);
    else initSingle(players);

  } catch (e) {
    console.error(e);
    alert(e.message || String(e));
  }
})();
