const http = require("http");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");

const app = express();
const BASE = (process.env.BASE_PATH || "").replace(/\/$/, "");
if (BASE) app.use((req, res, next) => { if (req.path === BASE) return res.redirect(301, BASE + "/"); next(); });
app.use(BASE || "/", express.static(path.join(__dirname, "public")));
const server = http.createServer(app);
const io = new Server(server, { path: BASE + "/socket.io", cors: { origin: true } });

const PORT = process.env.PORT || 3000;
const MIN_PLAYERS = 3;
const MAX_PLAYERS = 12;
const ROUNDS = Number(process.env.ROUNDS || 3);
const WRITE_MS = Number(process.env.WRITE_MS || 75000);
const VOTE_MS = Number(process.env.VOTE_MS || 45000);
const REVEAL_MS = Number(process.env.REVEAL_MS || 12000);
const AFK_MS = Math.max(200, Number(process.env.AFK_MS || 5000));   // T1: the phase ends this soon once everyone still to act is disconnected
const TIMEOUTS_TO_BOT = 3;                                              // consecutive missed phases before the seat is skipped automatically

const PROMPTS = [
"The worst thing to say at a wedding is ___",
"The real reason the meeting ran long: ___",
"A terrible name for a pet snake: ___",
"The secret ingredient in grandma's biryani is ___",
"The worst superpower to have: ___",
"A rejected flavor of chips: ___",
"The last thing you want to hear from your barber: ___",
"If my phone autocorrected my life, it would change my job to ___",
"The worst thing to whisper during a movie: ___",
"A bad slogan for a hospital: ___",
"What the office wifi password should really be: ___",
"The most useless app idea: ___",
"The worst thing to find in your pocket: ___",
"A terrible excuse for being 3 hours late: ___",
"The real reason dinosaurs went extinct: ___",
"The worst thing to say in a job interview: ___",
"A bad name for a cricket team: ___",
"The most suspicious thing to google at 3am: ___",
"What aliens would say after visiting Earth: ___",
"The worst pizza topping ever invented: ___",
"A terrible theme for a birthday party: ___",
"The last words of a phone battery: ___",
"The worst thing to shout in a library: ___",
"A rejected title for a Bollywood movie: ___",
"The real reason the traffic was bad: ___",
"The worst gift to give your boss: ___",
"What your pet actually thinks about you: ___",
"A bad opening line for a speech: ___",
"The worst thing to put on a resume: ___",
"The secret hobby of every uncle: ___",
"A terrible name for a perfume: ___",
"The worst advice to give a new driver: ___",
"What the fridge says when you open it at midnight: ___",
"A rejected rule for the office: ___",
"The worst thing to say to a cop: ___",
"The real reason the neighbors are so quiet: ___",
"A bad tagline for a gym: ___",
"The worst thing to text your landlord: ___",
"What babies would say if they could talk: ___",
"A terrible password that someone definitely uses: ___",
"The worst thing to bring to a potluck: ___",
"The real reason school starts so early: ___",
"A bad name for a barbershop: ___",
"The worst thing to say right before a flight takes off: ___",
"What your GPS is thinking but won't say: ___",
"A rejected feature for the next iPhone: ___",
"The worst thing to say at a funeral: ___",
"The secret to a long marriage is ___",
"A terrible mascot for a bank: ___",
"The worst thing to hear from your dentist: ___",
"What the moon really thinks about the sun: ___",
"A bad name for a fast food chain: ___",
"The worst way to propose: ___",
"The real reason the printer never works: ___",
"A terrible bedtime story title: ___",
"The worst thing to autocorrect 'ok' into: ___",
"What the last slice of pizza is thinking: ___",
"A rejected Olympic sport: ___",
"The worst thing to say to your in-laws on day one: ___",
"The real contents of area 51: ___",
];

const rooms = new Map();
const roomSockets = new Map();
const timers = new Map();

const newId = () => crypto.randomBytes(8).toString("hex");
const newCode = () => {
  const A = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let c = "";
  for (let i = 0; i < 6; i++) c += A[crypto.randomInt(A.length)];
  return rooms.has(c) ? newCode() : c;
};
const clean = (s, n) => String(s || "").replace(/[<>]/g, "").trim().slice(0, n);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function clearT(code) { const t = timers.get(code); if (t) { clearTimeout(t); timers.delete(code); } }
function deleteRoom(code) { clearT(code); rooms.delete(code); roomSockets.delete(code); }
function activeSeats(room) { return room.players.map((p, i) => (!p.left ? i : -1)).filter((i) => i >= 0); }

