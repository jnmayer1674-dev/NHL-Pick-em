(function () {
  const mode = document.body.dataset.mode; // "single" | "vs"
  if (!mode) return;

  const TEAM_CODES = [
    "ANA","BOS","BUF","CAR","CBJ","CGY","CHI","COL","DAL","DET","EDM","FLA",
    "LA","MIN","MTL","NJ","NSH","NYI","NYR","OTT","PHI","PIT","SEA","SJ",
    "STL","TB","TOR","UTA","VAN","VGK","WPG","WSH"
  ];

  const SLOT_ORDER = ["C","LW","RW","D","D","G","FLEX","FLEX"];
  const FLEX_ALLOWED = new Set(["C","LW","RW"]);
  const HIGH_SCORE_KEY = "nhl_pickem_highscore_v6";
  const CLOCK_SECONDS = 30;

  const els = {
    heroLogo: document.getElementById("heroLogo"),
    roundPickLine: document.getElementById("roundPickLine"),
    playersList: document.getElementById("playersList"),
    searchInput: document.getElementById("searchInput"),
    clearFilterBtn: document.getElementById("clearFilterBtn"),
    filterLabel: document.getElementById("filterLabel"),
    dataStatus: document.getElementById("dataStatus"),
    endModal: document.getElementById("endModal"),
    endSummary: document.getElementById("endSummary"),
    playAgainBtn: document.getElementById("playAgainBtn"),
    timerText: document.getElementById("timerText"),
    onClock: document.getElementById("onClock"),
    winnerTitle: document.getElementById("winnerTitle"),
  };

  const single = mode === "single" ? {
    rosterList: document.getElementById("rosterList"),
    filledCount: document.getElementById("filledCount"),
    filledCount2: document.getElementById("filledCount2"),
    currentScore: document.getElementById("currentScore"),
    highScore: document.getElementById("highScore"),
    newGameBtn: document.getElementById("newGameBtn"),
    resetHighScoreBtn: document.getElementById("resetHighScoreBtn"),
  } : null;

  const vs = mode === "vs" ? {
    p1Roster: document.getElementById("p1Roster"),
    p2Roster: document.getElementById("p2Roster"),
    p1Filled: document.getElementById("p1Filled"),
    p2Filled: document.getElementById("p2Filled"),
    p1Total: document.getElementById("p1Total"),
    p2Total: document.getElementById("p2Total"),
    resetVsBtn: document.getElementById("resetVsBtn"),
  } : null;

  let allPlayers = [];
  let draftedIds = new Set();

  let activeSlotFilter = null;  // view filter
  let activeSlotTarget = null;  // target slot for draft placement
  let searchText = "";

  let currentTeam = null;
  let teamBag = [];

  // Single state
  let sRoster = Array(8).fill(null);
  let sPickIndex = 0;
  let sScore = 0;
  let highScore = 0;

  // VS state
  let vRoster1 = Array(8).fill(null);
  let vRoster2 = Array(8).fill(null);
  let vPickIndex = 0;

  // Clock
  let clockInterval = null;
  let secondsLeft = CLOCK_SECONDS;

  function logoPath(teamCode) { return `assets/logos/${teamCode}.png`; }
  function safeText(v) { return (v ?? "").toString(); }

  function normalizePos(p) {
    if (Array.isArray(p)) return p.map(x => safeText(x).trim().toUpperCase()).filter(Boolean);
    const s = safeText(p).toUpperCase().trim();
    if (!s) return [];
    if (s.includes("/")) return s.split("/").map(x => x.trim()).filter(Boolean);
    if (s.includes(",")) return s.split(",").map(x => x.trim()).filter(Boolean);
    return [s];
  }

  function playerTeam(p) { return safeText(p.team || p.teamAbbrev || p.nhlTeam || p.Team).toUpperCase().trim(); }
  function playerName(p) { return safeText(p.name || p.fullName || p.player || p.Player || "Unknown"); }
  function playerPoints(p) {
    const v = p.draftPoints ?? p.fantasyPoints ?? p.points ?? p.Points ?? 0;
    const num = Number(v);
    return Number.isFinite(num) ? num : 0;
  }
  function playerPosList(p) { return normalizePos(p.pos ?? p.position ?? p.Position ?? p.positions); }
  function playerId(p) {
    return safeText(p.id || p.playerId || p.ID || p.key || (playerName(p) + "|" + playerTeam(p))).trim();
  }

  function loadHighScore() {
    const raw = localStorage.getItem(HIGH_SCORE_KEY);
    const val = raw ? Number(raw) : 0;
    return Number.isFinite(val) ? val : 0;
  }
  function saveHighScore(val) { localStorage.setItem(HIGH_SCORE_KEY, String(val)); }

  function makeTeamBag() {
    const arr = [...TEAM_CODES];
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function hardHideModal() {
    if (els.endModal) els.endModal.classList.add("hidden");
  }

  function setTeam(team) {
    currentTeam = team;
    if (els.heroLogo) {
      els.heroLogo.src = logoPath(team);
      els.heroLogo.onerror = () => { els.heroLogo.src = ""; };
    }
  }

  function updateFilterLabel() {
    if (!els.filterLabel) return;
    if (!activeSlotFilter) els.filterLabel.textContent = "All positions";
    else if (activeSlotFilter === "FLEX") els.filterLabel.textContent = "Filter: FLEX (C/LW/RW)";
    else els.filterLabel.textContent = `Filter: ${activeSlotFilter}`;
  }

  function resetFiltersAfterPick() {
    activeSlotFilter = null;
    activeSlotTarget = null;
    searchText = "";
    if (els.searchInput) els.searchInput.value = "";
    updateFilterLabel();
    if (els.playersList) els.playersList.scrollTop = 0;
  }

  function isEligibleForSlot(player, slot) {
    const pos = new Set(playerPosList(player));
    if (slot === "FLEX") {
      for (const p of pos) if (FLEX_ALLOWED.has(p)) return true;
      return false;
    }
    return pos.has(slot);
  }

  function firstOpenMatchingIndex(roster, player) {
    for (let i = 0; i < SLOT_ORDER.length; i++) {
      if (roster[i]) continue;
      if (isEligibleForSlot(player, SLOT_ORDER[i])) return i;
    }
    return -1;
  }

  function firstOpenIndexForSlot(roster, slot) {
    for (let i = 0; i < SLOT_ORDER.length; i++) {
      if (SLOT_ORDER[i] === slot && !roster[i]) return i;
    }
    return -1;
  }

  function playerCanFillAnyOpenSlot(player, roster) {
    return firstOpenMatchingIndex(roster, player) !== -1;
  }

  function availablePlayersForCurrentTeam() {
    return allPlayers.filter(p => playerTeam(p) === currentTeam && !draftedIds.has(playerId(p)));
  }

  // VS snake logic inside 2-pick rounds:
  // Round 1: P1 then P2
  // Round 2: P2 then P1
  // Team rerolls AFTER both picks in the round
  function currentPickerRoster() {
    if (mode === "single") return sRoster;

    const pickNo = vPickIndex + 1;            // 1..16
    const round = Math.ceil(pickNo / 2);      // 1..8
    const firstInRound = (pickNo % 2 === 1);  // pick 1 of round?

    const p1Turn = (round % 2 === 1) ? firstInRound : !firstInRound;
    return p1Turn ? vRoster1 : vRoster2;
  }

  function onClockLabel() {
    if (mode !== "vs") return "";
    return currentPickerRoster() === vRoster1 ? "Player 1" : "Player 2";
  }

  function shouldRerollTeamAfterPick() {
    if (mode === "single") return true;
    // after pick 2,4,6... (end of each 2-pick round)
    return (vPickIndex % 2 === 0);
  }

  function rerollTeamForRoster(roster) {
    // Only reroll if roster still has open slots
    if (roster.every(Boolean)) return;

    let attempts = 0;
    while (attempts < 500) {
      if (teamBag.length === 0) teamBag = makeTeamBag();
      const team = teamBag.shift();

      const pool = allPlayers.filter(p => playerTeam(p) === team && !draftedIds.has(playerId(p)));
      const ok = pool.some(pl => playerCanFillAnyOpenSlot(pl, roster));
      if (ok) { setTeam(team); return; }

      attempts++;
    }

    setTeam(TEAM_CODES[Math.floor(Math.random() * TEAM_CODES.length)]);
  }

  function canDraftPlayerNow(player, roster) {
    if (activeSlotTarget) {
      const idx = firstOpenIndexForSlot(roster, activeSlotTarget);
      if (idx === -1) return false;
      return isEligibleForSlot(player, activeSlotTarget);
    }
    return playerCanFillAnyOpenSlot(player, roster);
  }

  function renderPlayers() {
    const roster = currentPickerRoster();

    let pool = availablePlayersForCurrentTeam()
      .filter(p => playerCanFillAnyOpenSlot(p, roster));

    if (activeSlotFilter) pool = pool.filter(p => isEligibleForSlot(p, activeSlotFilter));

    const q = searchText.trim().toLowerCase();
    if (q) {
      pool = pool.filter(p => {
        const n = playerName(p).toLowerCase();
        const m = playerPosList(p).join("/").toLowerCase();
        return n.includes(q) || m.includes(q);
      });
    }

    pool.sort((a,b) => playerName(a).localeCompare(playerName(b)));

    els.playersList.innerHTML = "";

    for (const p of pool) {
      const row = document.createElement("div");
      row.className = "player-row";

      const logo = document.createElement("img");
      logo.className = "player-logo";
      logo.src = logoPath(currentTeam);
      logo.alt = `${currentTeam} logo`;

      const info = document.createElement("div");

      const nm = document.createElement("div");
      nm.className = "player-name";
      nm.textContent = playerName(p);

      const meta = document.createElement("div");
      meta.className = "player-meta";
      meta.textContent = playerPosList(p).join("/") || "—";

      info.appendChild(nm);
      info.appendChild(meta);

      const btn = document.createElement("button");
      btn.className = "draft-btn";
      btn.textContent = "Draft";
      btn.disabled = !canDraftPlayerNow(p, roster);
      btn.addEventListener("click", () => draftPlayer(p, { isAuto:false }));

      row.appendChild(logo);
      row.appendChild(info);
      row.appendChild(btn);

      els.playersList.appendChild(row);
    }
  }

  function sumRoster(roster) {
    return roster.filter(Boolean).reduce((a,p)=>a+playerPoints(p),0);
  }

  function updateHeaderLines() {
    if (mode === "single") {
      els.roundPickLine.textContent =
        `Round ${sPickIndex + 1} of 8 • Pick ${sPickIndex + 1} of 8 • Team ${currentTeam || "—"}`;

      const filled = sRoster.filter(Boolean).length;
      single.filledCount.textContent = String(filled);
      if (single.filledCount2) single.filledCount2.textContent = String(filled);

      single.currentScore.textContent = String(Math.round(sScore));
      single.highScore.textContent = String(Math.round(highScore));
    } else {
      const pickNo = vPickIndex + 1;
      const round = Math.ceil(pickNo / 2);

      els.roundPickLine.textContent =
        `Round ${round} of 8 • Pick ${pickNo} of 16 • Team ${currentTeam || "—"}`;

      if (els.onClock) els.onClock.textContent = onClockLabel();

      vs.p1Filled.textContent = String(vRoster1.filter(Boolean).length);
      vs.p2Filled.textContent = String(vRoster2.filter(Boolean).length);

      if (vs.p1Total) vs.p1Total.textContent = String(Math.round(sumRoster(vRoster1)));
      if (vs.p2Total) vs.p2Total.textContent = String(Math.round(sumRoster(vRoster2)));
    }
  }

  function renderRoster(container, roster) {
    container.innerHTML = "";
    SLOT_ORDER.forEach((slot, i) => {
      const picked = roster[i];

      const row = document.createElement("div");
      row.className = "slot";

      const btn = document.createElement("button");
      btn.className = "slot-btn" + (activeSlotTarget === slot ? " active" : "");
      btn.textContent = slot;
      btn.type = "button";

      btn.addEventListener("click", () => {
        const next = (activeSlotTarget === slot) ? null : slot;
        activeSlotTarget = next;
        activeSlotFilter = next;
        updateFilterLabel();
        renderAll();
      });

      const name = document.createElement("div");
      name.className = "slot-name" + (!picked ? " muted" : "");
      name.textContent = picked ? playerName(picked) : "—";

      row.appendChild(btn);
      row.appendChild(name);
      container.appendChild(row);
    });
  }

  function isDraftOver() {
    if (mode === "single") return sPickIndex >= 8;
    return vPickIndex >= 16;
  }

  function formatTimer(sec) {
    const s = Math.max(0, sec);
    const mm = Math.floor(s / 60);
    const ss = s % 60;
    return `${mm}:${String(ss).padStart(2, "0")}`;
  }

  function setTimerUI() {
    if (els.timerText) els.timerText.textContent = formatTimer(secondsLeft);
  }

  function stopClock() {
    if (clockInterval) {
      clearInterval(clockInterval);
      clockInterval = null;
    }
  }

  function startClockForPick() {
    stopClock();
    secondsLeft = CLOCK_SECONDS;
    setTimerUI();
    if (isDraftOver()) return;
    if (els.endModal && !els.endModal.classList.contains("hidden")) return;

    clockInterval = setInterval(() => {
      secondsLeft--;
      setTimerUI();
      if (secondsLeft <= 0) {
        stopClock();
        autoDraftOnTimeout();
      }
    }, 1000);
  }

  function autoDraftOnTimeout() {
    if (isDraftOver()) return;

    // reset filters before auto
    activeSlotTarget = null;
    activeSlotFilter = null;
    searchText = "";
    if (els.searchInput) els.searchInput.value = "";
    updateFilterLabel();

    const roster = currentPickerRoster();
    const pool = availablePlayersForCurrentTeam();

    let chosen = null;

    // pick best eligible for next open slot in roster order
    for (let i = 0; i < SLOT_ORDER.length; i++) {
      if (roster[i]) continue;
      const slot = SLOT_ORDER[i];
      const eligible = pool.filter(p => isEligibleForSlot(p, slot));
      if (!eligible.length) continue;
      eligible.sort((a,b) => playerPoints(b) - playerPoints(a));
      chosen = eligible[0];
      break;
    }

    // fallback
    if (!chosen) {
      const any = pool.filter(p => playerCanFillAnyOpenSlot(p, roster));
      any.sort((a,b) => playerPoints(b) - playerPoints(a));
      chosen = any[0] || null;
    }

    if (chosen) draftPlayer(chosen, { isAuto:true });
  }

  function draftPlayer(player, { isAuto }) {
    const roster = currentPickerRoster();
    const id = playerId(player);
    if (draftedIds.has(id)) return;

    let placeIndex = -1;

    if (activeSlotTarget && !isAuto) {
      const idx = firstOpenIndexForSlot(roster, activeSlotTarget);
      if (idx === -1) return;
      if (!isEligibleForSlot(player, activeSlotTarget)) return;
      placeIndex = idx;
    } else {
      const idx = firstOpenMatchingIndex(roster, player);
      if (idx === -1) return;
      placeIndex = idx;
    }

    roster[placeIndex] = player;
    draftedIds.add(id);

    if (mode === "single") {
      sScore += playerPoints(player);
      sPickIndex++;

      if (sScore > highScore) {
        highScore = Math.round(sScore);
        saveHighScore(highScore);
      }

      resetFiltersAfterPick();
      if (sPickIndex < 8) rerollTeamForRoster(sRoster);
    } else {
      vPickIndex++;

      resetFiltersAfterPick();
      if (vPickIndex < 16 && shouldRerollTeamAfterPick()) {
        // reroll based on whoever is about to pick next
        rerollTeamForRoster(currentPickerRoster());
      }
    }

    renderAll();

    // end conditions
    if (mode === "single" && sPickIndex >= 8) {
      if (els.endSummary) els.endSummary.textContent =
        `Final Score: ${Math.round(sScore)} • High Score: ${Math.round(highScore)}`;
      if (els.endModal) els.endModal.classList.remove("hidden");
      stopClock();
      return;
    }

    if (mode === "vs" && vPickIndex >= 16) {
      const p1 = Math.round(sumRoster(vRoster1));
      const p2 = Math.round(sumRoster(vRoster2));

      if (els.winnerTitle) {
        els.winnerTitle.textContent = (p1 > p2) ? "PLAYER 1 WINS" : (p2 > p1) ? "PLAYER 2 WINS" : "TIE";
      }
      if (els.endSummary) els.endSummary.textContent =
        `Final Score — Player 1: ${p1} • Player 2: ${p2}`;

      if (els.endModal) els.endModal.classList.remove("hidden");
      stopClock();
      return;
    }

    startClockForPick();
  }

  function renderAll() {
    updateHeaderLines();

    if (mode === "single") {
      renderRoster(single.rosterList, sRoster);
      renderPlayers();
    } else {
      renderRoster(vs.p1Roster, vRoster1);
      renderRoster(vs.p2Roster, vRoster2);
      renderPlayers();
    }
  }

  async function loadPlayers() {
    const res = await fetch("data/players.json", { cache:"no-store" });
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.players || []);
    allPlayers = list;
    if (els.dataStatus) els.dataStatus.textContent = ""; // hide loaded text
  }

  function resetSingle(keepHigh=true) {
    stopClock();
    draftedIds = new Set();
    teamBag = makeTeamBag();
    sRoster = Array(8).fill(null);
    sPickIndex = 0;
    sScore = 0;

    highScore = keepHigh ? loadHighScore() : 0;
    if (!keepHigh) saveHighScore(0);

    resetFiltersAfterPick();
    hardHideModal();
    rerollTeamForRoster(sRoster);
    renderAll();
    startClockForPick();
  }

  function resetVs() {
    stopClock();
    draftedIds = new Set();
    teamBag = makeTeamBag();
    vRoster1 = Array(8).fill(null);
    vRoster2 = Array(8).fill(null);
    vPickIndex = 0;

    resetFiltersAfterPick();
    hardHideModal();
    rerollTeamForRoster(currentPickerRoster());
    renderAll();
    startClockForPick();
  }

  function wire() {
    els.searchInput?.addEventListener("input", (e)=>{
      searchText = e.target.value || "";
      renderAll();
    });

    els.clearFilterBtn?.addEventListener("click", ()=>{
      activeSlotFilter = null;
      activeSlotTarget = null;
      updateFilterLabel();
      renderAll();
    });

    els.playAgainBtn?.addEventListener("click", ()=>{
      if (mode === "single") resetSingle(true);
      else resetVs();
    });

    if (mode === "single") {
      single.newGameBtn?.addEventListener("click", ()=> resetSingle(true));
      single.resetHighScoreBtn?.addEventListener("click", ()=>{
        highScore = 0;
        saveHighScore(0);
        renderAll();
      });
    } else {
      vs.resetVsBtn?.addEventListener("click", ()=> resetVs());
    }

    document.addEventListener("visibilitychange", () => {
      if (document.hidden) stopClock();
      else if (!isDraftOver() && els.endModal?.classList.contains("hidden")) startClockForPick();
    });
  }

  (async function init(){
    wire();
    updateFilterLabel();
    hardHideModal();
    await loadPlayers();

    teamBag = makeTeamBag();

    if (mode === "single") {
      highScore = loadHighScore();
      rerollTeamForRoster(sRoster);
      renderAll();
      startClockForPick();
    } else {
      rerollTeamForRoster(currentPickerRoster());
      renderAll();
      startClockForPick();
    }
  })();
})();
