// NHL Pickem by MayerBros — One-page game.html
// Modes:
//   game.html?mode=single
//   game.html?mode=vs
//
// FIXES INCLUDED:
// - Click any player anytime (no roster-slot preselect)
// - Auto-fills next valid slot
// - FLEX accepts C/LW/RW only
// - VS mode: snake draft
// - Points hidden (blinded)
// - No date/data labels

const SLOTS = ["C","LW","RW","D","D","G","FLEX","FLEX"];
const FLEX_ALLOWED = new Set(["C","LW","RW"]);

const $ = (sel) => document.querySelector(sel);

function getMode() {
  const m = new URLSearchParams(window.location.search).get("mode");
  return (m === "vs" || m === "single") ? m : "single";
}

function normalizePosString(posRaw) {
  if (!posRaw) return new Set();
  const s = String(posRaw).toUpperCase().replace(/\s+/g, "");
  const cleaned = s
    .replace("LEFTWING", "LW")
    .replace("RIGHTWING", "RW")
    .replace("CENTER", "C")
    .replace("DEFENSE", "D")
    .replace("DEFENCEMAN", "D")
    .replace("GOALIE", "G");
  const parts = cleaned.split(/[\/,|]/).filter(Boolean);
  return new Set(parts);
}

function slotAccepts(slot, playerPosSet) {
  if (slot === "FLEX") {
    for (const p of playerPosSet) if (FLEX_ALLOWED.has(p)) return true;
    return false;
  }
  return playerPosSet.has(slot);
}

function nextValidSlotIndex(rosterArr, playerPosSet) {
  // Prefer exact slots first, then FLEX (avoid wasting FLEX early)
  const exactOrder = ["C","LW","RW","D","D","G"];
  const flexOrder = ["FLEX","FLEX"];

  for (let i = 0; i < rosterArr.length; i++) {
    const slot = rosterArr[i].slot;
    if (!rosterArr[i].player && exactOrder.includes(slot) && slotAccepts(slot, playerPosSet)) return i;
  }
  for (let i = 0; i < rosterArr.length; i++) {
    const slot = rosterArr[i].slot;
    if (!rosterArr[i].player && flexOrder.includes(slot) && slotAccepts(slot, playerPosSet)) return i;
  }
  return -1;
}

function buildEmptyRoster() {
  return SLOTS.map((slot) => ({ slot, player: null }));
}
function rosterFilledCount(roster) { return roster.filter(s => !!s.player).length; }
function allRosterFilled(roster) { return rosterFilledCount(roster) === roster.length; }

function renderRoster(container, roster) {
  container.innerHTML = "";
  roster.forEach((s) => {
    const div = document.createElement("div");
    div.className = "slot";
    const name = s.player ? s.player.name : "—";
    const meta = s.player ? `${s.player.team} • ${s.player.pos}` : "";
    div.innerHTML = `
      <div class="slot__pos">${s.slot}</div>
      <div class="slot__name" title="${name}">${name}</div>
      <div class="slot__meta">${meta}</div>
    `;
    container.appendChild(div);
  });
}

function renderPlayersList(container, players, onClick) {
  container.innerHTML = "";
  players.forEach((p) => {
    const row = document.createElement("div");
    row.className = "playerRow";
    row.innerHTML = `
      <div class="playerLeft">
        <div class="playerName" title="${p.name}">${p.name}</div>
        <div class="playerSub" title="${p.team} • ${p.pos}">${p.team} • ${p.pos}</div>
      </div>
      <div class="playerTag">Draft</div>
    `;
    row.addEventListener("click", () => onClick(p));
    container.appendChild(row);
  });
}

function uniqTeams(players) {
  const set = new Set();
  players.forEach(p => { if (p.team) set.add(p.team); });
  return Array.from(set).sort((a,b)=>a.localeCompare(b));
}
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

