/* global io */

// Registrasi PWA service worker (agar bisa "install" dari Android Chrome)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/service-worker.js").catch(() => {});
  });
}

const socket = io();

// UI elements
const nameInput = document.getElementById("nameInput");
const roomInput = document.getElementById("roomInput");
const createBtn = document.getElementById("createBtn");
const joinBtn = document.getElementById("joinBtn");
const leaveBtn = document.getElementById("leaveBtn");
const startBtn = document.getElementById("startBtn");
const hostControls = document.getElementById("hostControls");

const roomBadge = document.getElementById("roomBadge");
const roomCodeText = document.getElementById("roomCodeText");
const statusBox = document.getElementById("statusBox");
const logBox = document.getElementById("logBox");

const questionText = document.getElementById("questionText");
const answerInput = document.getElementById("answerInput");
const submitBtn = document.getElementById("submitBtn");
const answerHint = document.getElementById("answerHint");

const playersList = document.getElementById("playersList");
const mountain = document.getElementById("mountain");
const panorama = document.getElementById("panorama");

let currentRoom = null;
let myId = null;
let latestState = null;

const COLORS = [
  "#5eead4", "#38bdf8", "#fb7185", "#fbbf24",
  "#a78bfa", "#f472b6", "#34d399", "#60a5fa"
];

function nowTime() {
  const d = new Date();
  return d.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function logLine(msg, type = "info") {
  const div = document.createElement("div");
  div.className = "line";
  const time = document.createElement("span");
  time.className = "time";
  time.textContent = `[${nowTime()}]`;
  const text = document.createElement("span");
  text.textContent = ` ${msg}`;
  if (type === "good") text.style.color = "rgba(94,234,212,0.95)";
  if (type === "bad") text.style.color = "rgba(251,113,133,0.95)";
  div.appendChild(time);
  div.appendChild(text);
  logBox.appendChild(div);
  logBox.scrollTop = logBox.scrollHeight;
}

function setStatus(msg) {
  statusBox.textContent = msg;
}

function myName() {
  const v = (nameInput.value || "").trim();
  return v || "Pemain";
}

function setInRoomUI(inRoom) {
  createBtn.hidden = inRoom;
  joinBtn.hidden = inRoom;
  leaveBtn.hidden = !inRoom;
  roomInput.disabled = inRoom;
  nameInput.disabled = inRoom;

  roomBadge.hidden = !inRoom;
  if (!inRoom) {
    hostControls.hidden = true;
    answerInput.disabled = true;
    submitBtn.disabled = true;
    questionText.textContent = "—";
    answerHint.textContent = "Masuk room dan mulai game dulu.";
    panorama.hidden = true;
  }
}

function ensureUpperRoomCode() {
  roomInput.value = (roomInput.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 5);
}
roomInput.addEventListener("input", ensureUpperRoomCode);

createBtn.addEventListener("click", () => {
  socket.emit("create_room", { name: myName() });
});

joinBtn.addEventListener("click", () => {
  ensureUpperRoomCode();
  const code = (roomInput.value || "").trim().toUpperCase();
  if (!code) {
    logLine("Masukkan kode room dulu.", "bad");
    return;
  }
  socket.emit("join_room", { roomCode: code, name: myName() });
});

leaveBtn.addEventListener("click", () => {
  if (!currentRoom) return;
  socket.emit("leave_room", { roomCode: currentRoom });
  currentRoom = null;
  myId = null;
  latestState = null;
  setInRoomUI(false);
  setStatus("Keluar dari room.");
  playersList.innerHTML = "";
  clearMarkers();
});

startBtn.addEventListener("click", () => {
  if (!currentRoom) return;
  socket.emit("start_game", { roomCode: currentRoom });
});

function submitAnswer() {
  if (!currentRoom) return;
  const v = (answerInput.value || "").trim();
  if (!v) return;
  socket.emit("submit_answer", { roomCode: currentRoom, answer: v });
  answerInput.value = "";
  answerInput.focus();
}
submitBtn.addEventListener("click", submitAnswer);
answerInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") submitAnswer();
});

function colorForPlayer(playerId, idx) {
  const seed = String(playerId || "").split("").reduce((a, c) => a + c.charCodeAt(0), 0);
  return COLORS[(seed + idx) % COLORS.length];
}

function renderPlayers(state) {
  playersList.innerHTML = "";
  state.players.forEach((p, idx) => {
    const row = document.createElement("div");
    row.className = "playerRow";

    const left = document.createElement("div");
    left.className = "playerName";

    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = colorForPlayer(p.id, idx);

    const name = document.createElement("div");
    name.textContent = p.name;

    if (p.id === state.hostId) {
      const hostTag = document.createElement("span");
      hostTag.className = "hostTag";
      hostTag.textContent = "HOST";
      name.appendChild(hostTag);
    }

    left.appendChild(dot);
    left.appendChild(name);

    const badge = document.createElement("div");
    badge.className = "levelBadge";
    badge.textContent = `Level ${p.level}/${state.topLevel}`;

    row.appendChild(left);
    row.appendChild(badge);
    playersList.appendChild(row);
  });
}

/* ========= VISUAL GUNUNG + ANIMASI ========= */

