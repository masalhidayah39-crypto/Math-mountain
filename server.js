const path = require("path");
const http = require("http");
const express = require("express");
const { Server } = require("socket.io");

const PORT = process.env.PORT || 3000;
const TOP_LEVEL = 10;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Pastikan manifest terbaca sebagai MIME type yang benar untuk PWA
app.get("/manifest.webmanifest", (req, res) => {
  res.type("application/manifest+json");
  res.sendFile(path.join(__dirname, "public", "manifest.webmanifest"));
});

app.use(express.static(path.join(__dirname, "public")));

/**
 * rooms[roomCode] = {
 *   hostId: string,
 *   players: Map(socketId -> { id, name, level }),
 *   started: boolean,
 *   question: { text, answer } | null,
 *   locked: boolean
 * }
 */
const rooms = Object.create(null);

function makeRoomCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  if (rooms[code]) return makeRoomCode();
  return code;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createQuestion() {
  // Target: hasil 0..99, operasi dasar
  const ops = ["+", "-", "×"];
  const op = ops[randInt(0, ops.length - 1)];

  let a, b, ans;
  if (op === "+") {
    a = randInt(0, 99);
    b = randInt(0, 99 - a);
    ans = a + b;
  } else if (op === "-") {
    a = randInt(0, 99);
    b = randInt(0, a);
    ans = a - b;
  } else {
    // perkalian dibatasi supaya < 100 dan tetap cepat dihitung
    a = randInt(0, 12);
    b = randInt(0, 12);
    ans = a * b;
    while (ans > 99) {
      a = randInt(0, 12);
      b = randInt(0, 12);
      ans = a * b;
    }
  }

  return { text: `${a} ${op} ${b} = ?`, answer: ans };
}

function getPublicState(roomCode) {
  const room = rooms[roomCode];
  if (!room) return null;

  const players = Array.from(room.players.values())
    .map((p) => ({ id: p.id, name: p.name, level: p.level }))
    .sort((p1, p2) => (p2.level - p1.level) || p1.name.localeCompare(p2.name));

  return {
    roomCode,
    hostId: room.hostId,
    started: room.started,
    topLevel: TOP_LEVEL,
    questionText: room.question ? room.question.text : null,
    players
  };
}

function broadcastState(roomCode) {
  io.to(roomCode).emit("state_update", getPublicState(roomCode));
}

function ensureRoom(roomCode) {
  if (!rooms[roomCode]) {
    rooms[roomCode] = {
      hostId: null,
      players: new Map(),
      started: false,
      question: null,
      locked: false
    };
  }
  return rooms[roomCode];
}

io.on("connection", (socket) => {
  socket.on("create_room", ({ name }) => {
    const safeName = (name || "").trim().slice(0, 20) || "Pemain";
    const roomCode = makeRoomCode();
    const room = ensureRoom(roomCode);

    room.hostId = socket.id;
    room.players.set(socket.id, { id: socket.id, name: safeName, level: 0 });

    socket.join(roomCode);
    socket.emit("room_joined", { roomCode, playerId: socket.id, state: getPublicState(roomCode) });
    broadcastState(roomCode);
  });

  socket.on("join_room", ({ roomCode, name }) => {
    const code = (roomCode || "").trim().toUpperCase();
    const room = rooms[code];
    if (!room) {
      socket.emit("error_message", "Room tidak ditemukan.");
      return;
    }
    if (room.players.size >= 8) {
      socket.emit("error_message", "Room penuh (maks 8 pemain).");
      return;
    }
    if (room.started) {
      socket.emit("error_message", "Game sudah dimulai. Buat room baru ya.");
      return;
    }

    const safeName = (name || "").trim().slice(0, 20) || "Pemain";
    room.players.set(socket.id, { id: socket.id, name: safeName, level: 0 });
    socket.join(code);
    socket.emit("room_joined", { roomCode: code, playerId: socket.id, state: getPublicState(code) });
    broadcastState(code);
  });

  socket.on("start_game", ({ roomCode }) => {
    const code = (roomCode || "").trim().toUpperCase();
    const room = rooms[code];
    if (!room) return;
    if (socket.id !== room.hostId) return;

    if (room.players.size < 2) {
      socket.emit("error_message", "Minimal 2 pemain untuk mulai.");
      return;
    }

    room.started = true;
    room.locked = false;
    room.question = createQuestion();
    for (const p of room.players.values()) p.level = 0;

    io.to(code).emit("system_message", "Game dimulai! Jawab yang paling cepat untuk naik.");
    broadcastState(code);
  });

  socket.on("submit_answer", ({ roomCode, answer }) => {
    const code = (roomCode || "").trim().toUpperCase();
    const room = rooms[code];
    if (!room || !room.started || !room.question) return;
    if (room.locked) return;

    const player = room.players.get(socket.id);
    if (!player) return;

    const n = Number.parseInt(String(answer).trim(), 10);
    if (!Number.isFinite(n)) return;

    if (n === room.question.answer) {
      room.locked = true;
      player.level += 1;

      io.to(code).emit("round_result", {
        winnerId: player.id,
        winnerName: player.name,
        correctAnswer: room.question.answer,
        newLevel: player.level
      });
      broadcastState(code);

      if (player.level >= TOP_LEVEL) {
        io.to(code).emit("game_over", { winnerId: player.id, winnerName: player.name });
        room.started = false;
        room.question = null;
        room.locked = false;
        broadcastState(code);
        return;
      }

      setTimeout(() => {
        const stillRoom = rooms[code];
        if (!stillRoom || !stillRoom.started) return;
        stillRoom.question = createQuestion();
        stillRoom.locked = false;
        broadcastState(code);
      }, 1200);
    } else {
      socket.emit("wrong_answer");
    }
  });

  socket.on("leave_room", ({ roomCode }) => {
    const code = (roomCode || "").trim().toUpperCase();
    const room = rooms[code];
    if (!room) return;
    room.players.delete(socket.id);
    socket.leave(code);

    if (room.hostId === socket.id) {
      const nextHost = room.players.keys().next().value || null;
      room.hostId = nextHost;
      if (nextHost) io.to(code).emit("system_message", "Host keluar. Host baru otomatis dipilih.");
    }

    if (room.players.size === 0) delete rooms[code];
    else broadcastState(code);
  });

  socket.on("disconnect", () => {
    for (const [code, room] of Object.entries(rooms)) {
      if (!room.players.has(socket.id)) continue;
      room.players.delete(socket.id);
      if (room.hostId === socket.id) {
        const nextHost = room.players.keys().next().value || null;
        room.hostId = nextHost;
      }
      if (room.players.size === 0) delete rooms[code];
      else broadcastState(code);
      break;
    }
  });
});

server.listen(PORT, () => {
  console.log(`Math Mountain running on http://localhost:${PORT}`);
});