function setupGame(room) {
  room.deck = shuffle(PROMPTS.slice()).slice(0, ROUNDS);
  room.round = 0;
  room.scores = room.players.map(() => 0);
  room.status = "playing";
  beginWrite(room);
}
function beginWrite(room) {
  room.round++;
  room.prompt = room.deck[room.round - 1];
  room.subs = {};       // seat -> text
  room.order = null;    // shuffled entry ids for voting
  room.votes = {};      // seat -> entryId
  room.phase = "write";
  room.log = `Round ${room.round} of ${ROUNDS}. Fill in the blank — funniest answer wins.`;
  armTimer(room, WRITE_MS);
}
function beginVote(room) {
  const entries = Object.entries(room.subs).map(([seat, text]) => ({ id: "e" + seat, seat: Number(seat), text }));
  if (entries.length < 2) { // not enough material to vote on
    room.log = "Not enough answers came in — skipping the vote.";
    return beginReveal(room, true);
  }
  room.order = shuffle(entries);
  room.votes = {};
  room.phase = "vote";
  room.log = "Vote for the funniest — you can't pick your own.";
  armTimer(room, VOTE_MS);
}
function beginReveal(room, skipped) {
  // tally
  room.tally = {};
  for (const [, eid] of Object.entries(room.votes || {})) room.tally[eid] = (room.tally[eid] || 0) + 1;
  if (room.order) for (const e of room.order) {
    const v = room.tally[e.id] || 0;
    room.scores[e.seat] += v * 100;
  }
  room.phase = "reveal";
  room.log = skipped ? "On to the next one." : "The authors, revealed:";
  armTimer(room, REVEAL_MS);
}
function nextOrEnd(room) {
  if (room.round >= ROUNDS) {
    room.status = "over";
    room.phase = "over";
    let best = -1, win = null;
    room.players.forEach((p, i) => { if (!p.left && room.scores[i] > best) { best = room.scores[i]; win = i; } });
    room.winner = win;
    room.log = win != null ? `${room.players[win].name} takes the crown with ${best} points! 🏆` : "Game over.";
    clearT(room.code);
    room.phaseEndsAt = null;
  } else beginWrite(room);
}
/* T1 AFK policy. No bot heuristic here: a skipped seat is simply not waited for.
   "Pending" = active players who still owe the phase's action and are not marked away. */
function pendingActors(room) {
  const act = activeSeats(room).filter((s) => !room.players[s].botControlled);
  if (room.phase === "write") return act.filter((s) => room.subs[s] === undefined).map((s) => room.players[s]);
  if (room.phase === "vote") return act.filter((s) => room.votes[s] === undefined).map((s) => room.players[s]);
  return [];
}
function refreshAfkClock(room) {
  if (room.status !== "playing" || !["write", "vote"].includes(room.phase)) return;
  const pend = pendingActors(room);
  if (!pend.length) { if (maybeAdvance(room)) return; }
  if (!pend.length || pend.some((p) => p.connected)) return;
  const soon = Date.now() + AFK_MS;
  if (room.phaseEndsAt && room.phaseEndsAt <= soon) return;
  room.phaseEndsAt = soon;
  clearT(room.code);
  timers.set(room.code, setTimeout(() => onPhaseTimeout(room.code), AFK_MS));
}
function armTimer(room, ms) {
  clearT(room.code);
  room.phaseEndsAt = Date.now() + ms;
  timers.set(room.code, setTimeout(() => onPhaseTimeout(room.code), ms));
  refreshAfkClock(room);
}
function onPhaseTimeout(code) {
  const r = rooms.get(code);
  if (!r || r.status !== "playing") return;
  const notes = [];
  for (const p of pendingActors(r)) {
    p.timeouts = (p.timeouts || 0) + 1;
    if (p.timeouts >= TIMEOUTS_TO_BOT && !p.botControlled) { p.botControlled = true; notes.push(`${p.name} is away (missed ${TIMEOUTS_TO_BOT} in a row) — the room no longer waits for them.`); }
  }
  if (r.phase === "write") beginVote(r);
  else if (r.phase === "vote") beginReveal(r, false);
  else if (r.phase === "reveal") nextOrEnd(r);
  if (notes.length) r.log = `${notes.join(" ")} ${r.log || ""}`.trim();
  bump(r);
}
/* The human acts (or reconnects): stop skipping them and reset the streak. */
function humanIsBack(room, p, reason) {
  const wasBot = !!p.botControlled;
  p.timeouts = 0;
  if (!wasBot) return false;
  p.botControlled = false;
  room.log = `${p.name} is back${reason ? " (" + reason + ")" : ""}.`;
  return true;
}
function maybeAdvance(room) {
  const act = activeSeats(room).filter((s) => !room.players[s].botControlled);   // away seats are not waited for
  if (room.phase === "write" && act.every((s) => room.subs[s] !== undefined)) { beginVote(room); return true; }
  if (room.phase === "vote") {
    // everyone active must vote (including non-submitters)
    if (act.every((s) => room.votes[s] !== undefined)) { beginReveal(room, false); return true; }
  }
  return false;
}