async function loadPlayers() {
  const res = await fetch("./data/players.json", { cache: "no-store" });
  if (!res.ok) throw new Error("Could not load ./data/players.json");
  const data = await res.json();
  if (!Array.isArray(data)) throw new Error("players.json must be an array");
  return data
    .filter(p => p && (p.name || p.player || p.fullName))
    .map((p, idx) => ({
      id: p.id ?? p.playerId ?? idx,
      name: p.name ?? p.player ?? p.fullName ?? "Unknown",
      team: p.team ?? p.nhlTeam ?? p.club ?? "—",
      pos: (p.pos ?? p.position ?? p.positions ?? "—").toString().toUpperCase()
    }));
}
function removeDrafted(players, draftedIds) {
  const set = new Set(draftedIds);
  return players.filter(p => !set.has(p.id));
}

/* =========================
   SINGLE MODE
========================= */
function initSingle(players) {
  // show single UI
  $("#layoutSingle").classList.remove("hidden");
  $("#teamBanner").classList.remove("hidden");

  $("#modeTitle").textContent = "Single Player";
  $("#modeSubtitle").textContent = "Score Chase • Team-by-team";

  const rosterEl = $("#rosterSingle");
  const listEl = $("#playersListSingle");
  const searchEl = $("#searchSingle");
  const btnReset = $("#btnReset");
  const btnNextTeam = $("#btnNextTeam");
  const teamNameEl = $("#currentTeamName");
  const progressEl = $("#singleProgress");

  const resultsPanel = $("#resultsPanel");
  const resultsBody = $("#resultsBody");

  let roster = buildEmptyRoster();
  let draftedIds = [];
  let teamsRemaining = shuffle(uniqTeams(players));
  let currentTeam = teamsRemaining[0] || "—";

  function setBanner() { teamNameEl.textContent = currentTeam || "—"; }
  function updateProgress() { progressEl.textContent = `${rosterFilledCount(roster)} / ${roster.length}`; }

  function filteredPlayers() {
    const q = (searchEl.value || "").trim().toLowerCase();
    const pool = removeDrafted(players, draftedIds).filter(p => p.team === currentTeam);
    if (!q) return pool;
    return pool.filter(p => p.name.toLowerCase().includes(q));
  }

  function maybeComplete() {
    if (allRosterFilled(roster)) {
      resultsPanel.classList.remove("hidden");
      resultsBody.innerHTML = `<div class="muted">Roster filled. (Points intentionally hidden.)</div>`;
      btnNextTeam.disabled = true;
    }
  }

  function draftPlayer(p) {
    const posSet = normalizePosString(p.pos);
    const slotIdx = nextValidSlotIndex(roster, posSet);
    if (slotIdx === -1) {
      alert(`No valid roster slot available for ${p.name} (${p.pos}).`);
      return;
    }
    roster[slotIdx].player = p;
    draftedIds.push(p.id);

    renderRoster(rosterEl, roster);
    updateProgress();
    renderPlayersList(listEl, filteredPlayers(), draftPlayer);
    maybeComplete();
  }

  function nextTeam() {
    if (!teamsRemaining.length) return;
    teamsRemaining = teamsRemaining.filter(t => t !== currentTeam);
    currentTeam = teamsRemaining[0] || "—";
    setBanner();
    renderPlayersList(listEl, filteredPlayers(), draftPlayer);
  }

  function reset() {
    roster = buildEmptyRoster();
    draftedIds = [];
    teamsRemaining = shuffle(uniqTeams(players));
    currentTeam = teamsRemaining[0] || "—";
    setBanner();
    resultsPanel.classList.add("hidden");
    btnNextTeam.disabled = false;
    searchEl.value = "";
    renderRoster(rosterEl, roster);
    updateProgress();
    renderPlayersList(listEl, filteredPlayers(), draftPlayer);
  }

  btnReset.addEventListener("click", reset);
  btnNextTeam.addEventListener("click", nextTeam);
  searchEl.addEventListener("input", () => renderPlayersList(listEl, filteredPlayers(), draftPlayer));

  setBanner();
  renderRoster(rosterEl, roster);
  updateProgress();
  renderPlayersList(listEl, filteredPlayers(), draftPlayer);
}

