/* NHL Pick’em by MayerBros - app.js (ROOT)
   Fixes:
   - players.json can be ARRAY or { players: ARRAY }
   - Versus: same team for both players per round
   - Show "Round X of 8"
   - Winner highlight at end of Versus
   - Draft Position AUTO: clicking roster slot temporarily overrides for ONE pick, then returns to AUTO
   - Show Position resets to ALL after each pick AND when New Game / Change Mode
*/

document.addEventListener("DOMContentLoaded", () => {
  try {
    boot();
  } catch (e) {
    console.error(e);
    alert("App crashed. Open Console.\n\n" + (e?.stack || e));
  }
});

function boot() {
  // --- DOM helpers
  const $ = (id) => document.getElementById(id);
  const must = (id) => {
    const el = $(id);
    if (!el) throw new Error(`Missing element #${id}`);
    return el;
  };

  // --- DOM nodes (match your existing HTML)
  const elStatus = must("statusLine");
  const elSubStatus = must("subStatusLine");
  const elBtnMode = must("btnMode");
  const elBtnNew = must("btnNew");

  const elTeamLogo = must("teamLogo");
  const elTeamAbbrev = must("teamAbbrev");
  const elTimer = must("timer");

  const elDraftPos = must("draftPos");     // "AUTO" or C/LW/RW/D/G/FLEX
  const elPosFilter = must("posFilter");   // "ALL" or C/LW/RW/D/G
  const elSearch = must("search");
  const elPlayersTbody = must("playersTbody");

  const elErrorBox = must("errorBox");
  const elDataStamp = must("dataStamp");

  const elRostersWrap = must("rostersWrap");
  const elSingleExtras = must("singleExtras");
  const elHighScore = must("highScore");
  const elResetHS = must("btnResetHS");

  const STORAGE_KEY_HS = "nhl_pickem_highscore_v10";

  const MODE_SINGLE = "single";
  const MODE_TWO = "two";

  const LOGO_MAP = { LAK: "LA", NJD: "NJ", TBL: "TB", SJS: "SJ" };

  // Slots: C, LW, RW, D, D, G, FLEX, FLEX (FLEX accepts C/LW/RW only)
  const SLOTS = [
    { key: "C",     label: "C",    accepts: ["C"],           draftPos: "C",    showPos: "C" },
    { key: "LW",    label: "LW",   accepts: ["LW"],          draftPos: "LW",   showPos: "LW" },
    { key: "RW",    label: "RW",   accepts: ["RW"],          draftPos: "RW",   showPos: "RW" },
    { key: "D1",    label: "D",    accepts: ["D"],           draftPos: "D",    showPos: "D" },
    { key: "D2",    label: "D",    accepts: ["D"],           draftPos: "D",    showPos: "D" },
    { key: "G",     label: "G",    accepts: ["G"],           draftPos: "G",    showPos: "G" },
    { key: "FLEX1", label: "FLEX", accepts: ["C","LW","RW"], draftPos: "FLEX", showPos: "ALL" },
    { key: "FLEX2", label: "FLEX", accepts: ["C","LW","RW"], draftPos: "FLEX", showPos: "ALL" },
  ];

  // --- state
  let gameMode = MODE_SINGLE;
  let allPlayers = [];
  let availablePlayers = [];
  let uniqueTeams = [];
  let remainingTeams = [];
  let currentTeam = null;

  let pickIndex = 0; // 0..(slots*players-1)
  let timerId = null;
  let timeLeft = 30;

  // When Draft Position = AUTO and user clicks a roster slot:
  //  - overrideDraftPosOnce stores the forced draftPos to use for THIS pick only
  //  - after the pick, Draft Position returns to AUTO
  let overrideDraftPosOnce = null;

  // When user clicks roster slot we also temporarily set Show Position;
  // after the pick we reset Show Position back to ALL.
  let showPosTempOverride = false;

  const game = {
    playersCount: 1,
    onClock: 1,
    rosters: { 1: {}, 2: {} },
    scores: { 1: 0, 2: 0 },
    winner: 0,
  };

  // --- UI helpers
  function showError(msg) {
    elErrorBox.textContent = msg;
    elErrorBox.classList.remove("hidden");
  }
  function hideError() {
    elErrorBox.textContent = "";
    elErrorBox.classList.add("hidden");
  }

  function fmt(n) {
    const x = Number(n) || 0;
    return x.toFixed(1);
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function shuffle(a) {
    const arr = [...a];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  // --- mode from URL
  const urlMode = (new URLSearchParams(location.search).get("mode") || "single").toLowerCase();
  gameMode = (urlMode === "two" || urlMode === "versus") ? MODE_TWO : MODE_SINGLE;

  // --- wire buttons
  elBtnMode.onclick = () => {
    // Reset filters before leaving
    elDraftPos.value = "AUTO";
    elPosFilter.value = "ALL";
    location.href = "index.html";
  };

  elBtnNew.onclick = () => startGame(gameMode);

  elSearch.addEventListener("input", () => renderPlayers());
  elPosFilter.addEventListener("change", () => {
    showPosTempOverride = false;
    renderPlayers();
  });

  elDraftPos.addEventListener("change", () => {
    // Manual change cancels the one-pick override
    overrideDraftPosOnce = null;
    renderPlayers();
  });

  elResetHS.onclick = () => {
    localStorage.setItem(STORAGE_KEY_HS, "0");
    updateHighScoreUI();
  };

  // --- boot
  loadPlayers()
    .then(() => startGame(gameMode))
    .catch((e) => {
      console.error(e);
      showError(e.message || "Failed to load players.json");
    });

  // =========================
  // DATA LOAD (fixes data.map crash)
  // =========================
  async function loadPlayers() {
    hideError();
    const res = await fetch(`data/players.json?v=${Date.now()}`);
    if (!res.ok) throw new Error(`Could not load data/players.json (${res.status})`);

    const raw = await res.json();

    // ✅ Accept either:
    //   1) Array: [ {name,pos,team,points,...}, ... ]
    //   2) Object: { players: [ ... ] }  (or data:)
    const arr =
      Array.isArray(raw) ? raw :
      Array.isArray(raw.players) ? raw.players :
      Array.isArray(raw.data) ? raw.data :
      null;

    if (!arr) {
      // show small preview to help debugging
      const preview = JSON.stringify(raw).slice(0, 200);
      throw new Error(`players.json format unexpected. Expected an array or {players:[...]}. Got: ${preview}`);
    }

    allPlayers = arr.map((p, idx) => ({
      id: p.id || `${p.name || "P"}-${p.team || "T"}-${p.pos || "X"}-${idx}`,
      name: p.name || "Unknown",
      pos: (p.pos || "").toUpperCase(),
      team: (p.team || "").toUpperCase(),
      points: Number(p.points ?? p.fantasyPoints ?? 0) || 0,
    }));

    uniqueTeams = [...new Set(allPlayers.map((p) => p.team).filter(Boolean))].sort();
    elDataStamp.textContent = raw.generatedAt ? `Data: ${raw.generatedAt}` : `Data loaded`;
  }

  // =========================
  // GAME START / RESET
  // =========================
  function startGame(mode) {
    stopTimer();
    hideError();

    gameMode = mode;
    game.playersCount = (mode === MODE_SINGLE) ? 1 : 2;
    game.winner = 0;

    game.rosters[1] = emptyRoster();
    game.rosters[2] = emptyRoster();
    game.scores[1] = 0;
    game.scores[2] = 0;

    availablePlayers = [...allPlayers];

    remainingTeams = shuffle(uniqueTeams);
    currentTeam = null;

    pickIndex = 0;
    overrideDraftPosOnce = null;
    showPosTempOverride = false;

    // reset dropdowns & search always on new game
    elDraftPos.value = "AUTO";
    elPosFilter.value = "ALL";
    elSearch.value = "";

    if (game.playersCount === 1) {
      elSingleExtras.classList.remove("hidden");
      updateHighScoreUI();
    } else {
      elSingleExtras.classList.add("hidden");
    }

    nextPick();
  }

  function emptyRoster() {
    const r = {};
    SLOTS.forEach((s) => (r[s.key] = null));
    return r;
  }

  // =========================
  // PICK FLOW
  // =========================
  function nextPick() {
    stopTimer();

    const totalPicks = SLOTS.length * game.playersCount;
    if (pickIndex >= totalPicks) {
      finalizeGame();
      return;
    }

    // onClock
    game.onClock = (game.playersCount === 1) ? 1 : ((pickIndex % 2) === 0 ? 1 : 2);

    // ✅ choose team ONCE per round in Versus, once per pick in Single
    // round = floor(pickIndex / playersCount) + 1
    const round = Math.floor(pickIndex / game.playersCount) + 1;

    const isStartOfRound = (game.playersCount === 1) ? true : (pickIndex % game.playersCount === 0);
    if (isStartOfRound) {
      if (!remainingTeams.length) remainingTeams = shuffle(uniqueTeams);
      currentTeam = remainingTeams.shift() || uniqueTeams[Math.floor(Math.random() * uniqueTeams.length)];
    }

    updateTeamBadge();

    elStatus.textContent = `Mode: ${gameMode === "single" ? "Single" : "Versus"} • Round ${round} of 8 • Team: ${currentTeam}`;
    elSubStatus.textContent = `On the clock: Player ${game.onClock}`;

    renderRosters();
    renderPlayers();

    startTimer();
  }

  function startTimer() {
    timeLeft = 30;
    elTimer.textContent = "30s";
    timerId = setInterval(() => {
      timeLeft -= 1;
      elTimer.textContent = `${Math.max(0, timeLeft)}s`;
      if (timeLeft <= 0) {
        stopTimer();
        autoPick();
      }
    }, 1000);
  }

  function autoPick() {
    const owner = game.onClock;

    const openSlot = firstOpenSlotKey(owner);
    if (!openSlot) {
      pickIndex++;
      nextPick();
      return;
    }

    const legal = legalPlayersForSlot(openSlot);
    if (!legal.length) {
      pickIndex++;
      nextPick();
      return;
    }

    const p = legal[Math.floor(Math.random() * legal.length)];
    applyPick(p, openSlot);
  }

  function applyPick(player, slotKey) {
    const owner = game.onClock;

    // place player
    game.rosters[owner][slotKey] = player;
    game.scores[owner] += player.points;

    // remove from pool
    availablePlayers = availablePlayers.filter((p) => p.id !== player.id);

    // ✅ after pick: if we temporarily overrode Draft Position, return to AUTO
    if (overrideDraftPosOnce) {
      overrideDraftPosOnce = null;
      elDraftPos.value = "AUTO";
    }

    // ✅ after pick: reset Show Position back to ALL if it was temporarily forced by roster click
    if (showPosTempOverride) {
      showPosTempOverride = false;
      elPosFilter.value = "ALL";
    }

    // advance
    pickIndex++;
    nextPick();
  }

  function firstOpenSlotKey(owner) {
    for (const s of SLOTS) {
      if (!game.rosters[owner][s.key]) return s.key;
    }
    return null;
  }

  function slotByKey(key) {
    return SLOTS.find((s) => s.key === key) || null;
  }

  function legalPlayersForSlot(slotKey) {
    const slot = slotByKey(slotKey);
    if (!slot) return [];
    return availablePlayers.filter((p) => p.team === currentTeam && slot.accepts.includes(p.pos));
  }

  // Choose which slot should be filled when user clicks a player row:
  // - If Draft Position is AUTO:
  //     - use overrideDraftPosOnce if set (from roster click)
  //     - else fill the first open legal slot
  // - If Draft Position is not AUTO:
  //     - find an open slot that matches that draftPos (e.g., D chooses D1 then D2)
  function decideSlotForPlayer(player) {
    const owner = game.onClock;

    const dp = (elDraftPos.value || "AUTO").toUpperCase();
    const effectiveDp = (dp === "AUTO" && overrideDraftPosOnce) ? overrideDraftPosOnce : dp;

    if (effectiveDp === "AUTO") {
      // first open slot that accepts the player's pos
      for (const s of SLOTS) {
        if (!game.rosters[owner][s.key] && s.accepts.includes(player.pos)) return s.key;
      }
      return null;
    }

    // map "D" or "FLEX" to slot.draftPos
    for (const s of SLOTS) {
      if (game.rosters[owner][s.key]) continue;
      if (s.draftPos === effectiveDp && s.accepts.includes(player.pos)) return s.key;
    }
    return null;
  }

  // =========================
  // RENDER: PLAYERS TABLE
  // =========================
  function renderPlayers() {
    const q = (elSearch.value || "").trim().toLowerCase();

    // show position filter
    const showPos = (elPosFilter.value || "ALL").toUpperCase();

    // determine which positions are allowed by current draft position selection
    const dp = (elDraftPos.value || "AUTO").toUpperCase();
    const effectiveDp = (dp === "AUTO" && overrideDraftPosOnce) ? overrideDraftPosOnce : dp;

    let list = availablePlayers.filter((p) => p.team === currentTeam);

    // apply Show Position
    if (showPos !== "ALL") list = list.filter((p) => p.pos === showPos);

    // apply search
    if (q) list = list.filter((p) => p.name.toLowerCase().includes(q));

    // apply Draft Position constraints (so illegal picks are blocked visually)
    if (effectiveDp !== "AUTO") {
      // legal positions depend on which open slot matches effectiveDp
      const owner = game.onClock;
      const openSlots = SLOTS.filter((s) => !game.rosters[owner][s.key] && s.draftPos === effectiveDp);

      // if no open slot for that draftPos, show none
      if (!openSlots.length) list = [];
      else {
        const accepts = new Set(openSlots.flatMap((s) => s.accepts));
        list = list.filter((p) => accepts.has(p.pos));
      }
    }

    // build table
    if (!list.length) {
      elPlayersTbody.innerHTML = `
        <tr><td colspan="3" class="muted">No eligible players for this team/filters.</td></tr>
      `;
      return;
    }

    elPlayersTbody.innerHTML = list
      .map((p) => {
        return `
          <tr class="playerRow" data-id="${p.id}">
            <td>${escapeHtml(p.name)}</td>
            <td>${escapeHtml(p.pos)}</td>
            <td>${escapeHtml(p.team)}</td>
          </tr>
        `;
      })
      .join("");

    // row click handler
    [...elPlayersTbody.querySelectorAll(".playerRow")].forEach((row) => {
      row.addEventListener("click", () => {
        const id = row.getAttribute("data-id");
        const player = availablePlayers.find((x) => x.id === id);
        if (!player) return;

        const slotKey = decideSlotForPlayer(player);
        if (!slotKey) return;

        stopTimer();
        applyPick(player, slotKey);
      });
    });
  }

  // =========================
  // RENDER: ROSTERS (with click-to-select slot)
  // =========================
  function renderRosters() {
    const count = game.playersCount;

    elRostersWrap.innerHTML = [1, 2]
      .slice(0, count)
      .map((owner) => renderRosterCard(owner))
      .join("");

    // make slots clickable ONLY for the player who is on the clock
    const owner = game.onClock;
    const card = elRostersWrap.querySelector(`.rosterCard[data-owner="${owner}"]`);
    if (card) {
      card.querySelectorAll(".slotRow").forEach((row) => {
        row.addEventListener("click", () => {
          const slotKey = row.getAttribute("data-slot");
          const slot = slotByKey(slotKey);
          if (!slot) return;
          if (game.rosters[owner][slotKey]) return; // already filled

          // When Draft Position is AUTO:
          // - override just for this pick, then back to AUTO after pick
          if ((elDraftPos.value || "AUTO").toUpperCase() === "AUTO") {
            overrideDraftPosOnce = slot.draftPos; // C/LW/RW/D/G/FLEX
          } else {
            // If user manually set Draft Position, clicking slot just sets it to match
            elDraftPos.value = slot.draftPos;
            overrideDraftPosOnce = null;
          }

          // Also set Show Position to match (except FLEX shows ALL)
          elPosFilter.value = slot.showPos;
          showPosTempOverride = true;

          renderPlayers();
        });
      });
    }

    updateScoresAndHighScore();
  }

  function renderRosterCard(owner) {
    const winnerClass =
      (game.playersCount === 2 && game.winner === owner) ? " winner" : "";

    const score = game.scores[owner];

    // header row: include high score only in single
    const highScoreHtml =
      (game.playersCount === 1)
        ? `<div class="hsWrap"><span>High Score: <b id="hsInline">${escapeHtml(elHighScore.textContent || "0")}</b></span></div>`
        : "";

    const rows = SLOTS.map((s) => {
      const p = game.rosters[owner][s.key];
      const status = p ? "FILLED" : "OPEN";
      return `
        <div class="slotRow ${p ? "filled" : "open"}" data-slot="${s.key}">
          <div class="slotPos">${escapeHtml(s.label)}</div>
          <div class="slotName">${p ? escapeHtml(p.name) : "—"}</div>
          <div class="slotTeam">${p ? escapeHtml(p.team) : "—"}</div>
          <div class="slotStatus">${status}</div>
        </div>
      `;
    }).join("");

    return `
      <div class="rosterCard${winnerClass}" data-owner="${owner}">
        <div class="rosterTop">
          <div class="rosterTitle">Player ${owner}</div>
          <div class="rosterScore">Score: ${fmt(score)}</div>
          ${highScoreHtml}
        </div>
        <div class="slotsWrap">${rows}</div>
      </div>
    `;
  }

  // =========================
  // END GAME (winner highlight + message)
  // =========================
  function finalizeGame() {
    stopTimer();

    if (game.playersCount === 2) {
      const p1 = game.scores[1];
      const p2 = game.scores[2];

      if (p1 > p2) game.winner = 1;
      else if (p2 > p1) game.winner = 2;
      else game.winner = 0;

      const winText = (game.winner === 0) ? "Tie Game" : `Player ${game.winner} Wins!`;

      elStatus.textContent = `Game complete • ${winText}`;
      elSubStatus.textContent = `Final: P1 ${fmt(p1)} — P2 ${fmt(p2)}`;
    } else {
      updateHighScoreIfNeeded();
      elStatus.textContent = "Game complete";
      elSubStatus.textContent = `Final Score: ${fmt(game.scores[1])}`;
    }

    // IMPORTANT: keep last team/logo (no clearing) to avoid broken image at end
    renderRosters();
    renderPlayers();
  }

  function updateScoresAndHighScore() {
    if (game.playersCount === 1) {
      updateHighScoreIfNeeded(false);
      updateHighScoreUI();
    }
  }

  function updateHighScoreIfNeeded(allowWrite = true) {
    if (game.playersCount !== 1) return;
    const current = Number(game.scores[1] || 0);
    const hs = Number(localStorage.getItem(STORAGE_KEY_HS) || 0);
    if (allowWrite && current > hs) {
      localStorage.setItem(STORAGE_KEY_HS, String(current.toFixed(1)));
    }
  }

  function updateHighScoreUI() {
    elHighScore.textContent = localStorage.getItem(STORAGE_KEY_HS) || "0";
  }

  // =========================
  // TEAM BADGE
  // =========================
  function updateTeamBadge() {
    elTeamAbbrev.textContent = currentTeam || "—";
    const code = LOGO_MAP[currentTeam] || currentTeam;
    elTeamLogo.src = `assets/logos/${code}.png`;
  }

  // =========================
  // HTML escape
  // =========================
  function escapeHtml(s) {
    return String(s)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
}