// simpan marker supaya transisi naik kelihatan
const markerMap = new Map();

// efek flash & shake
const fxFlash = document.createElement("div");
fxFlash.className = "fxFlash";
mountain.appendChild(fxFlash);

// jalur pendakian & garis level
const pathEl = document.createElement("div");
pathEl.className = "mountainPath";
mountain.appendChild(pathEl);

const stepsEl = document.createElement("div");
stepsEl.className = "mountainSteps";
mountain.appendChild(stepsEl);

function ensureStepLines(topLevel) {
  stepsEl.innerHTML = "";
  for (let i = 1; i < topLevel; i++) {
    const line = document.createElement("div");
    line.className = "stepLine";
    const pct = (i / topLevel) * 100;
    line.style.top = `${100 - pct}%`;
    stepsEl.appendChild(line);
  }
}

function clearMarkers() {
  markerMap.forEach((el) => el.remove());
  markerMap.clear();
}

function renderMarkers(state) {
  const rect = mountain.getBoundingClientRect();
  const paddingTop = 58;
  const paddingBottom = 28;
  const usable = rect.height - paddingTop - paddingBottom;

  ensureStepLines(state.topLevel);

  const seen = new Set();

  state.players.forEach((p, idx) => {
    seen.add(p.id);

    let el = markerMap.get(p.id);
    if (!el) {
      el = document.createElement("div");
      el.className = "marker";

      const dot = document.createElement("span");
      dot.className = "dot";
      dot.style.background = colorForPlayer(p.id, idx);

      const label = document.createElement("span");
      label.className = "markerLabel";
      label.textContent = p.name;

      el.appendChild(dot);
      el.appendChild(label);

      // posisi awal (supaya transisi halus)
      el.style.left = "50%";
      el.style.top = `${rect.height - paddingBottom}px`;

      mountain.appendChild(el);
      markerMap.set(p.id, el);
    } else {
      const label = el.querySelector(".markerLabel");
      if (label) label.textContent = p.name;
    }

    // sebar X agar tidak numpuk
    const xPct = 22 + ((idx % 4) * 18) + (Math.floor(idx / 4) * 7);

    // Y berdasarkan level (inilah “naik gunung”-nya)
    const y = paddingTop + (1 - (p.level / state.topLevel)) * usable;

    el.style.left = `${xPct}%`;
    el.style.top = `${y}px`;
  });

  // hapus marker yang sudah keluar
  markerMap.forEach((el, id) => {
    if (!seen.has(id)) {
      el.remove();
      markerMap.delete(id);
    }
  });
}

function playWinFx(winnerId) {
  mountain.classList.add("shake");
  fxFlash.classList.add("on");
  setTimeout(() => {
    mountain.classList.remove("shake");
    fxFlash.classList.remove("on");
  }, 220);

  const el = markerMap.get(winnerId);
  if (el) {
    el.classList.remove("win");
    void el.offsetWidth; // restart animasi
    el.classList.add("win");
    setTimeout(() => el.classList.remove("win"), 600);
  }
}

function applyState(state) {
  latestState = state;

  roomCodeText.textContent = state.roomCode;
  setInRoomUI(true);
  setStatus(state.started ? "Game berjalan." : "Menunggu host memulai.");

  const isHost = myId && state.hostId === myId;
  hostControls.hidden = !isHost || state.started;

  if (state.questionText && state.started) {
    questionText.textContent = state.questionText;
    answerInput.disabled = false;
    submitBtn.disabled = false;
    answerHint.textContent = "Ketik jawaban lalu Enter/Kirim. Salah tidak ada penalti.";
    panorama.hidden = true;
  } else {
    questionText.textContent = state.questionText || "—";
    answerInput.disabled = true;
    submitBtn.disabled = true;
    answerHint.textContent = "Tunggu host memulai game.";
  }

  renderPlayers(state);
  renderMarkers(state);
}

// Socket events
socket.on("connect", () => {
  setStatus("Terhubung. Buat atau gabung room.");
});

socket.on("room_joined", ({ roomCode, playerId, state }) => {
  currentRoom = roomCode;
  myId = playerId;
  roomBadge.hidden = false;
  logLine(`Masuk ke room ${roomCode}.`, "good");
  applyState(state);
});

socket.on("state_update", (state) => {
  if (!state || !currentRoom) return;
  if (state.roomCode !== currentRoom) return;
  applyState(state);
});

socket.on("system_message", (msg) => logLine(msg, "info"));
socket.on("error_message", (msg) => logLine(msg, "bad"));
socket.on("wrong_answer", () => logLine("Salah. Coba lagi!", "bad"));

socket.on("round_result", ({ winnerId, winnerName, correctAnswer, newLevel }) => {
  logLine(`${winnerName} benar (${correctAnswer}) → naik ke level ${newLevel}.`, "good");
  playWinFx(winnerId);
});

socket.on("game_over", ({ winnerId, winnerName }) => {
  logLine(`GAME OVER! Pemenang: ${winnerName}.`, "good");
  if (myId && winnerId === myId) panorama.hidden = false;
});

// re-render saat resize
window.addEventListener("resize", () => {
  if (latestState) renderMarkers(latestState);
});