/* =========================
   VS MODE (SNAKE)
========================= */
function initVs(players) {
  // show vs UI
  $("#layoutVs").classList.remove("hidden");
  $("#turnPill").style.display = "inline-flex";

  $("#modeTitle").textContent = "2 Player Head-to-Head";
  $("#modeSubtitle").textContent = "Snake Draft • Blinded";

  const roster1El = $("#rosterP1");
  const roster2El = $("#rosterP2");
  const listEl = $("#playersListVs");
  const searchEl = $("#searchVs");
  const btnReset = $("#btnReset");
  const turnPill = $("#turnPill");
  const draftInfo = $("#draftInfo");
  const p1Progress = $("#p1Progress");
  const p2Progress = $("#p2Progress");

  const resultsPanel = $("#resultsPanel");
  const resultsBody = $("#resultsBody");

  let roster1 = buildEmptyRoster();
  let roster2 = buildEmptyRoster();
  let draftedIds = [];
  let pickIndex = 0; // 0..15

  function currentDrafter() {
    const round = Math.floor(pickIndex / 2);
    const forward = round % 2 === 0; // round0: P1->P2, round1: P2->P1...
    const inRoundPick = pickIndex % 2;
    if (forward) return inRoundPick === 0 ? 1 : 2;
    return inRoundPick === 0 ? 2 : 1;
  }

  function updateHeader() {
    const drafter = currentDrafter();
    turnPill.textContent = `Turn: Player ${drafter}`;
    draftInfo.textContent = `Pick ${pickIndex + 1} of 16 • Snake Draft • Click any player to auto-fill`;
    p1Progress.textContent = `${rosterFilledCount(roster1)} / ${roster1.length}`;
    p2Progress.textContent = `${rosterFilledCount(roster2)} / ${roster2.length}`;
  }

  function filteredPlayers() {
    const q = (searchEl.value || "").trim().toLowerCase();
    const pool = removeDrafted(players, draftedIds);
    if (!q) return pool;
    return pool.filter(p => p.name.toLowerCase().includes(q));
  }

  function maybeComplete() {
    if (allRosterFilled(roster1) && allRosterFilled(roster2)) {
      resultsPanel.classList.remove("hidden");
      resultsBody.innerHTML = `<div class="muted">Both rosters filled. (Points intentionally hidden.)</div>`;
    }
  }

  function draftPlayer(p) {
    if (pickIndex >= 16) return;

    const drafter = currentDrafter();
    const targetRoster = drafter === 1 ? roster1 : roster2;

    const posSet = normalizePosString(p.pos);
    const slotIdx = nextValidSlotIndex(targetRoster, posSet);
    if (slotIdx === -1) {
      alert(`Player ${drafter} has no valid roster slot available for ${p.name} (${p.pos}).`);
      return;
    }

    targetRoster[slotIdx].player = p;
    draftedIds.push(p.id);
    pickIndex += 1;

    renderRoster(roster1El, roster1);
    renderRoster(roster2El, roster2);
    updateHeader();
    renderPlayersList(listEl, filteredPlayers(), draftPlayer);
    maybeComplete();
  }

  function reset() {
    roster1 = buildEmptyRoster();
    roster2 = buildEmptyRoster();
    draftedIds = [];
    pickIndex = 0;
    resultsPanel.classList.add("hidden");
    searchEl.value = "";
    renderRoster(roster1El, roster1);
    renderRoster(roster2El, roster2);
    updateHeader();
    renderPlayersList(listEl, filteredPlayers(), draftPlayer);
  }

  btnReset.addEventListener("click", reset);
  searchEl.addEventListener("input", () => renderPlayersList(listEl, filteredPlayers(), draftPlayer));

  renderRoster(roster1El, roster1);
  renderRoster(roster2El, roster2);
  updateHeader();
  renderPlayersList(listEl, filteredPlayers(), draftPlayer);
}

/* =========================
   BOOT
========================= */
(async function boot(){
  try {
    const mode = getMode();

    const players = await loadPlayers();

    // hide both layouts, then show one
    $("#layoutSingle").classList.add("hidden");
    $("#layoutVs").classList.add("hidden");
    $("#teamBanner").classList.add("hidden");
    $("#turnPill").style.display = "none";

    if (mode === "single") initSingle(players);
    else initVs(players);

  } catch (err) {
    console.error(err);
    alert(String(err.message || err));
  }
})();
