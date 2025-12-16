// --- High Score Setup ---
let highScore = Number(localStorage.getItem('highScore')) || 0;

const p1ScoreEl = document.getElementById('p1Score');
const highScoreEl = document.getElementById('singleHighScore');
const resetBtn = document.getElementById('resetHighScore');

const gameScreen = document.getElementById('gameScreen');
const modeScreen = document.getElementById('modeScreen');
const rostersOne = document.getElementById('rostersOne');
const rostersTwo = document.getElementById('rostersTwo');

// --- High Score Functions ---
function updateHighScore(score) {
  if (score > highScore) {
    highScore = score;
    localStorage.setItem('highScore', highScore);
  }
  highScoreEl.textContent = `High Score: ${highScore}`;
}

function resetHighScore() {
  highScore = 0;
  localStorage.removeItem('highScore');
  highScoreEl.textContent = `High Score: 0`;
}

resetBtn.addEventListener('click', resetHighScore);

// --- Mode Selection ---
document.getElementById('startSingle').addEventListener('click', () => {
  modeScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  rostersOne.classList.remove('hidden');
  rostersTwo.classList.add('hidden');
  highScoreEl.parentElement.style.display = 'block';
});

document.getElementById('startVersus').addEventListener('click', () => {
  modeScreen.classList.add('hidden');
  gameScreen.classList.remove('hidden');
  rostersOne.classList.add('hidden');
  rostersTwo.classList.remove('hidden');
  highScoreEl.parentElement.style.display = 'none';
});

// --- Example: Update Player 1 Score ---
// Call this function whenever P1 score changes
function updatePlayer1Score(points) {
  p1ScoreEl.innerHTML = `Score: ${points}<br /><span id="singleHighScore" class="high-score">High Score: ${highScore}</span>`;
  updateHighScore(points);
}

// --- New Game Button ---
// Resets player scores but keeps high score
document.getElementById('btnNewGame').addEventListener('click', () => {
  if (!rostersOne.classList.contains('hidden')) {
    p1ScoreEl.innerHTML = `Score: 0<br /><span id="singleHighScore" class="high-score">High Score: ${highScore}</span>`;
  }
  if (!rostersTwo.classList.contains('hidden')) {
    document.getElementById('p1Score2').textContent = 'Score: 0';
    document.getElementById('p2Score').textContent = 'Score: 0';
  }
  // Add logic here to reset rosters and player slots as needed
});