/* ---------- per-player filtered state: answers stay anonymous ---------- */
function stateFor(room, seat) {
  const over = room.status === "over";
  const revealPhase = room.phase === "reveal" || over;
  return {
    code: room.code, status: room.status, phase: room.phase,
    round: room.round || 0, rounds: ROUNDS,
    prompt: room.prompt || null, log: room.log, winner: room.winner != null ? room.winner : null,
    phaseEndsAt: room.phaseEndsAt || null,
    hostSeat: room.players.findIndex((p) => p.id === room.host),
    minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS,
    players: room.players.map((p, s) => ({
      name: p.name, avatar: p.avatar, left: p.left, connected: p.connected, botControlled: !!p.botControlled,
      score: room.scores ? room.scores[s] : 0,
      submitted: room.phase === "write" ? room.subs && room.subs[s] !== undefined : undefined,
      voted: room.phase === "vote" ? room.votes && room.votes[s] !== undefined : undefined,
    })),
    yourSub: room.subs && seat >= 0 ? room.subs[seat] ?? null : null,
    yourVote: room.votes && seat >= 0 ? room.votes[seat] ?? null : null,
    entries: room.order ? room.order.map((e) => ({
      id: e.id,
      text: e.text,
      mine: e.seat === seat,
      votes: revealPhase ? (room.tally ? room.tally[e.id] || 0 : 0) : undefined,
      by: revealPhase ? e.seat : undefined,
    })) : null,
    voice: room.voice ? Array.from(room.voice) : [],
    chat: (room.chat || []).slice(-60),
  };
}
function bump(room) { room.v = (room.v || 0) + 1; room.touched = Date.now(); sendState(room.code); }

/* ---------- GameNest push (optional; no-op without PUSH_URL) ----------
   The app registers a device token per socket and reports presence; players who are away or disconnected
   get a push when it becomes their turn / a new phase starts, and when someone writes in chat. */
const PUSH_URL = process.env.PUSH_URL || "";
const PUSH_TITLE = 'Punchlines';
function pushTo(p, body, data, collapse) {
  if (!PUSH_URL || !p || !p.pushToken || p.bot || p.left) return;
  if (!(p.away || !p.connected)) return;
  const now = Date.now(); if (p._lastPush && now - p._lastPush < 4000) return; p._lastPush = now;
  fetch(PUSH_URL + "/notify", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: p.pushToken, title: PUSH_TITLE, body, data: data || {}, collapse: collapse || undefined }) }).catch(() => {});
}
function pushTurn(room) {   // called after every state broadcast; only fires when the situation changes
  const key = room.status + "|" + room.phase + "|" + (room.round || room.day || 0);
  if (room._pushKey === key) return; room._pushKey = key;
  if (room.status !== "playing") return;
  const text = room.phase === "write" ? "New prompt — write your answer" : room.phase === "vote" ? "Vote for the funniest answer" : room.phase === "night" ? "Night falls — check whether you have a move" : room.phase === "day" ? "Day breaks — time to argue and vote" : null;
  if (!text) return;
  for (const p of room.players) pushTo(p, text + " · room " + room.code, { code: room.code, game: PUSH_TITLE }, room.code + "-phase");
}

