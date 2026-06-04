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
    left.style.display = "flex";
    left.style.alignItems = "center";
    left.style.gap = "10px";

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

function clearMarkers() {
  const old = mountain.querySelectorAll(".marker");
  old.forEach((el) => el.remove());
}

function renderMarkers(state) {
  clearMarkers();
  const rect = mountain.getBoundingClientRect();
  const paddingTop = 48;
  const paddingBottom = 28;
  const usable = rect.height - paddingTop - paddingBottom;

  state.players.forEach((p, idx) => {
    const marker = document.createElement("div");
    marker.className = "marker";

    const dot = document.createElement("span");
    dot.className = "dot";
    dot.style.background = colorForPlayer(p.id, idx);

    const label = document.createElement("span");
    label.className = "markerLabel";
    label.textContent = p.name;

    marker.appendChild(dot);
    marker.appendChild(label);

    const xPct = 20 + ((idx % 4) * 20) + (Math.floor(idx / 4) * 6);
    const y = paddingTop + (1 - (p.level / state.topLevel)) * usable;

    marker.style.left = `${xPct}%`;
    marker.style.top = `${y}px`;

    mountain.appendChild(marker);
  });
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

socket.on("round_result", ({ winnerName, correctAnswer, newLevel }) => {
  logLine(`${winnerName} benar (${correctAnswer}) → naik ke level ${newLevel}.`, "good");
});

socket.on("game_over", ({ winnerId, winnerName }) => {
  logLine(`GAME OVER! Pemenang: ${winnerName}.`, "good");
  if (myId && winnerId === myId) panorama.hidden = false;
});

window.addEventListener("resize", () => {
  if (latestState) renderMarkers(latestState);
});
