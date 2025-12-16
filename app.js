// app.js

let players = [];
let selectedSlot = null;
let singlePlayerHighScore = 0;
let gameMode = null; // "single" or "versus"

const modeScreen = document.getElementById("modeScreen");
const gameScreen = document.getElementById("gameScreen");
const startSingleBtn = document.getElementById("startSingle");
const startVersusBtn = document.getElementById("startVersus");
const btnChangeMode = document.getElementById("btnChangeMode");
const btnNewGame = document.getElementById("btnNewGame");
const resetHighScoreBtn = document.getElementById("resetHighScore");

const posFilter = document.getElementById("posFilter");
const searchInput = document.getElementById("searchInput");
const playersBody = document.getElementById("playersBody");
const emptyMsg = document.getElementById("emptyMsg");

// Roster elements
const rostersOne = document.getElementById("rostersOne");
const rostersTwo = document.getElementById("rostersTwo");
const p1Slots = document.getElementById("p1Slots");
const p1Score = document.getElementById("p1Score");
const singleHighScore = document.getElementById("singleHighScore");

const p1Slots2 = document.getElementById("p1Slots2");
const p2Slots = document.getElementById("p2Slots");
const p1Score2 = document.getElementById("p1Score2");
const p2Score = document.getElementById("p2Score");

const statusLine = document.getElementById("statusLine");
const turnLine = document.getElementById("turnLine");

// --- Load Players ---
async function loadPlayers() {
  try {
    const response = await fetch("data/players.json");
    players = await response.json();
    renderPlayers();
  } catch (err) {
    console.error(err);
    emptyMsg.classList.remove("hidden");
  }
}

// --- Render Players ---
function renderPlayers() {
  playersBody.innerHTML = "";
  const filterPos = posFilter.value;
  const searchTerm = searchInput.value.toLowerCase();

  const filtered = players.filter(p => {
    const matchPos = filterPos === "All" || p.pos === filterPos;
    const matchSearch = p.name.toLowerCase().includes(searchTerm);
    return matchPos && matchSearch;
  });

  if (!filtered.length) {
    emptyMsg.classList.remove("hidden");
    return;
  } else {
    emptyMsg.classList.add("hidden");
  }

  filtered.forEach(p => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${p.name}</td>
      <td>${p.pos}</td>
      <td>${p.team}</td>
      <td class="right pts-col">${p.pts}</td>
    `;
    tr.addEventListener("click", () => selectPlayer(p));
    playersBody.appendChild(tr);
  });
}

// --- Roster Setup ---
function createRosterSlots(container) {
  container.innerHTML = "";
  const positions = ["C", "LW", "RW", "D", "D", "G", "FLEX"];
  positions.forEach(pos => {
    const div = document.createElement("div");
    div.classList.add("slot-row");
    div.dataset.pos = pos;
    div.innerHTML = `
      <div class="slot-tag">${pos}</div>
      <div class="slot-name">--</div>
      <div class="slot-team">--</div>
      <div class="slot-status">0</div>
    `;
    div.addEventListener("click", () => {
      selectedSlot = div;
      document.querySelectorAll(".slot-row").forEach(s => s.classList.remove("selected"));
      div.classList.add("selected");
    });
    container.appendChild(div);
  });
}

// --- Select Player for Slot ---
function selectPlayer(player) {
  if (!selectedSlot) {
    alert("Select a roster slot first.");
    return;
  }

  // Check position validity
  const slotPos = selectedSlot.dataset.pos;
  if (slotPos !== "FLEX" && player.pos !== slotPos) {
    alert(`Cannot place ${player.pos} in ${slotPos} slot.`);
    return;
  }

  selectedSlot.querySelector(".slot-name").textContent = player.name;
  selectedSlot.querySelector(".slot-team").textContent = player.team;
  selectedSlot.querySelector(".slot-status").textContent = player.pts;

  selectedSlot.classList.remove("selected");
  selectedSlot = null;

  updateScores();
}

// --- Update Scores ---
function updateScores() {
  if (gameMode === "single") {
    let total = Array.from(p1Slots.children).reduce((sum, slot) => {
      const pts = parseInt(slot.querySelector(".slot-status").textContent) || 0;
      return sum + pts;
    }, 0);
    p1Score.textContent = `Score: ${total}`;
    if (total > singlePlayerHighScore) {
      singlePlayerHighScore = total;
      singleHighScore.textContent = `High Score: ${singlePlayerHighScore}`;
    }
  } else if (gameMode === "versus") {
    const total1 = Array.from(p1Slots2.children).reduce((sum, slot) => sum + (parseInt(slot.querySelector(".slot-status").textContent) || 0), 0);
    const total2 = Array.from(p2Slots.children).reduce((sum, slot) => sum + (parseInt(slot.querySelector(".slot-status").textContent) || 0), 0);
    p1Score2.textContent = `Score: ${total1}`;
    p2Score.textContent = `Score: ${total2}`;
  }
}

// --- New Game ---
function newGame() {
  if (gameMode === "single") {
    createRosterSlots(p1Slots);
    p1Score.textContent = "Score: 0";
  } else {
    createRosterSlots(p1Slots2);
    createRosterSlots(p2Slots);
    p1Score2.textContent = "Score: 0";
    p2Score.textContent = "Score: 0";
  }
  selectedSlot = null;
  renderPlayers();
}

// --- Reset High Score ---
function resetHighScore() {
  singlePlayerHighScore = 0;
  singleHighScore.textContent = `High Score: 0`;
}

// --- Event Listeners ---
startSingleBtn.addEventListener("click", () => {
  gameMode = "single";
  modeScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  rostersOne.classList.remove("hidden");
  rostersTwo.classList.add("hidden");
  newGame();
});

startVersusBtn.addEventListener("click", () => {
  gameMode = "versus";
  modeScreen.classList.add("hidden");
  gameScreen.classList.remove("hidden");
  rostersOne.classList.add("hidden");
  rostersTwo.classList.remove("hidden");
  newGame();
});

btnChangeMode.addEventListener("click", () => {
  gameScreen.classList.add("hidden");
  modeScreen.classList.remove("hidden");
});

btnNewGame.addEventListener("click", newGame);
resetHighScoreBtn.addEventListener("click", resetHighScore);

posFilter.addEventListener("change", renderPlayers);
searchInput.addEventListener("input", renderPlayers);

// --- Initialize ---
loadPlayers();
