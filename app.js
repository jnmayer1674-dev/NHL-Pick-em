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
  const HIGH_SCORE_KEY = "nhl_pickem_highscore_v2";

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
  };

  const single = mode === "single" ? {
    rosterList: document.getElementById("rosterList"),
    filledCount: document.getElementById("filledCount"),
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
    onClock: document.getElementById("onClock"),
    midLine: document.getElementById("midLine"),
    resetVsBtn: document.getElementById("resetVsBtn"),
    winnerTitle: document.getElementById("winnerTitle"),
    vsTeamMini: document.getElementById("vsTeamMini"),
  } : null;

  let allPlayers = [];
  let draftedIds = new Set();

  // Filters / targeting
  let activeSlotFilter = null;  // view filter
  let activeSlotTarget = null;  // WHERE the draft should go if user clicked a slot
  let searchText = "";

  let currentTeam = null;
  let teamBag = [];

  // single
  let sRoster = Array(8).fill(null);
  let sPickIndex = 0;
  let sScore = 0;
  let highScore = 0;

  // vs
  let vRoster1 = Array(8).fill(null);
  let vRoster2 = Array(8).fill(null);
  let vPickIndex = 0;

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

  function setTeam(team) {
    currentTeam = team;
    if (vs?.vsTeamMini) vs.vsTeamMini.textContent = team;
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

  function firstOpenIndexForSlot(roster, slot) {
    for (let i = 0; i < SLOT_ORDER.length; i++) {
      if (SLOT_ORDER[i] === slot && !roster[i]) return i;
    }
    return -1;
  }

  function nextOpenIndex(roster) {
    for (let i = 0; i < SLOT_ORDER.length; i++) if (!roster[i]) return i;
    return -1;
  }

  function availablePlayersForCurrentTeam() {
    return allPlayers.filter(p => playerTeam(p) === currentTeam && !draftedIds.has(playerId(p)));
  }

  // Pick a new randomized team for the NEXT pick (must change every pick)
  function rerollTeamForRoster(roster) {
    // Must have at least one available player that can fit ANY open slot
    const openSlots = SLOT_ORDER.filter((_, i) => !roster[i]);

    // safety: if roster full, no reroll
    if (openSlots.length === 0) return;

    let attempts = 0;
    while (attempts < 300) {
      if (teamBag.length === 0) teamBag = makeTeamBag();
      const team = teamBag.shift();

      const pool = allPlayers.filter(p => playerTeam(p) === team && !draftedIds.has(playerId(p)));
      const ok = pool.some(pl => openSlots.some(slot => isEligibleForSlot(pl, slot)));
      if (ok) {
        setTeam(team);
        return;
      }
      attempts++;
    }

    // last resort
    setTeam(TEAM_CODES[Math.floor(Math.random() * TEAM_CODES.length)]);
  }

  function renderPlayers(rosterForTargeting) {
    const pool = availablePlayersForCurrentTeam()
      .filter(p => {
        const q = searchText.toLowerCase();
        if (q) {
          const n = playerName(p).toLowerCase();
          const m = playerPosList(p).join("/").toLowerCase();
          if (!n.includes(q) && !m.includes(q)) return false;
        }
        if (activeSlotFilter) return isEligibleForSlot(p, activeSlotFilter);
        return true;
      })
      .sort((a,b) => playerName(a).localeCompare(playerName(b)));

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

      // ✅ NOW: Can draft if player fits either:
      // - selected target slot (if chosen), OR
      // - next open slot (if no target)
      btn.disabled = !canDraftPlayerIntoRoster(p, rosterForTargeting);

      btn.addEventListener("click", () => draftPlayer(p));

      row.appendChild(logo);
      row.appendChild(info);
      row.appendChild(btn);
      els.playersList.appendChild(row);
    }
  }

  function canDraftPlayerIntoRoster(player, roster) {
    if (!roster) return false;

    if (activeSlotTarget) {
      const idx = firstOpenIndexForSlot(roster, activeSlotTarget);
      if (idx === -1) return false; // selected slot is full
      return isEligibleForSlot(player, activeSlotTarget);
    }

    const idx = nextOpenIndex(roster);
    if (idx === -1) return false;
    return isEligibleForSlot(player, SLOT_ORDER[idx]);
  }

  function currentPickerRoster() {
    if (mode === "single") return sRoster;

    const pickNo = vPickIndex + 1;
    const round = Math.ceil(pickNo / 2);
    const firstInRound = pickNo % 2 === 1;

    const p1Turn = (round % 2 === 1)
      ? firstInRound
      : !firstInRound;

    return p1Turn ? vRoster1 : vRoster2;
  }

  function updateHeaderLines() {
    if (mode === "single") {
      els.roundPickLine.textContent = `Round ${sPickIndex + 1} of 8 • Pick ${sPickIndex + 1} of 8 • Team ${currentTeam || "—"}`;
      single.filledCount.textContent = String(sRoster.filter(Boolean).length);
      single.currentScore.textContent = String(Math.round(sScore));
      single.highScore.textContent = String(Math.round(highScore));
    } else {
      const pickNo = vPickIndex + 1;
      const round = Math.ceil(pickNo / 2);
      const roster = currentPickerRoster();
      const onClock = roster === vRoster1 ? "Player 1" : "Player 2";
      vs.onClock.textContent = onClock;
      const line = `Round ${round} of 8 • Pick ${pickNo} of 16 • Team ${currentTeam || "—"}`;
      els.roundPickLine.textContent = line;
      vs.midLine.textContent = line;
      vs.p1Filled.textContent = String(vRoster1.filter(Boolean).length);
      vs.p2Filled.textContent = String(vRoster2.filter(Boolean).length);
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

      // ✅ Clicking a slot sets BOTH:
      // - filter view
      // - target slot for drafting
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

  function draftPlayer(player) {
    const roster = currentPickerRoster();
    const id = playerId(player);
    if (draftedIds.has(id)) return;

    let placeIndex = -1;

    if (activeSlotTarget) {
      const idx = firstOpenIndexForSlot(roster, activeSlotTarget);
      if (idx === -1) return; // slot full
      if (!isEligibleForSlot(player, activeSlotTarget)) return;
      placeIndex = idx;
    } else {
      const idx = nextOpenIndex(roster);
      if (idx === -1) return;
      const slot = SLOT_ORDER[idx];
      if (!isEligibleForSlot(player, slot)) return;
      placeIndex = idx;
    }

    roster[placeIndex] = player;
    draftedIds.add(id);

    // scoring
    if (mode === "single") {
      sScore += playerPoints(player);
      sPickIndex++;

      if (sScore > highScore) {
        highScore = Math.round(sScore);
        saveHighScore(highScore);
      }

      // ✅ REROLL TEAM AFTER EVERY PICK
      resetFiltersAfterPick();
      if (sPickIndex < 8) rerollTeamForRoster(sRoster);
    } else {
      vPickIndex++;

      // ✅ REROLL TEAM AFTER EVERY PICK (shared team for both players)
      resetFiltersAfterPick();
      if (vPickIndex < 16) rerollTeamForRoster(currentPickerRoster());
    }

    renderAll();

    // end
    if (mode === "single" && sPickIndex >= 8) {
      els.endSummary.textContent = `Final Score: ${Math.round(sScore)} • High Score: ${Math.round(highScore)}`;
      els.endModal.classList.remove("hidden");
    }

    if (mode === "vs" && vPickIndex >= 16) {
      const sum = (r) => r.filter(Boolean).reduce((a,p)=>a+playerPoints(p),0);
      const p1 = sum(vRoster1), p2 = sum(vRoster2);
      if (p1 > p2) vs.winnerTitle.textContent = "PLAYER 1 WINS";
      else if (p2 > p1) vs.winnerTitle.textContent = "PLAYER 2 WINS";
      else vs.winnerTitle.textContent = "TIE";
      els.endSummary.textContent = "Draft complete.";
      els.endModal.classList.remove("hidden");
    }
  }

  function renderAll() {
    updateHeaderLines();
    if (mode === "single") {
      renderRoster(single.rosterList, sRoster);
      renderPlayers(sRoster);
    } else {
      renderRoster(vs.p1Roster, vRoster1);
      renderRoster(vs.p2Roster, vRoster2);
      renderPlayers(currentPickerRoster());
    }
  }

  async function loadPlayers() {
    const res = await fetch("data/players.json", { cache:"no-store" });
    const data = await res.json();
    const list = Array.isArray(data) ? data : (data.players || []);
    allPlayers = list;
    if (els.dataStatus) els.dataStatus.textContent = `Loaded ${allPlayers.length} players from data/players.json`;
  }

  function resetSingle(keepHigh=true) {
    draftedIds = new Set();
    teamBag = makeTeamBag();
    sRoster = Array(8).fill(null);
    sPickIndex = 0;
    sScore = 0;
    highScore = keepHigh ? loadHighScore() : 0;
    if (!keepHigh) saveHighScore(0);
    resetFiltersAfterPick();
    rerollTeamForRoster(sRoster);
    renderAll();
    els.endModal.classList.add("hidden");
  }

  function resetVs() {
    draftedIds = new Set();
    teamBag = makeTeamBag();
    vRoster1 = Array(8).fill(null);
    vRoster2 = Array(8).fill(null);
    vPickIndex = 0;
    resetFiltersAfterPick();
    rerollTeamForRoster(currentPickerRoster());
    renderAll();
    els.endModal.classList.add("hidden");
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
      single.newGameBtn.addEventListener("click", ()=> resetSingle(true));
      single.resetHighScoreBtn.addEventListener("click", ()=>{
        highScore = 0;
        saveHighScore(0);
        renderAll();
      });
    } else {
      vs.resetVsBtn.addEventListener("click", ()=> resetVs());
    }
  }

  (async function init(){
    wire();
    updateFilterLabel();
    await loadPlayers();
    teamBag = makeTeamBag();

    if (mode === "single") {
      highScore = loadHighScore();
      rerollTeamForRoster(sRoster);
      renderAll();
    } else {
      rerollTeamForRoster(currentPickerRoster());
      renderAll();
    }
  })();
})();
