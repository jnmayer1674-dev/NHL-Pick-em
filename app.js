/* NHL Pick’em by MayerBros — app.js (root)
   - index.html: just uses its own tiny script for navigation
   - game.html: full game logic below
*/

(function () {
  const isGamePage = /game\.html/i.test(location.pathname) || document.getElementById("playersTbody");
  if (!isGamePage) return;

  // --------------------------
  // Helpers
  // --------------------------
  const $ = (id) => document.getElementById(id);

  function qs(name) {
    const u = new URL(location.href);
    return u.searchParams.get(name);
  }

  function nowISO() {
    return new Date().toISOString();
  }

  function clamp(n, a, b) {
    return Math.max(a, Math.min(b, n));
  }

  function shuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  function safeText(v) {
    return (v ?? "").toString();
  }

  function toNum(v) {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }

  function normalizePos(raw) {
    // returns Set of positions: C, LW, RW, D, G
    const s = safeText(raw).toUpperCase().trim();
    if (!s) return new Set();
    // common separators: / , space
    const parts = s.split(/[\s,\/]+/).map(p => p.trim()).filter(Boolean);
    const out = new Set();
    for (const p of parts) {
      if (p === "C" || p === "LW" || p === "RW" || p === "D" || p === "G") out.add(p);
    }
    return out;
  }

  function playerName(p) {
    return p.name || p.player || p.fullName || p.Player || "Unknown";
  }

  function playerTeam(p) {
    return p.team || p.Team || p.nhlTeam || p.abbr || "";
  }

  function playerPos(p) {
    return p.pos || p.position || p.Pos || p.Position || "";
  }

  function playerPts(p) {
    // support multiple keys
    return (
      p.points ??
      p.fantasyPoints ??
      p.fpts ??
      p.draftPoints ??
      p.pts ??
      p.PTS ??
      0
    );
  }

  function teamLogoSrc(abbr) {
    // repo has assets/logos/*.png
    const t = safeText(abbr).toUpperCase();
    return `assets/logos/${t}.png`;
  }

  // --------------------------
  // Teams (32) — abbreviations used by your logos
  // --------------------------
  const TEAMS = [
    "ANA","BOS","BUF","CAR","CBJ","CGY","CHI","COL","DAL","DET",
    "EDM","FLA","LAK","MIN","MTL","NJD","NSH","NYI","NYR","OTT",
    "PHI","PIT","SEA","SJS","STL","TBL","TOR","UTA","VAN","VGK",
    "WPG","WSH"
  ];

  // --------------------------
  // Game constants
  // --------------------------
  const ROSTER_SLOTS = ["C","LW","RW","D","D","G","FLEX","FLEX"];
  const ROUNDS = 8;
  const TIMER_SECONDS = 30;

  function slotAccepts(slot, posSet) {
    if (slot === "FLEX") {
      return posSet.has("C") || posSet.has("LW") || posSet.has("RW");
    }
    return posSet.has(slot);
  }

  function showFilterAllows(filter, posSet) {
    if (filter === "ALL") return true;
    if (filter === "FLEX") return posSet.has("C") || posSet.has("LW") || posSet.has("RW");
    return posSet.has(filter);
  }

  // --------------------------
  // DOM refs
  // --------------------------
  const mode = (qs("mode") || "").toLowerCase();
  if (mode !== "single" && mode !== "two") {
    // if someone loads game.html directly, send to index
    location.href = "index.html";
    return;
  }

  const statusLine1 = $("statusLine1");
  const statusLine2 = $("statusLine2");
  const teamLogo = $("teamLogo");
  const teamAbbr = $("teamAbbr");
  const timerEl = $("timer");
  const dataStamp = $("dataStamp");
  const playersTbody = $("playersTbody");
  const errorBox = $("errorBox");

  const draftPosSel = $("draftPos");
  const showPosSel = $("showPos");
  const searchInput = $("search");

  const btnChangeMode = $("btnChangeMode");
  const btnNewGame = $("btnNewGame");
  const btnResetHigh = $("btnResetHigh");

  const rostersMeta = $("rostersMeta");
  const rostersContainer = $("rostersContainer");

  // --------------------------
  // State
  // --------------------------
  let allPlayers = [];
  let teamOrder = [];
  let round = 1;

  // Versus pick within round: 0 or 1
  let pickInRound = 0;

  // Current drafter: 0=Player1, 1=Player2 (in single always 0)
  let currentPlayerIndex = 0;

  // Timer
  let secondsLeft = TIMER_SECONDS;
  let timerId = null;

  // Draft slot override when Draft Position = AUTO
  let tempSlotOverride = null; // "C"/"LW"/"RW"/"D"/"G"/"FLEX"
  let draftPosWasAutoAtOverride = false;

  // Keep last valid team to prevent "broken logo" at end
  let lastTeamShown = TEAMS[0];

  // High score storage keys
  const HIGH_SINGLE_KEY = "nhl_pickem_high_single";
  const HIGH_TWO_KEY = "nhl_pickem_high_two";

  function blankRoster() {
    return ROSTER_SLOTS.map((slot) => ({
      slot,
      player: null // {name, team, posSet, pts}
    }));
  }

  const game = {
    mode,
    rosters: mode === "two" ? [blankRoster(), blankRoster()] : [blankRoster()],
    scores: mode === "two" ? [0, 0] : [0],
    draftedIds: new Set(), // string key: name|team|pts
    complete: false
  };

  function playerKey(p) {
    return `${playerName(p)}|${playerTeam(p)}|${toNum(playerPts(p))}`;
  }

  function currentTeam() {
    return teamOrder[round - 1] || lastTeamShown;
  }

  function totalPicks() {
    return mode === "two" ? ROUNDS * 2 : ROUNDS;
  }

  function pickNumber() {
    if (mode === "single") return round;
    return (round - 1) * 2 + (pickInRound + 1);
  }

  function roundOfEightText() {
    return `Round ${round} of ${ROUNDS}`;
  }

  function pickOrderPlayerForVersus(r, pInR) {
    // snake by round:
    // round 1: P1 then P2
    // round 2: P2 then P1
    const odd = (r % 2) === 1;
    if (odd) return pInR === 0 ? 0 : 1;
    return pInR === 0 ? 1 : 0;
  }

  function onTheClockLabel() {
    if (mode === "single") return "Player 1";
    return currentPlayerIndex === 0 ? "Player 1" : "Player 2";
  }

  function getHighScore() {
    const key = mode === "two" ? HIGH_TWO_KEY : HIGH_SINGLE_KEY;
    return toNum(localStorage.getItem(key) || 0);
  }

  function setHighScore(val) {
    const key = mode === "two" ? HIGH_TWO_KEY : HIGH_SINGLE_KEY;
    localStorage.setItem(key, String(val));
  }

  // --------------------------
  // Rendering
  // --------------------------
  function renderHeaderTeam(abbr) {
    const t = safeText(abbr).toUpperCase() || lastTeamShown;
    lastTeamShown = t;

    teamAbbr.textContent = t;
    teamLogo.src = teamLogoSrc(t);
    teamLogo.alt = t;

    // if logo 404s, keep it from showing broken icon by hiding image
    teamLogo.onerror = () => {
      teamLogo.style.visibility = "hidden";
    };
    teamLogo.onload = () => {
      teamLogo.style.visibility = "visible";
    };
  }

  function renderStatus() {
    const t = currentTeam();
    renderHeaderTeam(t);

    const pNum = pickNumber();
    const modeText = (mode === "single") ? "Single" : "Versus";
    statusLine1.textContent = `Mode: ${modeText} • ${roundOfEightText()} • Pick ${pNum} • Team: ${t}`;

    if (game.complete) {
      if (mode === "single") {
        statusLine2.textContent = `Game complete. Final score: ${game.scores[0].toFixed(1)}.`;
      } else {
        const s1 = game.scores[0];
        const s2 = game.scores[1];
        let winner = "Tie";
        let badgeClass = "tie";
        if (s1 > s2) { winner = "Player 1 Wins"; badgeClass = "p1"; }
        else if (s2 > s1) { winner = "Player 2 Wins"; badgeClass = "p2"; }

        statusLine2.innerHTML = `Game complete. Final: P1 ${s1.toFixed(1)} — P2 ${s2.toFixed(1)} <span class="winnerBadge ${badgeClass}">${winner}</span>`;
      }
      return;
    }

    statusLine2.textContent = `On the clock: ${onTheClockLabel()}. Choose Draft Position then click a player.`;
  }

  function renderRosters() {
    const high = getHighScore();
    if (mode === "single") {
      rostersMeta.textContent = `High Score: ${high.toFixed(1)}`;
    } else {
      rostersMeta.textContent = `High Score: ${high.toFixed(1)} (combined)`;
    }

    const container = document.createElement("div");
    container.className = (mode === "two") ? "rostersGridTwo" : "rostersGridSingle";

    const winnerInfo = (mode === "two" && game.complete)
      ? (game.scores[0] === game.scores[1] ? "tie" : (game.scores[0] > game.scores[1] ? "p1" : "p2"))
      : null;

    for (let i = 0; i < game.rosters.length; i++) {
      const panel = document.createElement("div");
      panel.className = "rosterPanel";

      // highlight winner at end
      if (winnerInfo && winnerInfo !== "tie") {
        if ((winnerInfo === "p1" && i === 0) || (winnerInfo === "p2" && i === 1)) panel.classList.add("panelWin");
        else panel.classList.add("panelLose");
      }

      const top = document.createElement("div");
      top.className = "rosterTop";

      const name = document.createElement("div");
      name.className = "rosterName";
      name.textContent = (mode === "two") ? `Player ${i + 1}` : "Player 1";

      const score = document.createElement("div");
      score.className = "rosterScore";
      score.textContent = `Score: ${game.scores[i].toFixed(1)}`;

      top.appendChild(name);
      top.appendChild(score);

      const list = document.createElement("div");
      list.className = "rosterList";

      game.rosters[i].forEach((slotObj, idx) => {
        const row = document.createElement("div");
        row.className = "slotRow clickable";

        // clicking roster slot:
        // - sets Show Position filter to slot (or FLEX behavior)
        // - if Draft Position = AUTO, sets temp override for ONE PICK
        row.addEventListener("click", () => {
          if (game.complete) return;
          if (mode === "two" && i !== currentPlayerIndex) return; // only current player can click their roster
          if (slotObj.player) return; // already filled

          // Visual selected highlight
          tempSlotOverride = slotObj.slot;
          draftPosWasAutoAtOverride = (draftPosSel.value === "AUTO");

          // Temporarily override for this pick only IF draft position is AUTO
          if (draftPosSel.value === "AUTO") {
            // keep dropdown showing AUTO, but we store override in tempSlotOverride
          } else {
            // if user set draft position manually, we still allow "Show Position" filtering by click
            tempSlotOverride = null;
            draftPosWasAutoAtOverride = false;
          }

          // Show Position should filter to clicked slot
          if (slotObj.slot === "FLEX") showPosSel.value = "FLEX";
          else showPosSel.value = slotObj.slot;

          renderAll(); // refresh highlight + table
        });

        // selected highlight if this is the override slot
        if (draftPosSel.value === "AUTO" && tempSlotOverride === slotObj.slot) {
          row.classList.add("selected");
        }

        const pos = document.createElement("div");
        pos.className = "slotPos";
        pos.textContent = slotObj.slot;

        const nm = document.createElement("div");
        nm.className = "slotName";
        nm.textContent = slotObj.player ? slotObj.player.name : "—";

        const tm = document.createElement("div");
        tm.className = "slotTeam";
        tm.textContent = slotObj.player ? slotObj.player.team : "—";

        const st = document.createElement("div");
        st.className = "slotState " + (slotObj.player ? "filled" : "");
        st.textContent = slotObj.player ? "FILLED" : "OPEN";

        row.appendChild(pos);
        row.appendChild(nm);
        row.appendChild(tm);
        row.appendChild(st);

        list.appendChild(row);
      });

      panel.appendChild(top);
      panel.appendChild(list);

      container.appendChild(panel);
    }

    rostersContainer.innerHTML = "";
    rostersContainer.appendChild(container);
  }

  function visiblePlayers() {
    const t = currentTeam();
    const show = showPosSel.value || "ALL";
    const q = (searchInput.value || "").toLowerCase().trim();

    const out = [];

    for (const p of allPlayers) {
      const team = safeText(p.team).toUpperCase();
      if (team !== t) continue;

      const key = p.key;
      if (game.draftedIds.has(key)) continue;

      // position filter
      if (!showFilterAllows(show, p.posSet)) continue;

      // search filter
      if (q) {
        const nm = p.name.toLowerCase();
        if (!nm.includes(q)) continue;
      }

      out.push(p);
    }

    out.sort((a, b) => b.pts - a.pts);
    return out;
  }

  function renderPlayersTable() {
    const list = visiblePlayers();

    playersTbody.innerHTML = "";
    if (!Array.isArray(list) || list.length === 0) {
      const tr = document.createElement("tr");
      const td = document.createElement("td");
      td.className = "td left";
      td.colSpan = 4;
      td.textContent = "No eligible players for this team/filters.";
      tr.appendChild(td);
      playersTbody.appendChild(tr);
      return;
    }

    for (const p of list.slice(0, 300)) {
      const tr = document.createElement("tr");
      tr.className = "trPickable";

      tr.addEventListener("click", () => {
        if (game.complete) return;
        attemptPick(p);
      });

      const tdName = document.createElement("td");
      tdName.className = "td left";
      tdName.textContent = p.name;

      const tdPos = document.createElement("td");
      tdPos.className = "td";
      const span = document.createElement("span");
      span.className = "posTag";
      span.textContent = p.posLabel;
      tdPos.appendChild(span);

      const tdTeam = document.createElement("td");
      tdTeam.className = "td";
      tdTeam.textContent = p.team;

      const tdPts = document.createElement("td");
      tdPts.className = "td right";
      tdPts.innerHTML = `<span class="pillPts">${p.pts.toFixed(1)}</span>`;

      tr.appendChild(tdName);
      tr.appendChild(tdPos);
      tr.appendChild(tdTeam);
      tr.appendChild(tdPts);

      playersTbody.appendChild(tr);
    }
  }

  function renderAll() {
    renderStatus();
    renderRosters();
    renderPlayersTable();
    renderTimer();
  }

  // --------------------------
  // Draft / pick mechanics
  // --------------------------
  function firstOpenSlotIndex(roster) {
    return roster.findIndex(s => !s.player);
  }

  function pickSlotForThisClick() {
    // Priority:
    // 1) If Draft Position dropdown not AUTO -> that value
    // 2) If Draft Position is AUTO and tempSlotOverride set -> override for this pick
    // 3) Else -> first open slot in current player's roster
    if (draftPosSel.value && draftPosSel.value !== "AUTO") {
      return draftPosSel.value;
    }
    if (draftPosSel.value === "AUTO" && tempSlotOverride) {
      return tempSlotOverride;
    }
    const roster = game.rosters[currentPlayerIndex];
    const idx = firstOpenSlotIndex(roster);
    return idx >= 0 ? roster[idx].slot : null;
  }

  function openSlotIndexBySlot(roster, slot) {
    return roster.findIndex(s => !s.player && s.slot === slot);
  }

  function legalForSlot(p, slot) {
    return slotAccepts(slot, p.posSet);
  }

  function attemptPick(p) {
    clearError();

    const roster = game.rosters[currentPlayerIndex];
    const desiredSlot = pickSlotForThisClick();
    if (!desiredSlot) return;

    // Find the first open slot index matching that slot label
    const slotIdx = openSlotIndexBySlot(roster, desiredSlot);
    if (slotIdx < 0) {
      showError(`That roster slot (${desiredSlot}) is already filled.`);
      return;
    }

    if (!legalForSlot(p, desiredSlot)) {
      showError(`Illegal pick: ${p.name} (${p.posLabel}) cannot go into ${desiredSlot}.`);
      return;
    }

    // Commit pick
    roster[slotIdx].player = { name: p.name, team: p.team, pts: p.pts };
    game.scores[currentPlayerIndex] += p.pts;
    game.draftedIds.add(p.key);

    // After each pick:
    // - Show Position resets to All
    // - If Draft Position was AUTO and slot override was used -> reset override and keep dropdown at AUTO
    // - If Draft Position dropdown is AUTO but override existed -> clear it
    // - If Draft Position dropdown is not AUTO -> do NOT change it
    showPosSel.value = "ALL";

    if (draftPosSel.value === "AUTO") {
      // clear override after a successful pick
      tempSlotOverride = null;
      draftPosWasAutoAtOverride = false;
    }

    // Advance turn/round
    advanceAfterPick();

    // Restart timer for next pick (unless game complete)
    resetTimerForNextPick();

    renderAll();
  }

  function advanceAfterPick() {
    if (mode === "single") {
      if (round >= ROUNDS) {
        finishGame();
        return;
      }
      round += 1;
      currentPlayerIndex = 0;
      return;
    }

    // Versus
    if (pickInRound === 0) {
      pickInRound = 1;
      currentPlayerIndex = pickOrderPlayerForVersus(round, pickInRound);
      return;
    }

    // End of round (2 picks done)
    pickInRound = 0;
    if (round >= ROUNDS) {
      finishGame();
      return;
    }
    round += 1;
    currentPlayerIndex = pickOrderPlayerForVersus(round, pickInRound);
  }

  function finishGame() {
    game.complete = true;
    stopTimer();

    // update high score
    const currentHigh = getHighScore();
    let scoreForHigh = 0;

    if (mode === "single") {
      scoreForHigh = game.scores[0];
    } else {
      // combined high score for versus mode
      scoreForHigh = game.scores[0] + game.scores[1];
    }

    if (scoreForHigh > currentHigh) setHighScore(scoreForHigh);

    // Keep last team logo (no broken)
    renderHeaderTeam(lastTeamShown);
  }

  // --------------------------
  // Timer + auto pick
  // --------------------------
  function renderTimer() {
    timerEl.textContent = `${secondsLeft}s`;
  }

  function stopTimer() {
    if (timerId) clearInterval(timerId);
    timerId = null;
  }

  function startTimer() {
    stopTimer();
    secondsLeft = TIMER_SECONDS;
    renderTimer();

    timerId = setInterval(() => {
      if (game.complete) {
        stopTimer();
        return;
      }
      secondsLeft -= 1;
      if (secondsLeft <= 0) {
        secondsLeft = 0;
        renderTimer();
        stopTimer();
        autoPickOnZero();
        return;
      }
      renderTimer();
    }, 1000);
  }

  function resetTimerForNextPick() {
    if (game.complete) return;
    startTimer();
  }

  function autoPickOnZero() {
    if (game.complete) return;

    clearError();

    // First open slot for current player
    const roster = game.rosters[currentPlayerIndex];
    const firstIdx = firstOpenSlotIndex(roster);
    if (firstIdx < 0) {
      // shouldn't happen, but advance
      advanceAfterPick();
      resetTimerForNextPick();
      renderAll();
      return;
    }

    const slot = roster[firstIdx].slot;

    // pick random legal player from current team for that slot
    const t = currentTeam();
    const candidates = allPlayers.filter(p =>
      p.team === t &&
      !game.draftedIds.has(p.key) &&
      legalForSlot(p, slot)
    );

    if (candidates.length === 0) {
      // If no candidates, just advance
      advanceAfterPick();
      resetTimerForNextPick();
      renderAll();
      return;
    }

    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    // force pick into first open slot regardless of dropdown/override
    roster[firstIdx].player = { name: pick.name, team: pick.team, pts: pick.pts };
    game.scores[currentPlayerIndex] += pick.pts;
    game.draftedIds.add(pick.key);

    // Reset UI filters as normal after pick
    showPosSel.value = "ALL";
    if (draftPosSel.value === "AUTO") {
      tempSlotOverride = null;
      draftPosWasAutoAtOverride = false;
    }

    advanceAfterPick();
    resetTimerForNextPick();
    renderAll();
  }

  // --------------------------
  // Errors
  // --------------------------
  function showError(msg) {
    errorBox.textContent = msg;
    errorBox.classList.remove("hidden");
  }
  function clearError() {
    errorBox.textContent = "";
    errorBox.classList.add("hidden");
  }

  // --------------------------
  // Controls
  // --------------------------
  btnChangeMode.addEventListener("click", () => {
    // Reset Show Position to All per your request
    try { showPosSel.value = "ALL"; } catch(e){}
    location.href = "index.html";
  });

  btnNewGame.addEventListener("click", () => {
    newGameSameMode();
  });

  btnResetHigh.addEventListener("click", () => {
    if (!confirm("Reset high score?")) return;
    setHighScore(0);
    renderAll();
  });

  showPosSel.addEventListener("change", () => {
    renderPlayersTable();
  });

  searchInput.addEventListener("input", () => {
    renderPlayersTable();
  });

  draftPosSel.addEventListener("change", () => {
    // If user picks a specific slot, remove temporary override highlight
    if (draftPosSel.value !== "AUTO") {
      tempSlotOverride = null;
      draftPosWasAutoAtOverride = false;
    }
    renderAll();
  });

  // --------------------------
  // New game
  // --------------------------
  function newGameSameMode() {
    // Reset UI filters
    showPosSel.value = "ALL";
    draftPosSel.value = "AUTO";
    searchInput.value = "";
    tempSlotOverride = null;
    draftPosWasAutoAtOverride = false;

    // Reset state
    game.complete = false;
    game.draftedIds = new Set();
    game.scores = mode === "two" ? [0, 0] : [0];
    game.rosters = mode === "two" ? [blankRoster(), blankRoster()] : [blankRoster()];

    teamOrder = shuffle(TEAMS).slice(0, ROUNDS);
    round = 1;
    pickInRound = 0;
    currentPlayerIndex = (mode === "two") ? pickOrderPlayerForVersus(round, pickInRound) : 0;

    // Keep lastTeamShown valid
    lastTeamShown = teamOrder[0] || TEAMS[0];

    clearError();
    renderAll();
    startTimer();
  }

  // --------------------------
  // Load data
  // --------------------------
  async function loadPlayers() {
    clearError();
    dataStamp.textContent = `Data: ${nowISO()}`;

    let json;
    try {
      const res = await fetch("data/players.json", { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load data/players.json (${res.status})`);
      json = await res.json();
    } catch (e) {
      showError(`Could not load players.json. ${e.message}`);
      return [];
    }

    // players.json might be:
    // - an array
    // - { players: [...] }
    // - { data: [...] }
    let arr = null;
    if (Array.isArray(json)) arr = json;
    else if (Array.isArray(json?.players)) arr = json.players;
    else if (Array.isArray(json?.data)) arr = json.data;

    if (!Array.isArray(arr)) {
      showError("players.json loaded, but it was not an array (or {players:[…]}).");
      return [];
    }

    // Normalize
    const cleaned = [];
    for (const raw of arr) {
      const name = safeText(playerName(raw)).trim();
      const team = safeText(playerTeam(raw)).toUpperCase().trim();
      const posRaw = playerPos(raw);
      const pts = toNum(playerPts(raw));

      if (!name || !team) continue;
      if (!TEAMS.includes(team)) continue; // keep consistent with logos/team rotation

      const posSet = normalizePos(posRaw);
      if (posSet.size === 0) continue;

      cleaned.push({
        name,
        team,
        pts,
        posSet,
        posLabel: safeText(posRaw).toUpperCase(),
        key: `${name}|${team}|${pts}`
      });
    }

    return cleaned;
  }

  // --------------------------
  // Init
  // --------------------------
  (async function init() {
    // build rosters container early
    renderHeaderTeam(TEAMS[0]);
    renderStatus();
    renderRosters();

    allPlayers = await loadPlayers();
    if (!Array.isArray(allPlayers) || allPlayers.length === 0) {
      // still render something; error already shown
      playersTbody.innerHTML = `<tr><td class="td left" colspan="4">No players loaded.</td></tr>`;
      return;
    }

    // Start a new game
    newGameSameMode();
  })();
})();
