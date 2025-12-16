/* NHL Pick’em by MayerBros — clean working app.js (Vanilla JS)
   - Loads data/players.json (GitHub Pages safe)
   - Single mode: persistent high score + reset button
   - Two-player mode: NO high score shown
   - Slots: C, LW, RW, D, D, G, FLEX, FLEX (FLEX = C/LW/RW only)
   - Draft-by-team, no repeated teams, 30s timer with auto-pick
*/

(function () {
  // ---------- DOM ----------
  const elStatus = document.getElementById("statusLine");
  const elSubStatus = document.getElementById("subStatusLine");
  const elModeBtn = document.getElementById("btnMode");
  const elNewBtn = document.getElementById("btnNew");

  const elTeamLogo = document.getElementById("teamLogo");
  const elTeamAbbrev = document.getElementById("teamAbbrev");
  const elTimer = document.getElementById("timer");

  const elPosFilter = document.getElementById("posFilter");
  const elSearch = document.getElementById("search");
  const elPlayersTbody = document.getElementById("playersTbody");
  const elErrorBox = document.getElementById("errorBox");
  const elDataStamp = document.getElementById("dataStamp");

  const elRostersWrap = document.getElementById("rostersWrap");
  const elSingleExtras = document.getElementById("singleExtras");
  const elHighScore = document.getElementById("highScore");
  const elResetHS = document.getElementById("btnResetHS");

  // ---------- CONSTANTS ----------
  const STORAGE_KEY_HS = "nhl_pickem_highscore_v1";

  const MODE_SINGLE = "single";
  const MODE_TWO = "two";

  const SLOTS = [
    { key: "C", label: "C", accepts: ["C"] },
    { key: "LW", label: "LW", accepts: ["LW"] },
    { key: "RW", label: "RW", accepts: ["RW"] },
    { key: "D1", label: "D", accepts: ["D"] },
    { key: "D2", label: "D", accepts: ["D"] },
    { key: "G", label: "G", accepts: ["G"] },
    { key: "FLEX1", label: "FLEX", accepts: ["C", "LW", "RW"] },
    { key: "FLEX2", label: "FLEX", accepts: ["C", "LW", "RW"] },
  ];

  // ---------- STATE ----------
  let allPlayers = [];        // normalized
  let availablePlayers = [];  // remaining pool
  let gameMode = MODE_SINGLE;

  let currentPickIndex = 0;   // 0..(SLOTS.length*playersInMode-1)
  let currentTeam = null;     // abbrev string
  let remainingTeams = [];    // unique team abbrevs (shuffled, consumed per pick)
  let selectedSlotKeyByPlayer = {}; // {1:'C', 2:'LW', ...}

  let timerId = null;
  let timeLeft = 30;

  const game = {
    playersCount: 1,
    rosters: {
      1: makeEmptyRoster(),
      2: makeEmptyRoster(),
    },
    scores: { 1: 0, 2: 0 },
    onClock: 1,
    blindDraft: true,
  };

  // ---------- INIT ----------
  elModeBtn.addEventListener("click", () => {
    gameMode = (gameMode === MODE_SINGLE) ? MODE_TWO : MODE_SINGLE;
    startNewGame();
  });

  elNewBtn.addEventListener("click", () => startNewGame());

  elPosFilter.addEventListener("change", renderPlayersTable);
  elSearch.addEventListener("input", renderPlayersTable);

  elResetHS.addEventListener("click", () => {
    localStorage.setItem(STORAGE_KEY_HS, "0");
    updateHighScoreUI();
  });

  loadPlayers()
    .then(() => startNewGame())
    .catch((err) => {
      showError(
        "Failed to load players.json. " +
        "Open DevTools Console for details.\n\n" +
        String(err)
      );
      // still render base UI
      elPlayersTbody.innerHTML = `<tr><td colspan="3" class="muted">
        No players loaded yet. Make sure players.json is in the data folder.
      </td></tr>`;
      renderRosters();
      updateStatus();
    });

  // ---------- DATA LOADING ----------
  async function loadPlayers() {
    hideError();

    // GitHub Pages safe: resolve relative to current page (handles subpath)
    const url = new URL("data/players.json", window.location.href);
    // Cache-bust to avoid stale deploys
    url.searchParams.set("v", String(Date.now()));

    const res = await fetch(url.toString(), { cache: "no-store" });
    if (!res.ok) throw new Error(`HTTP ${res.status} loading ${url.pathname}`);

    const raw = await res.json();

    // Accept either array or {players:[...]}
    const arr = Array.isArray(raw) ? raw : (raw && Array.isArray(raw.players) ? raw.players : null);
    if (!arr) throw new Error("players.json must be an array or an object with a 'players' array.");

    allPlayers = arr.map(normalizePlayer).filter(Boolean);

    if (allPlayers.length === 0) {
      throw new Error("players.json loaded but produced 0 valid players after normalization.");
    }

    const teams = uniqueTeams(allPlayers);
    elDataStamp.textContent = `Data: ${new Date().toISOString()}`;
    console.log("[NHL Pick’em] Loaded players:", allPlayers.length, "Teams:", teams.length);
  }

  function normalizePlayer(p) {
    // Try many possible keys (because your build script may vary)
    const name =
      p.name ?? p.player ?? p.fullName ?? p.Player ?? p.PLAYER ?? p.playerName ?? null;

    const pos =
      (p.pos ?? p.position ?? p.Position ?? p.POS ?? null);

    const team =
      (p.team ?? p.teamAbbrev ?? p.Team ?? p.TEAM ?? p.team_abbrev ?? null);

    const points =
      (p.points ?? p.fantasyPoints ?? p.fp ?? p.FP ?? p.totalPoints ?? p.draftPoints ?? 0);

    if (!name || !pos || !team) return null;

    const cleanPos = String(pos).toUpperCase().trim();
    const cleanTeam = String(team).toUpperCase().trim();

    // We only support these display positions in UI filtering/eligibility
    const allowed = ["C", "LW", "RW", "D", "G"];
    if (!allowed.includes(cleanPos)) return null;

    return {
      id: String(p.id ?? `${name}-${cleanTeam}-${cleanPos}`),
      name: String(name).trim(),
      pos: cleanPos,
      team: cleanTeam,
      points: Number(points) || 0
    };
  }

  // ---------- GAME ----------
  function startNewGame() {
    stopTimer();

    // configure mode
    if (gameMode === MODE_SINGLE) {
      game.playersCount = 1;
      elSingleExtras.classList.remove("hidden");
      updateHighScoreUI();
    } else {
      game.playersCount = 2;
      elSingleExtras.classList.add("hidden");
    }

    // reset state
    game.rosters[1] = makeEmptyRoster();
    game.rosters[2] = makeEmptyRoster();
    game.scores[1] = 0;
    game.scores[2] = 0;

    currentPickIndex = 0;
    selectedSlotKeyByPlayer = { 1: null, 2: null };

    // fresh pool
    availablePlayers = [...allPlayers];

    // build and shuffle teams; consume per pick (no repeats)
    remainingTeams = shuffle(uniqueTeams(availablePlayers));
    currentTeam = null;

    // set first on clock
    game.onClock = 1;

    // kickoff first pick
    advancePick();

    renderRosters();
    renderPlayersTable();
    updateStatus();
  }

  function advancePick() {
    stopTimer();

    // End condition
    const totalPicks = SLOTS.length * game.playersCount;
    if (currentPickIndex >= totalPicks) {
      // finished
      currentTeam = "—";
      elTeamAbbrev.textContent = "—";
      elTeamLogo.src = "";
      elTimer.textContent = "0s";
      updateScoresAndHighScore();
      updateStatus(true);
      return;
    }

    // Determine who is on clock (snake in 2-player)
    game.onClock = pickOwner(currentPickIndex);

    // assign team (no repeats). If we run out, reshuffle remaining teams from available pool.
    if (remainingTeams.length === 0) remainingTeams = shuffle(uniqueTeams(availablePlayers));
    currentTeam = remainingTeams.shift() || "—";

    // default selected slot = first open slot for that player
    selectedSlotKeyByPlayer[game.onClock] = firstOpenSlotKey(game.onClock);

    updateTeamBadge();
    updateStatus();
    renderRosters();
    renderPlayersTable();

    // restart timer
    timeLeft = 30;
    elTimer.textContent = `${timeLeft}s`;
    timerId = setInterval(() => {
      timeLeft -= 1;
      elTimer.textContent = `${Math.max(0, timeLeft)}s`;
      if (timeLeft <= 0) {
        stopTimer();
        autoPickRandomLegal();
      }
    }, 1000);
  }

  function autoPickRandomLegal() {
    // pick random legal player given current slot + team + filters ignored
    const slotKey = selectedSlotKeyByPlayer[game.onClock] || firstOpenSlotKey(game.onClock);
    if (!slotKey) {
      currentPickIndex += 1;
      advancePick();
      return;
    }

    const slot = SLOTS.find(s => s.key === slotKey);
    const legal = availablePlayers.filter(pl =>
      pl.team === currentTeam &&
      slot.accepts.includes(pl.pos)
    );

    if (legal.length === 0) {
      // no legal pick for that slot/team -> just advance
      currentPickIndex += 1;
      advancePick();
      return;
    }

    const chosen = legal[Math.floor(Math.random() * legal.length)];
    applyPick(chosen, game.onClock, slotKey);
  }

  function applyPick(player, owner, slotKey) {
    // remove from pool
    availablePlayers = availablePlayers.filter(p => p.id !== player.id);

    // assign into roster
    game.rosters[owner][slotKey] = player;

    // update score
    game.scores[owner] = calcScore(owner);

    currentPickIndex += 1;

    // next pick
    advancePick();
  }

  // Snake draft ordering for 2-player:
  // picks 0..7: P1, picks 8..15: P2 (because "snake" across slot rounds)
  // If you want true alternating snake per round, swap this logic.
  function pickOwner(pickIndex) {
    if (game.playersCount === 1) return 1;

    // True snake by "round" (slot index):
    // round 0: P1 then P2
    // round 1: P2 then P1
    // round 2: P1 then P2 ...
    const slotIndex = pickIndex % SLOTS.length;       // 0..7
    const withinRoundPick = Math.floor(pickIndex / SLOTS.length); // 0 or 1 for two-player in this structure
    // We actually want 16 total picks: each player fills all 8 slots, but turns alternate by pick.
    // Simpler: alternate each pick, but snake reverses every 8 picks:
    const block = Math.floor(pickIndex / SLOTS.length); // 0 or 1
    if (block % 2 === 0) return (pickIndex % 2 === 0) ? 1 : 2;
    return (pickIndex % 2 === 0) ? 2 : 1;
  }

  // ---------- RENDERING ----------
  function renderPlayersTable() {
    if (!allPlayers.length) {
      elPlayersTbody.innerHTML = `<tr><td colspan="3" class="muted">
        No players loaded yet. Make sure players.json is in the data folder.
      </td></tr>`;
      return;
    }

    const owner = game.onClock;
    const slotKey = selectedSlotKeyByPlayer[owner];
    const slot = slotKey ? SLOTS.find(s => s.key === slotKey) : null;

    const posFilter = elPosFilter.value;
    const q = elSearch.value.trim().toLowerCase();

    let list = availablePlayers;

    // current team only
    if (currentTeam && currentTeam !== "—") {
      list = list.filter(p => p.team === currentTeam);
    }

    // UI Position filter (table)
    if (posFilter !== "ALL") {
      list = list.filter(p => p.pos === posFilter);
    }

    // slot eligibility filter (hard rule)
    if (slot) {
      list = list.filter(p => slot.accepts.includes(p.pos));
    }

    // search filter
    if (q) {
      list = list.filter(p => p.name.toLowerCase().includes(q));
    }

    if (list.length === 0) {
      elPlayersTbody.innerHTML = `<tr><td colspan="3" class="muted">
        No eligible players for this team/slot/search.
      </td></tr>`;
      return;
    }

    // Sort by points (hidden in UI, but stable ordering)
    list = list.slice().sort((a,b) => (b.points - a.points) || a.name.localeCompare(b.name));

    elPlayersTbody.innerHTML = list.map(p => `
      <tr data-id="${escapeHtml(p.id)}">
        <td>${escapeHtml(p.name)}</td>
        <td class="colSmall">${escapeHtml(p.pos)}</td>
        <td class="colSmall">${escapeHtml(p.team)}</td>
      </tr>
    `).join("");

    // click handlers
    [...elPlayersTbody.querySelectorAll("tr[data-id]")].forEach(tr => {
      tr.addEventListener("click", () => {
        const id = tr.getAttribute("data-id");
        const player = availablePlayers.find(x => x.id === id);
        if (!player) return;

        const ownerNow = game.onClock;
        const sk = selectedSlotKeyByPlayer[ownerNow] || firstOpenSlotKey(ownerNow);
        if (!sk) return;

        const s = SLOTS.find(x => x.key === sk);
        if (!s.accepts.includes(player.pos)) return;         // illegal
        if (player.team !== currentTeam) return;             // illegal

        applyPick(player, ownerNow, sk);
      });
    });
  }

  function renderRosters() {
    elRostersWrap.classList.toggle("two", game.playersCount === 2);

    const cards = [];
    for (let i = 1; i <= game.playersCount; i++) {
      cards.push(renderRosterCard(i));
    }
    elRostersWrap.innerHTML = cards.join("");

    // slot click handlers
    for (let i = 1; i <= game.playersCount; i++) {
      SLOTS.forEach(slot => {
        const el = document.getElementById(`slot_${i}_${slot.key}`);
        if (!el) return;
        el.addEventListener("click", () => {
          // Only allow selecting slots for the player on the clock
          if (i !== game.onClock) return;

          // Only allow selecting OPEN slots (keeps it simple/clean)
          const isOpen = !game.rosters[i][slot.key];
          if (!isOpen) return;

          selectedSlotKeyByPlayer[i] = slot.key;
          renderRosters();
          renderPlayersTable();
        });
      });
    }
  }

  function renderRosterCard(owner) {
    const score = game.scores[owner] || 0;

    const slotsHtml = SLOTS.map(slot => {
      const picked = game.rosters[owner][slot.key];
      const open = !picked;

      const active = (owner === game.onClock && selectedSlotKeyByPlayer[owner] === slot.key);

      const cls = [
        "slot",
        open ? "open" : "filled",
        active ? "active" : ""
      ].join(" ");

      const name = picked ? picked.name : "—";
      const team = picked ? picked.team : "—";
      const state = open ? "OPEN" : "FILLED";

      return `
        <div class="${cls}" id="slot_${owner}_${slot.key}">
          <div class="slotTag">${slot.label}</div>
          <div class="slotName">${escapeHtml(name)}</div>
          <div class="slotTeam">${escapeHtml(team)}</div>
          <div class="slotState">${state}</div>
        </div>
      `;
    }).join("");

    return `
      <div class="rosterCard">
        <div class="rosterTop">
          <div class="rosterName">Player ${owner}</div>
          <div class="rosterScore">Score: ${formatScore(score)}</div>
        </div>
        ${slotsHtml}
      </div>
    `;
  }

  function updateStatus(isFinished = false) {
    const round = Math.min(SLOTS.length, (currentPickIndex % SLOTS.length) + 1);

    if (isFinished) {
      elStatus.textContent = `Game complete.`;
      elSubStatus.textContent = (game.playersCount === 1)
        ? `Final Score: ${formatScore(game.scores[1])}`
        : `Final: P1 ${formatScore(game.scores[1])} — P2 ${formatScore(game.scores[2])}`;
      return;
    }

    const modeLabel = (gameMode === MODE_SINGLE) ? "Single" : "2-Player";
    elStatus.textContent = `Mode: ${modeLabel} • Pick ${currentPickIndex + 1} • Team: ${currentTeam}`;
    elSubStatus.textContent = `On the clock: Player ${game.onClock} • Blind draft: player values hidden.`;
  }

  function updateTeamBadge() {
    elTeamAbbrev.textContent = currentTeam || "—";

    // Try to load team logo from your repo folder: /assets/logos/XXX.png
    // (Your screenshots show assets/logos/ANA.png, BOS.png, etc.)
    if (currentTeam && currentTeam !== "—") {
      elTeamLogo.src = `assets/logos/${currentTeam}.png`;
      elTeamLogo.onerror = () => { elTeamLogo.src = ""; };
    } else {
      elTeamLogo.src = "";
    }
  }

  function updateScoresAndHighScore() {
    game.scores[1] = calcScore(1);
    game.scores[2] = calcScore(2);

    if (gameMode === MODE_SINGLE) {
      const hs = getHighScore();
      if (game.scores[1] > hs) setHighScore(game.scores[1]);
      updateHighScoreUI();
    }
  }

  function updateHighScoreUI() {
    const hs = getHighScore();
    elHighScore.textContent = formatScore(hs);
  }

  // ---------- HELPERS ----------
  function makeEmptyRoster() {
    const r = {};
    SLOTS.forEach(s => r[s.key] = null);
    return r;
  }

  function firstOpenSlotKey(owner) {
    for (const s of SLOTS) {
      if (!game.rosters[owner][s.key]) return s.key;
    }
    return null;
  }

  function calcScore(owner) {
    const roster = game.rosters[owner];
    let total = 0;
    for (const s of SLOTS) {
      const p = roster[s.key];
      if (p && typeof p.points === "number") total += p.points;
    }
    return total;
  }

  function uniqueTeams(players) {
    const set = new Set(players.map(p => p.team).filter(Boolean));
    return [...set].sort();
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function showError(msg) {
    elErrorBox.textContent = msg;
    elErrorBox.classList.remove("hidden");
    console.error(msg);
  }

  function hideError() {
    elErrorBox.textContent = "";
    elErrorBox.classList.add("hidden");
  }

  function getHighScore() {
    const v = Number(localStorage.getItem(STORAGE_KEY_HS) || "0");
    return Number.isFinite(v) ? v : 0;
  }

  function setHighScore(val) {
    localStorage.setItem(STORAGE_KEY_HS, String(val || 0));
  }

  function formatScore(n) {
    // keep one decimal like your screenshot (1499.2)
    return (Math.round((Number(n) || 0) * 10) / 10).toFixed(1).replace(/\.0$/, ".0");
  }

  function escapeHtml(str) {
    return String(str)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }
})();