function sendState(code) {
  const room = rooms.get(code);
  const socks = roomSockets.get(code);
  if (!room || !socks) return;
  for (const s of socks) {
    const seat = room.players.findIndex((p) => p.id === s.data.playerId);
    s.emit("state", { room: stateFor(room, seat), mySeat: seat, v: room.v });
    try { pushTurn(room); } catch (_) {}
  }
}

io.on("connection", (socket) => {
  socket.data.playerId = null;
  socket.data.code = null;
  const currentRoom = () => rooms.get(socket.data.code);
  const attach = (code) => { socket.data.code = code; if (!roomSockets.has(code)) roomSockets.set(code, new Set()); roomSockets.get(code).add(socket); };
  const detach = () => { const set = roomSockets.get(socket.data.code); if (set) set.delete(socket); socket.data.code = null; };
  const mySeat = () => { const r = currentRoom(); return r ? r.players.findIndex((p) => p.id === socket.data.playerId) : -1; };

  socket.on("create", ({ name, playerId, avatar } = {}) => {
    name = clean(name, 18); if (!name) return socket.emit("err", "Pick a name first.");
    const code = newCode();
    const room = { code, status: "lobby", host: playerId, players: [], chat: [], log: "", v: 1, touched: Date.now(), voice: new Set(), phase: "lobby" };
    room.players.push({ id: playerId, name, avatar: clean(avatar, 4) || "\u{1F3A4}", left: false, connected: true });
    rooms.set(code, room);
    socket.data.playerId = playerId;
    attach(code);
    socket.emit("joined", { code });
    bump(room);
  });

  socket.on("join", ({ code, name, playerId, avatar } = {}) => {
    code = clean(code, 6).toUpperCase();
    const room = rooms.get(code);
    if (!room) return socket.emit("err", "No room with that code.");
    socket.data.playerId = playerId;
    const existing = room.players.find((p) => p.id === playerId);
    if (existing) { existing.connected = true; existing.left = false; humanIsBack(room, existing, "reconnected"); attach(code); socket.emit("joined", { code }); bump(room); return; }
    if (room.status !== "lobby") return socket.emit("err", "That game already started.");
    if (room.players.length >= MAX_PLAYERS) return socket.emit("err", "Room is full (12).");
    name = clean(name, 18); if (!name) return socket.emit("err", "Pick a name first.");
    room.players.push({ id: playerId, name, avatar: clean(avatar, 4) || "\u{1F3A4}", left: false, connected: true });
    attach(code);
    socket.emit("joined", { code });
    room.log = `${name} joined.`;
    bump(room);
  });

  socket.on("start", () => {
    const room = currentRoom();
    if (!room || room.status !== "lobby" || room.host !== socket.data.playerId) return;
    if (room.players.filter((p) => !p.left).length < MIN_PLAYERS)
      return socket.emit("err", `Punchlines needs at least ${MIN_PLAYERS} humans.`);
    setupGame(room);
    bump(room);
  });

  socket.on("submit", ({ text } = {}) => {
    const room = currentRoom();
    if (!room || room.status !== "playing" || room.phase !== "write") return;
    const seat = mySeat();
    const me = room.players[seat];
    if (!me || me.left) return;
    humanIsBack(room, me, "took the seat back"); me.timeouts = 0;
    text = clean(text, 90);
    if (!text) return socket.emit("err", "Write something first.");
    room.subs[seat] = text;
    if (!maybeAdvance(room)) { room.log = "Answers are coming in…"; refreshAfkClock(room); }
    bump(room);
  });

  socket.on("vote", ({ id } = {}) => {
    const room = currentRoom();
    if (!room || room.status !== "playing" || room.phase !== "vote") return;
    const seat = mySeat();
    const me = room.players[seat];
    if (!me || me.left || !room.order) return;
    humanIsBack(room, me, "took the seat back"); me.timeouts = 0;
    const entry = room.order.find((e) => e.id === id);
    if (!entry) return;
    if (entry.seat === seat) return socket.emit("err", "Nice try — you can't vote for yourself.");
    room.votes[seat] = id;
    if (!maybeAdvance(room)) refreshAfkClock(room);
    bump(room);
  });

  socket.on("next", () => { // host can skip the reveal early
    const room = currentRoom();
    if (!room || room.status !== "playing" || room.phase !== "reveal" || room.host !== socket.data.playerId) return;
    nextOrEnd(room);
    bump(room);
  });
  socket.on("takeSeat", () => {
    const room = currentRoom(); if (!room) return;
    const me = room.players[mySeat()];
    if (me && humanIsBack(room, me, "took the seat back")) bump(room);
  });
  socket.on("pushToken", ({ token } = {}) => { const room = currentRoom(); if (!room) return; const p = room.players.find((q) => q.id === socket.data.playerId); if (p && typeof token === "string" && /^[0-9a-f]{32,200}$/i.test(token)) p.pushToken = token; });
  socket.on("presence", ({ away } = {}) => { const room = currentRoom(); if (!room) return; const p = room.players.find((q) => q.id === socket.data.playerId); if (p) p.away = !!away; });


  socket.on("chat", ({ t } = {}) => {
    const room = currentRoom();
    if (!room) return;
    const seat = mySeat();
    const me = room.players[seat];
    if (!me || me.left) return;
    const now = Date.now();
    if (me._lastChat && now - me._lastChat < 700) return;
    me._lastChat = now;
    t = clean(t, 140); if (!t) return;
    room.chat.push({ n: me.name, a: me.avatar, t }); for (const q of room.players) if (q !== me) pushTo(q, me.name + ": " + t, { code: room.code, game: PUSH_TITLE }, room.code + "-chat");
    if (room.chat.length > 200) room.chat.splice(0, room.chat.length - 200);
    bump(room);
  });

  socket.on("voice", ({ kind, to, data } = {}) => {
    const room = currentRoom();
    if (!room) return;
    const seat = mySeat();
    if (seat < 0) return;
    if (kind === "join" || kind === "leave") {
      if (!room.voice) room.voice = new Set();
      if (kind === "join") room.voice.add(seat); else room.voice.delete(seat);
      bump(room); return;
    }
    if (kind === "signal" && Number.isInteger(to) && data) {
      let size = 0; try { size = JSON.stringify(data).length; } catch (e) { return; }
      if (size > 20000) return;
      const socks = roomSockets.get(room.code);
      if (!socks) return;
      for (const s of socks) {
        const sSeat = room.players.findIndex((p) => p.id === s.data.playerId);
        if (sSeat === to) s.emit("voice", { kind: "signal", from: seat, data });
      }
    }
  });

  socket.on("rematch", () => {
    const room = currentRoom();
    if (!room || room.status !== "over" || room.host !== socket.data.playerId) return;
    room.players = room.players.filter((p) => !p.left);
    if (room.players.length < MIN_PLAYERS) { room.status = "lobby"; room.phase = "lobby"; room.log = "Back to the lobby — need 3+."; bump(room); return; }
    setupGame(room);
    bump(room);
  });

  function handleLeave() {
    const room = currentRoom();
    if (!room) return detach();
    const p = room.players.find((q) => q.id === socket.data.playerId);
    if (!p) return detach();
    if (room.voice) room.voice.delete(room.players.indexOf(p));
    if (room.status === "lobby") {
      room.players = room.players.filter((q) => q.id !== p.id);
      if (room.players.length === 0) { detach(); deleteRoom(room.code); return; }
      if (room.host === p.id) room.host = room.players[0].id;
      room.log = `${p.name} left.`;
    } else {
      p.left = true; p.connected = false;
      if (room.players.every((q) => q.left)) { detach(); deleteRoom(room.code); return; }
      if (room.host === p.id) room.host = (room.players.find((q) => !q.left) || room.players[0]).id;
      room.log = `${p.name} left the game.`;
      if (room.status === "playing") {
        if (activeSeats(room).length < 2) {
          room.status = "over"; room.phase = "over";
          const rem = activeSeats(room)[0];
          room.winner = rem != null ? rem : null;
          room.log = "Everyone left — game over.";
          clearT(room.code);
        } else maybeAdvance(room);
      }
    }
    detach();
    bump(room);
  }
  socket.on("leave", () => handleLeave());
  socket.on("disconnect", () => {
    const room = currentRoom();
    if (!room) return;
    const p = room.players.find((q) => q.id === socket.data.playerId);
    if (p) { p.connected = false; if (room.voice) room.voice.delete(room.players.indexOf(p)); room.v++; }
    detach();
    if (rooms.has(room.code)) { refreshAfkClock(room); sendState(room.code); }
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) if (now - room.touched > 2 * 60 * 60 * 1000) deleteRoom(code);
}, 10 * 60 * 1000);

server.listen(PORT, () => console.log("Punchlines running on port " + PORT));
