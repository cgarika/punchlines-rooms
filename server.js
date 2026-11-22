const http = require("http");
const path = require("path");
const crypto = require("crypto");
const express = require("express");
const { Server } = require("socket.io");
const Reactions = require("./reactions");   // the cartoon stickers (2026-10-15)
const Voice = require("./voice");   // voice chat in private rooms, EOS (2026-11-18; the file every server shares)
const Played = require("./friendsplayed");   // Friends: "last played with" when a game ends (2026-11-19; the file every server shares)
const Quick = require("./quickmatch");   // Quick Play: 2.5 s to find people, comics fill the empty seats (2026-11-01; the file every server shares)
const Plus = require("./plus");
const Packs = require("./packs");   // GameNest Plus's prompt packs (2026-10-17)   // GameNest Plus: the room's flag and each player's look (2026-10-16)
const Moderation = require("./moderation");   // what players type, kept friendly (2026-10-18)
const Summary = require("./summary");   // the one match summary every result panel reads (2026-11-01)
const Comics = require("./comics");   // the stand-in seats' answers (2026-11-01)

const app = express();
const BASE = (process.env.BASE_PATH || "").replace(/\/$/, "");
if (BASE) app.use((req, res, next) => { if (req.path === BASE) return res.redirect(301, BASE + "/"); next(); });
app.use(BASE || "/", express.static(path.join(__dirname, "public")));
const server = http.createServer(app);
const io = new Server(server, { path: BASE + "/socket.io", cors: { origin: true } });
/* Every client event goes through one guard, as in the other rooms. A payload that is not an object (null, a
   number, a string, an array) arrives as {}: 42["join",null] used to throw inside the handler's destructuring and
   stop the whole process, every room with it. A handler that still throws is logged and the server carries on. */
function guarded(socket) {
  return (event, fn) => socket.on(event, (payload, ...rest) => {
    try { fn(payload && typeof payload === "object" && !Array.isArray(payload) ? payload : {}, ...rest); }
    catch (e) { console.error(`[${new Date().toISOString()}] ${event} failed:`, (e && e.stack) || e); }
  });
}

const PORT = process.env.PORT || 3000;
const MIN_PLAYERS = 2;   // seats at the table to Start (comics count); a table of two is topped up with a comic, so every matchup has a voter
const FLOOR_SEATS = 3;   // fewest seats a game is dealt to
const FILL_SEATS = 4;    // "Fill with comics" seats comics up to this many
const MAX_PLAYERS = 12;
const ROUNDS = Number(process.env.ROUNDS || 3);
/* Pacing (2026-11-01): about 45 s to write and 25 s to vote for 4 players, a little more for each player more and a little less for
   each fewer (the clamps are 36-70 s and 20-40 s). WRITE_MS / VOTE_MS in the environment fix them for every table (the tests do). Once
   all but one of the people have locked in, the last one has HURRY_MS; when everyone is in, the phase moves on at once. */
const WRITE_FIXED = process.env.WRITE_MS !== undefined ? Number(process.env.WRITE_MS) : null;
const VOTE_FIXED = process.env.VOTE_MS !== undefined ? Number(process.env.VOTE_MS) : null;
const half = (ms) => Math.round(ms / 500) * 500;
const writeMsFor = (n) => (WRITE_FIXED != null ? WRITE_FIXED : half(Math.min(70000, Math.max(36000, 45000 + (n - 4) * 3000))));
const voteMsFor = (n) => (VOTE_FIXED != null ? VOTE_FIXED : half(Math.min(40000, Math.max(20000, 25000 + (n - 4) * 1500))));
/* The reveal runs as long as the app's reveal moment does (the roses thrown one a vote, the needle, the boards turning, the authors named, then
   a beat): about 6 s with no vote, a third of a second more for each, 9.5 s at most. It was a flat 12 s, of which half was a wait. REVEAL_MS fixes it. */
const REVEAL_FIXED = process.env.REVEAL_MS !== undefined ? Number(process.env.REVEAL_MS) : null;
const revealMsFor = (votes) => (REVEAL_FIXED != null ? REVEAL_FIXED : half(Math.min(9500, 6000 + 350 * votes)));
const HURRY_MS = Math.max(50, Number(process.env.HURRY_MS || 10000));
const AFK_MS = Math.max(200, Number(process.env.AFK_MS || 5000));   // T1: the phase ends this soon once everyone still to act is disconnected
const AFK_GRACE_MS = Math.max(0, Number(process.env.AFK_GRACE_MS ?? 20000));   // a player who only just lost their link (app in the background, a call, a lift) is waited for this long before the fast AFK clock runs
/* What this server understands beyond the original protocol; a client shows a feature only when it is listed.
   bots: addBot / removeBot / fillBots in the lobby (the comics). summary: the match summary in the final state. people (2026-11-04): each player's `person`
   (m1-m4, f1-f4: who stands behind their podium) and the lobby's `person` event. */
const FEATURES = ["bots", "summary", "refusalCodes", "hold", "people"];
/* The hold (party r2, 2026-11-02): somebody reading the rules (the app's How to play, opened in the middle of a round) holds the round's clocks.
   HOLD_MAX_MS is the longest one hold lasts (a forgotten sheet never stalls a room); a seat may start HOLDS_PER_GAME of them in a game. */
const HOLD_MAX_MS = Math.max(50, Number(process.env.HOLD_MAX_MS || 90000));
const HOLDS_PER_GAME = 6;
const TIMEOUTS_TO_BOT = 3;                                              // consecutive missed phases before the seat is stood in for automatically
/* The stand-ins (2026-11-01): a seat that is a comic (a bot), away (3 missed phases) or dropped (its link down past the grace)
   answers from the comics' bank at a random SUBMIT_MS after the writing starts, and casts a random vote (never for itself: a
   voter is never in the matchup) a random VOTE_AFTER_MS after the matchup opens. The ranges are for the reference phases
   (a 45 s write, a 25 s vote); a shorter clock (a test's) scales them down, so they always land inside the phase. */
const SUBMIT_MS = [Number(process.env.COMIC_SUBMIT_MIN_MS || 8000), Number(process.env.COMIC_SUBMIT_MAX_MS || 20000)];
const VOTE_AFTER_MS = [Number(process.env.COMIC_VOTE_MIN_MS || 3000), Number(process.env.COMIC_VOTE_MAX_MS || 8000)];
const WRITE_REF_MS = 45000, VOTE_REF_MS = 25000;
const rndBetween = (lo, hi) => Math.round(lo) + crypto.randomInt(Math.max(1, Math.round(hi) - Math.round(lo) + 1));
/* One JSON line to the log for the things worth measuring afterwards (GN_EVENT_LOG=0 silences it). */
const evlog = (ev, data) => { if (process.env.GN_EVENT_LOG !== "0") console.log(JSON.stringify({ ev, game: "punchlines", t: Date.now(), ...data })); };

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
app.get("/internal/roster/:code", Plus.rosterHandler((code) => rooms.get(code)));   // who is at a table, for the wallet's Treat the room (404 without GN_INTERNAL_SECRET)
/* GameNest Plus: a player says on create and join that they own Plus; a room
   whose host owns it is a Plus room, and every client shows its extras.
   The client's word is taken for now (checking Apple's receipt is a later step). */
function stampPlus(code, socket, said) {
  const room = rooms.get(code);
  const p = room && socket && socket.data && room.players.find((q) => q.id === socket.data.playerId);
  if (p) { Plus.stampFor(p, said, socket); Plus.dedupe(room, p); }
}
const roomSockets = new Map();
const timers = new Map();

const newId = () => crypto.randomBytes(8).toString("hex");
const newCode = () => {
  const A = "ABCDEFGHJKMNPRTWXYZ";
  let c = "";
  for (let i = 0; i < 6; i++) c += A[crypto.randomInt(A.length)];
  return rooms.has(c) ? newCode() : c;
};
const clean = (s, n) => String(s || "").replace(/[<>]/g, "").trim().slice(0, n);
const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = crypto.randomInt(i + 1); [a[i], a[j]] = [a[j], a[i]]; } return a; };

function clearT(code) { const t = timers.get(code); if (t) { clearTimeout(t); timers.delete(code); } }
function deleteRoom(code) { clearT(code); rooms.delete(code); roomSockets.delete(code); }
function activeSeats(room) { return room.players.map((p, i) => (!p.left ? i : -1)).filter((i) => i >= 0); }

/* T13: head-to-head rounds. Each round deals one prompt per active seat; prompt k goes to seats k and k+1 (mod P),
   so every player answers two prompts and every prompt gets exactly two answers. Matchups are then voted one at a
   time by everyone else: 100 points per vote, +100 "quiplash" bonus when at least two votes were cast and all of them
   went to the same answer. Three rounds, then final scores. */
function makeMatchups(seats, prompts) {
  const P = seats.length;
  return prompts.slice(0, P).map((prompt, k) => ({ id: crypto.randomBytes(5).toString("hex"), k, prompt, seats: [seats[k], seats[(k + 1) % P]], subs: {}, entries: null, votes: {}, tally: null, done: false }));
}
/* The room's prompts: its pack's in a Plus room (the host's pick), else the classic ones. */
function packOf(room) { return Plus.gate(room, room.pack || "classic", "classic"); }
function setupGame(room) {
  room.deck = shuffle(Packs.promptsFor(packOf(room), PROMPTS));
  room.deckPos = 0;
  room.round = 0;
  room.scores = room.players.map(() => 0);
  room.ledger = [];       // one line per answer that went to the vote (summary.js)
  room.summary = null;
  room.winner = null;
  room.status = "playing";
  beginWrite(room);
}
function beginWrite(room) {
  room.round++;
  const act = activeSeats(room);
  if (room.deckPos + act.length > room.deck.length) room.deck = room.deck.concat(shuffle(PROMPTS.slice()));   // a long game tops up from the classic ones
  room.matchups = makeMatchups(act, room.deck.slice(room.deckPos, room.deckPos + act.length));
  room.deckPos += act.length;
  room.mi = -1;
  room.phase = "write";
  room.writeStartedAt = Date.now();
  room.log = `Round ${room.round} of ${ROUNDS}. Two prompts each — fill in both blanks.`;
  armTimer(room, writeMsFor(act.length));
}
function promptsOf(room, seat) { return (room.matchups || []).filter((m) => m.seats.includes(seat)); }
function votersOf(room, m) { return activeSeats(room).filter((s) => !m.seats.includes(s)); }
function currentMatchup(room) { return room.matchups && room.mi >= 0 ? room.matchups[room.mi] || null : null; }
/* move to the next matchup that can be voted on; matchups with fewer than two answers are walkovers (no points) */
function startMatchup(room) {
  room.mi++;
  while (room.matchups && room.mi < room.matchups.length) {
    const m = room.matchups[room.mi];
    // T4: entry ids are random — the seat stays server-side until the reveal
    const entries = m.seats.map((seat) => ({ id: crypto.randomBytes(5).toString("hex"), seat, text: m.subs[seat] })).filter((e) => e.text !== undefined);
    if (entries.length === 2 && votersOf(room, m).length) {
      m.entries = shuffle(entries); m.votes = {};
      room.phase = "vote";
      room.log = `Matchup ${room.mi + 1} of ${room.matchups.length}. Pick the funnier answer.`;
      armTimer(room, voteMsFor(activeSeats(room).length));
      return;
    }
    m.entries = entries; m.tally = {}; m.done = true; m.skipped = true;
    for (const e of entries) { e.votes = 0; e.bonus = 0; e.pts = 0; room.ledger.push({ round: room.round, seat: e.seat, votes: 0, pts: 0, bonus: 0, at: m.subAt && m.subAt[e.seat] }); }
    room.mi++;
  }
  nextOrEnd(room);
}
function beginVote(room) { room.mi = -1; startMatchup(room); }
function revealMatchup(room) {
  const m = currentMatchup(room);
  if (!m || m.done) return;
  m.tally = {};
  for (const eid of Object.values(m.votes)) m.tally[eid] = (m.tally[eid] || 0) + 1;
  const cast = Object.keys(m.votes).length;
  let line = [];
  for (const e of m.entries) {
    e.votes = m.tally[e.id] || 0;
    e.bonus = cast >= 2 && e.votes === cast ? 100 : 0;
    e.pts = e.votes * 100 + e.bonus;
    room.scores[e.seat] += e.pts;
    room.ledger.push({ round: room.round, seat: e.seat, votes: e.votes, pts: e.pts, bonus: e.bonus, at: m.subAt && m.subAt[e.seat] });
    line.push(`${room.players[e.seat].name} +${e.pts}${e.bonus ? " (QUIPLASH!)" : ""}`);
  }
  m.done = true;
  room.phase = "reveal";
  room.log = `The authors, revealed: ${line.join(" · ")}.`;
  armTimer(room, revealMsFor(cast));
}
/* The game is over: the match summary is worked out once, here (summary.js), and the winner, the log line and every result
   panel come from it. A game with no vote in it has no winner. how: "played", or "left" (everyone else left; `last` is
   the one still seated). */
function finishGame(room, how, last) {
  room.status = "over";
  room.phase = "over";
  clearT(room.code);
  if (room.hold) { if (room.hold.timer) clearTimeout(room.hold.timer); room.hold = null; }
  room.phaseEndsAt = null;
  const sum = Summary.build({ players: room.players, ledger: room.ledger || [], rounds: ROUNDS, how, last });
  room.summary = sum;
  room.winner = sum.winner;
  room.log = sum.line;
}
function nextOrEnd(room) {
  if (room.round >= ROUNDS) finishGame(room, "played");
  else beginWrite(room);
}
/* T1 AFK policy. No bot heuristic here: a skipped seat is simply not waited for.
   "Pending" = active players who still owe the phase's action and are not marked away. */
function pendingActors(room) {
  const act = activeSeats(room).filter((s) => !room.players[s].bot && !room.players[s].botControlled);
  if (room.phase === "write") return act.filter((s) => promptsOf(room, s).some((m) => m.subs[s] === undefined)).map((s) => room.players[s]);
  if (room.phase === "vote") { const m = currentMatchup(room); if (!m) return []; return act.filter((s) => !m.seats.includes(s) && m.votes[s] === undefined).map((s) => room.players[s]); }
  return [];
}
/* ---------- the hold ----------
   While somebody holds, the phase's deadline, the stand-ins' timers and the last-one countdown stand still, and carry on with what was left when the
   last reader has done (or HOLD_MAX_MS is up). room.hold = { seats, since, left, hurryLeft, timer }; the state says who and how much was left ("held"). */
function holdable(room) { return room.status === "playing" && ["write", "vote", "reveal"].includes(room.phase) && !!room.phaseEndsAt; }
function startHold(room, seat) {
  const p = room.players[seat];
  if (!p || p.left || !holdable(room)) return false;
  if (room.hold && room.hold.seats.has(seat)) return true;
  if ((p.holds || 0) >= HOLDS_PER_GAME) return false;
  p.holds = (p.holds || 0) + 1;
  if (!room.hold) {
    const now = Date.now();
    room.hold = { seats: new Set(), since: now, left: Math.max(0, room.phaseEndsAt - now), hurryLeft: room.hurry ? Math.max(0, room.hurry.endsAt - now) : null, timer: null };
    clearT(room.code);
    clearStandIns(room);
    room.hold.timer = setTimeout(() => { const r = rooms.get(room.code); if (r === room && r.hold) { releaseHold(r, null); bump(r); } }, HOLD_MAX_MS);
    if (room.hold.timer.unref) room.hold.timer.unref();
    room.log = `${p.name} is reading the rules: the clock waits.`;
    evlog("hold", { room: room.code, round: room.round, phase: room.phase, seat, left: room.hold.left });
  }
  room.hold.seats.add(seat);
  return true;
}
/* seat null lets every reader go (the longest hold is up, or the game is over) */
function releaseHold(room, seat) {
  const h = room.hold;
  if (!h) return false;
  if (seat !== null) { h.seats.delete(seat); if (h.seats.size > 0) return true; }
  if (h.timer) clearTimeout(h.timer);
  room.hold = null;
  if (room.status !== "playing") return true;
  const now = Date.now(), gone = now - h.since;
  room.phaseStartedAt = (room.phaseStartedAt || now) + gone;
  if (room.writeStartedAt) room.writeStartedAt += gone;
  room.phaseEndsAt = now + h.left;
  if (room.hurry) room.hurry.endsAt = now + (h.hurryLeft != null ? h.hurryLeft : h.left);
  clearT(room.code);
  timers.set(room.code, setTimeout(() => onPhaseTimeout(room.code), Math.max(0, h.left)));
  scheduleStandIns(room);
  room.log = "Back on.";
  evlog("unhold", { room: room.code, round: room.round, phase: room.phase, ms: gone });
  return true;
}
function refreshAfkClock(room) {
  if (room.hold) return;   // the clocks are held: nothing is waited out
  if (room.status !== "playing" || !["write", "vote"].includes(room.phase)) return;
  const pend = pendingActors(room);
  if (!pend.length) { if (maybeAdvance(room)) return; }
  if (!pend.length || pend.some((p) => p.connected)) return;
  // the fast clock waits out the grace: the one who left last is given AFK_GRACE_MS from the moment they left
  const lastGone = Math.max(...pend.map((p) => p.discAt || 0));
  const soon = Math.max(Date.now() + AFK_MS, lastGone + AFK_GRACE_MS);
  if (room.phaseEndsAt && room.phaseEndsAt <= soon) return;
  if (!room.afkFast) room.fullEnd = room.phaseEndsAt;
  room.afkFast = true;
  room.phaseEndsAt = soon;
  clearT(room.code);
  timers.set(room.code, setTimeout(() => onPhaseTimeout(room.code), Math.max(0, soon - Date.now())));
}
function armTimer(room, ms) {
  clearT(room.code);
  room.afkFast = false;
  room.phaseMs = ms;
  room.hurry = null;
  room.phaseStartedAt = Date.now();
  room.phaseToken = (room.phaseToken || 0) + 1;
  room.phaseEndsAt = Date.now() + ms;
  if (room.hold) {   // somebody is reading the rules as this phase begins: it begins held, its whole clock waiting
    room.hold.left = ms; room.hold.hurryLeft = null; room.hold.since = Date.now();
    clearStandIns(room);
    return;
  }
  timers.set(room.code, setTimeout(() => onPhaseTimeout(room.code), ms));
  scheduleStandIns(room);
  refreshAfkClock(room);
}
function onPhaseTimeout(code) {
  const r = rooms.get(code);
  if (!r || r.status !== "playing" || r.hold) return;
  const notes = [];
  // a fast AFK clock that fires after the player came back must not count against them: give the phase its full time again
  if (r.afkFast && pendingActors(r).some((p) => p.connected) && r.fullEnd > Date.now() + 50) {
    r.afkFast = false;
    clearT(code); r.phaseEndsAt = r.fullEnd;
    timers.set(code, setTimeout(() => onPhaseTimeout(code), r.fullEnd - Date.now()));
    bump(r);
    return;
  }
  r.afkFast = false;
  const missed = pendingActors(r);   // the people who never acted this phase (counted below, before a stand-in speaks for them)
  fillStandIns(r);   // a stand-in that has not spoken yet speaks now, so the round has every answer and every vote it can have
  for (const p of missed) {
    p.timeouts = (p.timeouts || 0) + 1;
    if (p.timeouts >= TIMEOUTS_TO_BOT && !p.botControlled) { p.botControlled = true; notes.push(`${p.name} is away (missed ${TIMEOUTS_TO_BOT} in a row) — a comic stands in for them.`); }
  }
  if (r.phase === "write") beginVote(r);
  else if (r.phase === "vote") revealMatchup(r);
  else if (r.phase === "reveal") startMatchup(r);
  if (notes.length) r.log = `${notes.join(" ")} ${r.log || ""}`.trim();
  bump(r);
}
/* The last one: once all but one of the PEOPLE (comics and away seats never count) have locked in, the one still to go has HURRY_MS,
   if the clock has more than that left. Needs two people at least, so a lone person with comics is never hurried. The phase moves on
   at once when they lock in (maybeAdvance); else when the HURRY_MS are up. room.hurry = { seat, endsAt } says so. */
function refreshHurry(room) {
  if (room.status !== "playing" || room.hurry || room.hold || !["write", "vote"].includes(room.phase)) return false;
  const all = [], owe = [];
  if (room.phase === "write") {
    for (const s of activeSeats(room)) { const p = room.players[s]; if (p.bot || p.botControlled) continue; all.push(s); if (promptsOf(room, s).some((m) => m.subs[s] === undefined)) owe.push(s); }
  } else {
    const m = currentMatchup(room);
    if (!m || !m.entries) return false;
    for (const s of votersOf(room, m)) { const p = room.players[s]; if (p.bot || p.botControlled) continue; all.push(s); if (m.votes[s] === undefined) owe.push(s); }
  }
  if (all.length < 2 || owe.length !== 1) return false;
  const ends = Date.now() + HURRY_MS;
  if (room.phaseEndsAt && room.phaseEndsAt <= ends) return false;   // the clock is shorter already
  room.hurry = { seat: owe[0], endsAt: ends };
  room.afkFast = false;
  room.phaseEndsAt = ends;
  clearT(room.code);
  timers.set(room.code, setTimeout(() => onPhaseTimeout(room.code), HURRY_MS));
  room.log = `${room.players[owe[0]].name} is the last one in — ${Math.round(HURRY_MS / 1000)} seconds!`;
  evlog("hurry", { room: room.code, round: room.round, phase: room.phase, seat: owe[0], ms: Date.now() - (room.phaseStartedAt || Date.now()) });
  return true;
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
  const act = activeSeats(room);   // every seat is waited for: a stand-in answers on its own clock (scheduleStandIns), inside the phase
  if (room.phase === "write" && act.every((s) => promptsOf(room, s).every((m) => m.subs[s] !== undefined))) { beginVote(room); return true; }
  if (room.phase === "vote") {
    const m = currentMatchup(room);
    if (m && act.filter((s) => !m.seats.includes(s)).every((s) => m.votes[s] !== undefined)) { revealMatchup(room); return true; }
  }
  return false;
}

/* ---------- the stand-ins (2026-11-01) ----------
   A seat stands in for its person when it is a comic (a bot), away (3 missed phases in a row) or dropped (the link is down).
   It answers from the comics' bank at a random time inside the write clock and casts a random vote on every matchup it is
   not in, so a table with two people missing still has an answer in every blank and a vote on every matchup. Never moderated:
   nothing here is typed by a person (test/comics.js reads the whole bank). */
function standsIn(p) { return !!p && !p.left && (p.bot || p.botControlled || p.connected === false); }
/* the earliest a stand-in may speak for a person whose link has just dropped: after the grace, so a phone in the background is waited for */
function standInNotBefore(p) { return p.bot || p.botControlled ? 0 : Math.max(0, (p.discAt || Date.now()) + AFK_GRACE_MS - Date.now()); }
function clearStandIns(room) { if (room.si) { for (const t of room.si.timers) clearTimeout(t); room.si = null; } }
function scheduleStandIns(room) {
  if (room.hold || room.status !== "playing" || !["write", "vote"].includes(room.phase)) { clearStandIns(room); return; }
  if (!room.si || room.si.token !== room.phaseToken) { clearStandIns(room); room.si = { token: room.phaseToken, timers: new Set(), keys: new Set() }; }
  const si = room.si, code = room.code, token = room.phaseToken;
  const once = (key, ms, fn) => {
    if (si.keys.has(key)) return;
    si.keys.add(key);
    const t = setTimeout(() => {
      si.timers.delete(t);
      const r = rooms.get(code);
      if (!r || r !== room || r.phaseToken !== token || r.status !== "playing") return;
      try { fn(); } catch (e) { console.error("stand-in failed:", (e && e.stack) || e); }
    }, Math.max(0, Math.round(ms)));
    if (t.unref) t.unref();
    si.timers.add(t);
  };
  if (room.phase === "write") {
    const scale = Math.min(1, (room.phaseMs || WRITE_REF_MS) / WRITE_REF_MS);
    for (const s of activeSeats(room)) {
      const p = room.players[s];
      if (!standsIn(p)) continue;
      for (const m of promptsOf(room, s)) {
        if (m.subs[s] !== undefined) continue;
        once(`w|${m.id}|${s}`, Math.max(standInNotBefore(p), rndBetween(SUBMIT_MS[0] * scale, SUBMIT_MS[1] * scale)), () => standInAnswer(room, s, m.id));
      }
    }
  } else {
    const m = currentMatchup(room);
    if (!m || !m.entries) return;
    const scale = Math.min(1, (room.phaseMs || VOTE_REF_MS) / VOTE_REF_MS);
    for (const s of votersOf(room, m)) {
      const p = room.players[s];
      if (!standsIn(p) || m.votes[s] !== undefined) continue;
      once(`v|${m.id}|${s}`, Math.max(standInNotBefore(p), rndBetween(VOTE_AFTER_MS[0] * scale, VOTE_AFTER_MS[1] * scale)), () => standInVote(room, s, m.id));
    }
  }
}
function comicLine(room, m) { return Comics.answer(m.prompt, room.comicsUsed || (room.comicsUsed = new Set())); }
function standInAnswer(room, seat, promptId, now) {
  if (room.status !== "playing" || room.phase !== "write") return false;
  const p = room.players[seat];
  if (!standsIn(p)) return false;   // the person is back at the table: their move is theirs
  const m = (room.matchups || []).find((x) => x.id === promptId && x.seats.includes(seat));
  if (!m || m.subs[seat] !== undefined) return false;
  m.subs[seat] = comicLine(room, m);
  const at = Date.now() - (room.writeStartedAt || Date.now());
  (m.subAt = m.subAt || {})[seat] = at;
  evlog("comic_answer", { room: room.code, round: room.round, seat, ms: at, instant: !!now });
  if (!now) { if (!maybeAdvance(room)) { if (!refreshHurry(room)) refreshAfkClock(room); } bump(room); }
  return true;
}
function standInVote(room, seat, matchupId, now) {
  const m = currentMatchup(room);
  if (room.status !== "playing" || room.phase !== "vote" || !m || m.id !== matchupId || !m.entries) return false;
  const p = room.players[seat];
  if (!standsIn(p) || m.seats.includes(seat) || m.votes[seat] !== undefined) return false;
  const e = m.entries[crypto.randomInt(m.entries.length)];   // a random one of the two; it is never the voter's own (a voter is not in the matchup)
  m.votes[seat] = e.id;
  evlog("comic_vote", { room: room.code, round: room.round, matchup: room.mi, seat, ms: Date.now() - (room.phaseStartedAt || Date.now()), instant: !!now });
  if (!now) { if (!maybeAdvance(room)) { if (!refreshHurry(room)) refreshAfkClock(room); } bump(room); }
  return true;
}
/* the phase is ending: every stand-in that has not spoken speaks now (an answer in every blank, a vote on every matchup) */
function fillStandIns(room) {
  if (room.phase === "write") {
    for (const s of activeSeats(room)) if (standsIn(room.players[s])) for (const m of promptsOf(room, s)) if (m.subs[s] === undefined) standInAnswer(room, s, m.id, true);
  } else if (room.phase === "vote") {
    const m = currentMatchup(room);
    if (m && m.entries) for (const s of votersOf(room, m)) if (standsIn(room.players[s]) && m.votes[s] === undefined) standInVote(room, s, m.id, true);
  }
}
const seatedCount = (room) => room.players.filter((p) => !p.left).length;
/* ---------- the people (2026-11-04) ----------
   A player's `pick` is the person they chose (m1-m4, f1-f4, else null: an older app, or someone who never picked; nobody's is guessed) and stays theirs; `person` is who
   they wear at this table. No two at a table wear the same person while there are free ones: a newcomer whose pick is taken wears the next free one of the same kind
   (a man's for a man, a woman's for a woman), and once all four of a kind are worn, people repeat within that kind. A comic is dealt a free person (else a repeat)
   and its name; it yields its person to a human who picks it in the lobby. The persons are worked out again after every change in the lobby, so a player bumped
   from their pick gets it back when it frees; once a game is under way nobody changes (a seat's person is part of the show). */
/* Who picked a person first has it: a pick is stamped when it is made (a join or a change), so a newcomer, or someone changing their mind, yields to the people already there. */
function setPick(room, p, pick) { if (!p || p.pick === pick) return; p.pick = pick; p.pickAt = room.pickSeq = (room.pickSeq || 0) + 1; }
const wornAtTable = (room, except) => room.players.filter((p) => !p.left && p !== except && p.person).map((p) => p.person);
function dealHumanPerson(room, p) { p.person = p.pick ? Comics.dealHuman(p.pick, wornAtTable(room, p)) : null; }
function redealLobby(room) {
  if (!room || room.status !== "lobby") return;
  const worn = [];
  const humans = room.players.filter((p) => !p.left && !p.bot).sort((a, b) => (a.pickAt || 0) - (b.pickAt || 0));
  for (const p of humans) {   // humans first, whoever picked first first: their pick, else the next free one of their kind
    p.person = p.pick ? Comics.dealHuman(p.pick, worn) : null;
    if (p.person) worn.push(p.person);
  }
  const names = new Set(room.players.filter((p) => !p.left && !p.bot).map((p) => p.name));
  for (const p of room.players) {   // then the comics keep theirs unless a human has it (and then take a free one, if there is one)
    if (p.left || !p.bot) continue;
    const free = Comics.PERSON_IDS.some((id) => !worn.includes(id));
    if (p.person && (!worn.includes(p.person) || !free)) { worn.push(p.person); names.add(p.name); continue; }
    const d = Comics.dealComic(worn, names);
    p.person = d.person; p.name = d.name; worn.push(d.person); names.add(d.name);
  }
}
/* a comic the host sat down, or took the seat of a person who left: dealt a person and its name */
function newComic(room) {
  const d = Comics.dealComic(wornAtTable(room), new Set(room.players.filter((p) => !p.left).map((p) => p.name)));
  return { id: "bot_" + newId(), name: d.name || "Comic " + (room.players.length + 1), avatar: d.avatar, person: d.person, bot: true, left: false, connected: true };
}
function addComics(room, upTo) { let n = 0; while (seatedCount(room) < Math.min(upTo, MAX_PLAYERS)) { room.players.push(newComic(room)); n++; } return n; }

/* ---------- per-player filtered state: answers stay anonymous ---------- */
function stateFor(room, seat) {
  const over = room.status === "over";
  const revealPhase = room.phase === "reveal" || over;
  return {
    code: room.code, status: room.status, phase: room.phase,
    round: room.round || 0, rounds: ROUNDS,
    log: room.log, winner: room.winner != null ? room.winner : null,
    summary: room.summary || null,   // 2026-11-01: the one match summary (summary.js) once the game is over, else null
    phaseEndsAt: room.phaseEndsAt || null,
    phaseMs: room.phaseMs || null, phaseStartedAt: room.phaseStartedAt || null,   // the phase's whole clock, and when it began (2026-11-01)
    hurry: room.hurry || null,   // the last person to lock in has until hurry.endsAt (a 10 s countdown)
    held: room.hold ? { by: [...room.hold.seats].map((s) => room.players[s] && room.players[s].name).filter(Boolean), left: room.hold.left } : null,   // somebody is reading the rules: the clocks wait, with this much left
    hostSeat: room.players.findIndex((p) => p.id === room.host),
    minPlayers: MIN_PLAYERS, maxPlayers: MAX_PLAYERS, fillSeats: FILL_SEATS,
    features: FEATURES,
    players: room.players.map((p, s) => ({
      name: p.name, avatar: p.avatar, person: p.person || null, ...Plus.seat(p), left: p.left, connected: p.connected, botControlled: !!p.botControlled, ...(p.bot ? { bot: true } : {}),
      score: room.scores ? room.scores[s] : 0,
      submitted: room.phase === "write" ? promptsOf(room, s).every((m) => m.subs[s] !== undefined) : undefined,
      voted: room.phase === "vote" ? (() => { const m = currentMatchup(room); return !!m && (m.seats.includes(s) || m.votes[s] !== undefined); })() : undefined,
    })),
    yourPrompts: seat >= 0 && room.matchups ? promptsOf(room, seat).map((m) => ({ id: m.id, prompt: m.prompt, text: m.subs[seat] ?? null })) : [],
    yourVote: (() => { const m = currentMatchup(room); return m && seat >= 0 ? m.votes[seat] ?? null : null; })(),
    matchup: (() => {
      const m = currentMatchup(room);
      if (!m || !m.entries || room.phase === "write") return null;
      const shown = revealPhase || m.done;
      return {
        id: m.id, index: room.mi, count: room.matchups.length, prompt: m.prompt,
        contestant: m.seats.includes(seat),
        canVote: room.phase === "vote" && seat >= 0 && !m.seats.includes(seat) && !room.players[seat].left,
        entries: m.entries.map((e) => ({ id: e.id, text: e.text, mine: e.seat === seat, votes: shown ? e.votes : undefined, by: shown ? e.seat : undefined, bonus: shown ? e.bonus : undefined, pts: shown ? e.pts : undefined })),
      };
    })(),
    matchups: over && room.matchups ? room.matchups.map((m) => ({ prompt: m.prompt, entries: (m.entries || []).map((e) => ({ text: e.text, by: e.seat, votes: e.votes || 0, pts: e.pts || 0, bonus: e.bonus || 0 })) })) : undefined,
    voice: room.voice ? Array.from(room.voice) : [],
    chat: (room.chat || []).slice(-60),
    ...Reactions.view(room),   // 2026-10-15: reactionsOn and the last reactions (after every old field)
    ...Quick.view(room),   // quick play (2026-11-01): quick { searching, seats, fillAt, now } while a quick room is finding people
    ...Voice.view(room),   // voice chat (2026-11-18): gnVoice { on, peers }
    ...Played.view(room, "punchlines"),   // Friends (2026-11-19): reports a finished game once; adds no field
    pack: packOf(room),   // GameNest Plus's prompt pack in use (2026-10-17), after them
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

/* ---------- the waiting line (the owner, 2026-09-29) ----------
   Someone who joins a game already under way (and whose app says "waitList") waits in line,
   watching. A seat someone leaves mid-game goes to the first in line at once, keeping the seat's game. The rest are seated at the next game, bots making room if the table is full. */
function takeLeftSeats(room) {
  if (!true || !room.waiting || !room.waiting.length || room.status === "lobby" || room.status === "over") return false;
  let seated = false;
  for (let seat = 0; seat < room.players.length && room.waiting.length; seat++) {
    const old = room.players[seat];
    if (!old.left) continue;
    const w = room.waiting.shift();
    // The seat keeps its game (its place, its cards, its score); only who sits in it changes.
    room.players[seat] = Object.assign({}, old, { id: w.id, name: w.name, avatar: w.avatar, bot: false, botControlled: false,
      left: false, connected: true, plus: w.plus, acct: w.acct, look: w.look, timeouts: 0, pick: null, person: null });
    setPick(room, room.players[seat], w.pick || null);
    dealHumanPerson(room, room.players[seat]);
    room.log = `${w.name} took ${old.name}'s seat.`;
    seated = true;
  }
  return seated;
}
function seatTheLine(room) {
  while (room.waiting && room.waiting.length) {
    if (room.players.length >= MAX_PLAYERS) {
      const bot = room.players.findIndex((p) => p.bot);
      if (bot < 0) break;
      room.players.splice(bot, 1);
    }
    const w = room.waiting.shift();
    const seat = { id: w.id, name: w.name, avatar: w.avatar, bot: false, left: false, connected: true, plus: w.plus, acct: w.acct, look: w.look, pick: null, person: null };
    seat.plus = w.plus;
    setPick(room, seat, w.pick || null);
    room.players.push(seat);
    dealHumanPerson(room, seat);
  }
}
function lineState(room, st, playerId, seat) {
  st.waiting = (room.waiting || []).map((w) => ({ name: w.name, avatar: w.avatar }));
  st.waitPos = seat < 0 ? (room.waiting || []).findIndex((w) => w.id === playerId) + 1 : 0;
  return st;
}

function sendState(code) {
  const room = rooms.get(code);
  const socks = roomSockets.get(code);
  if (!room || !socks) return;
  for (const s of socks) {
    const seat = room.players.findIndex((p) => p.id === s.data.playerId);
    s.emit("state", { room: lineState(room, stateFor(room, seat), s.data.playerId, seat), mySeat: seat, v: room.v });
    try { pushTurn(room); } catch (_) {}
  }
}


/* T3: the host seat follows the humans — first connected human, else first human still seated, else unchanged. */
function ensureHost(room) {
  const cur = room.players.find((p) => p.id === room.host);
  if (cur && !cur.bot && !cur.left && cur.connected) return false;
  const next = room.players.find((p) => !p.bot && !p.left && p.connected) || room.players.find((p) => !p.bot && !p.left);
  if (!next || next.id === room.host) return false;
  room.host = next.id;
  room.log = `${next.name} is now the host.`;
  return true;
}

/* No ladder for a party game: rated is off, so nothing is rated and no rating is kept; the quick-play half is what is used. */
Quick.init({ game: "punchlines", model: "openskill", seats: FILL_SEATS, codeKey: "code", app, io, rooms, base: BASE, broadcast: sendState, rated: () => false });
io.on("connection", (socket) => {
  Plus.guardSocket(socket);   // the wallet's signed entitlement: every event's `plus` is the checked answer (the Nest Wallet repo, contrib/ROLLOUT.md)
  Quick.hook(socket); Quick.connection(socket);   // before the server's own events
  const on = guarded(socket);   // every client event below goes through the guard
  socket.data.playerId = null;
  socket.data.code = null;
  const currentRoom = () => rooms.get(socket.data.code);
  Voice.wire({ on: on, room: currentRoom, me: () => socket.data.playerId, bump: bump, emit: (ev, d) => socket.emit(ev, d) });   // voice chat in private rooms (2026-11-18)
  Reactions.wire({ on, room: currentRoom, me: () => socket.data.playerId, isHost: (r) => r.host === socket.data.playerId, bump });
  const attach = (code) => { socket.data.code = code; if (!roomSockets.has(code)) roomSockets.set(code, new Set()); roomSockets.get(code).add(socket); };
  const detach = () => { const set = roomSockets.get(socket.data.code); if (set) set.delete(socket); socket.data.code = null; };
  const mySeat = () => { const r = currentRoom(); return r ? r.players.findIndex((p) => p.id === socket.data.playerId) : -1; };

  on("create", ({ name, playerId, avatar, plus, look, crew, person } = {}) => {
    name = clean(name, 18); if (!name) return socket.emit("err", "Pick a name first."); name = Moderation.name(name);
    const code = Plus.crewCode({ plus, crew }, rooms, newCode);   // GameNest Plus's crew code (2026-10-17)
    const room = { code, status: "lobby", host: playerId, players: [], chat: [], log: "", v: 1, touched: Date.now(), voice: new Set(), phase: "lobby" };
    room.players.push({ id: playerId, name, avatar: clean(avatar, 4) || "\u{1F3A4}", left: false, connected: true, pick: null });
    setPick(room, room.players[0], Comics.personOf(person));
    redealLobby(room);
    rooms.set(code, room);
    socket.data.playerId = playerId;
    attach(code);
    stampPlus(code, socket, { plus, look }); socket.emit("joined", { code });
    bump(room);
  });

  on("join", ({ code, name, playerId, avatar, plus, look, caps, person } = {}) => {
    code = clean(code, 6).toUpperCase();
    const room = rooms.get(code);
    if (!room) return socket.emit("err", "No room with that code.");
    socket.data.playerId = playerId;
    const existing = room.players.find((p) => p.id === playerId);
    if (existing) { existing.connected = true; existing.left = false; if (room.status === "lobby" && Comics.personOf(person)) { setPick(room, existing, Comics.personOf(person)); redealLobby(room); } humanIsBack(room, existing, "reconnected"); attach(code); stampPlus(code, socket, { plus, look }); socket.emit("joined", { code }); bump(room); return; }
    if (room.status === "lobby" && room.players.length >= MAX_PLAYERS) return socket.emit("err", "Room is full (12).");
    name = clean(name, 18); if (!name) return socket.emit("err", "Pick a name first."); name = Moderation.name(name);
    // A game under way: an app that knows the line waits in it; an older one hears the game has started.
    if (room.status !== "lobby") {
      if (!(Array.isArray(caps) && caps.includes("waitList"))) return socket.emit("err", "That game already started.");
      room.waiting = room.waiting || [];
      if (!room.waiting.some((q) => q.id === playerId)) {
        if (room.waiting.length >= MAX_PLAYERS) return socket.emit("err", "Room is full (12).");
        room.waiting.push({ id: playerId, name, avatar: clean(avatar, 4) || "\u{1F3A4}", plus: plus === true, acct: Plus.acctOf(socket), look: Plus.cleanLook(look), caps, pick: Comics.personOf(person) });
        room.log = `${name} is waiting for a seat.`;
      }
      attach(code);
      socket.emit("joined", { code, waiting: true });
      takeLeftSeats(room);
      bump(room);
      return;
    }
    room.players.push({ id: playerId, name, avatar: clean(avatar, 4) || "\u{1F3A4}", left: false, connected: true, pick: null });
    setPick(room, room.players[room.players.length - 1], Comics.personOf(person));
    redealLobby(room);
    attach(code);
    stampPlus(code, socket, { plus, look }); socket.emit("joined", { code });
    room.log = `${name} joined.`;
    bump(room);
  });

  /* GameNest Plus's prompt packs: the host's pick in the lobby; the three themed ones a Plus room's only. */
  on("settings", ({ pack } = {}) => {
    const room = currentRoom();
    if (!room || room.status !== "lobby" || room.host !== socket.data.playerId) return;
    if (typeof pack !== "string" || !Packs.IDS.includes(pack)) return;
    if (pack !== "classic" && !Plus.isPlusRoom(room)) return socket.emit("refusal", { code: "plus", message: "Prompt packs come with GameNest Plus.", op: "settings" });
    room.pack = pack;
    room.log = pack === "classic" ? "The classic prompts." : `Prompts: ${Packs.PACKS[pack].name}.`;
    bump(room);
  });

  /* Who stands behind my podium (2026-11-04): { person: "m1".."m4" | "f1".."f4" } in the lobby. A pick that is worn already gives the next free person of its kind (see the people, above). */
  on("person", ({ person } = {}) => {
    const room = currentRoom();
    if (!room || room.status !== "lobby") return;
    const me = room.players[mySeat()];
    const pick = Comics.personOf(person);
    if (!me || me.left || !pick) return;
    setPick(room, me, pick);
    redealLobby(room);
    bump(room);
  });

  /* The comics (2026-11-01): the host seats one, takes the last away, or fills the table with them in one tap. */
  on("addBot", () => {
    const room = currentRoom();
    if (!room || room.status !== "lobby" || room.host !== socket.data.playerId) return;
    if (seatedCount(room) >= MAX_PLAYERS) return socket.emit("err", `Room is full (${MAX_PLAYERS}).`);
    const c = newComic(room);
    room.players.push(c);
    redealLobby(room);
    room.log = `${c.name} (a comic) took a seat.`;
    bump(room);
  });
  on("removeBot", () => {
    const room = currentRoom();
    if (!room || room.status !== "lobby" || room.host !== socket.data.playerId) return;
    for (let k = room.players.length - 1; k >= 0; k--) if (room.players[k].bot) { room.log = `${room.players[k].name} left.`; room.players.splice(k, 1); break; }
    redealLobby(room);
    bump(room);
  });
  on("fillBots", ({ n } = {}) => {   // "Fill with comics": up to n seats (FILL_SEATS by default)
    const room = currentRoom();
    if (!room || room.status !== "lobby" || room.host !== socket.data.playerId) return;
    const want = Number.isInteger(n) ? Math.min(MAX_PLAYERS, Math.max(FLOOR_SEATS, n)) : FILL_SEATS;
    const added = addComics(room, want);
    redealLobby(room);
    if (added) room.log = `${added === 1 ? "A comic" : added + " comics"} took the empty seats.`;
    bump(room);
  });
  on("start", () => {
    const room = currentRoom();
    if (!room || room.status !== "lobby" || room.host !== socket.data.playerId) return;
    if (seatedCount(room) < MIN_PLAYERS)
      return socket.emit("err", `Punchlines needs at least ${MIN_PLAYERS} at the table. Invite a friend, or tap Fill with comics.`);
    addComics(room, FLOOR_SEATS);   // two people: a comic joins them, so every matchup has someone to vote on it
    redealLobby(room);
    setupGame(room);
    bump(room);
  });

  on("submit", ({ id, text } = {}) => {   // T13: one answer per prompt; { id } names the prompt (first unanswered when omitted)
    const room = currentRoom();
    if (!room || room.status !== "playing" || room.phase !== "write") return;
    const seat = mySeat();
    const me = room.players[seat];
    if (!me || me.left) return;
    humanIsBack(room, me, "took the seat back"); me.timeouts = 0;
    text = clean(text, 90);
    if (!text) return socket.emit("err", "Write something first.");
    const code = room.code, pid = me.id, rno = room.round;
    // Read first (moderation.js); then the room must still be where it was, or a late answer would land in the wrong phase.
    Moderation.check(text).then((r) => {
      const room = rooms.get(code);
      if (!room || room.status !== "playing" || room.phase !== "write" || room.round !== rno) return;
      const seat = room.players.findIndex((q) => q.id === pid);
      const me = room.players[seat];
      if (!me || me.left) return;
      const mine = promptsOf(room, seat);
      const m = id != null ? mine.find((x) => x.id === id) : mine.find((x) => x.subs[seat] === undefined);
      if (!m) return socket.emit("err", "That prompt isn't yours.");
      m.subs[seat] = r.held ? "(answer removed)" : r.text;
      (m.subAt = m.subAt || {})[seat] = Date.now() - (room.writeStartedAt || Date.now());   // for the tie-break: the earliest answer
      if (!maybeAdvance(room)) { room.log = "Answers are coming in…"; if (!refreshHurry(room)) refreshAfkClock(room); }
      bump(room);
    });
  });

  on("vote", ({ id } = {}) => {
    const room = currentRoom();
    if (!room || room.status !== "playing" || room.phase !== "vote") return;
    const seat = mySeat();
    const me = room.players[seat];
    const m = currentMatchup(room);
    if (!me || me.left || !m || !m.entries) return;
    humanIsBack(room, me, "took the seat back"); me.timeouts = 0;
    if (m.seats.includes(seat)) return socket.emit("err", "Nice try — this one's yours. Sit tight.");
    const entry = m.entries.find((e) => e.id === id);
    if (!entry) return;
    m.votes[seat] = id;
    if (!maybeAdvance(room)) { if (!refreshHurry(room)) refreshAfkClock(room); }
    bump(room);
  });

  on("next", () => { // host can skip the reveal early → next matchup (or next round / final scores)
    const room = currentRoom();
    if (!room || room.status !== "playing" || room.phase !== "reveal" || room.host !== socket.data.playerId) return;
    startMatchup(room);
    bump(room);
  });
  /* The app's How to play sheet, open in the middle of a round: { on: true } holds the clocks, { on: false } lets go (see the hold, above). */
  on("hold", ({ on: want } = {}) => {
    const room = currentRoom();
    const seat = mySeat();
    if (!room || seat < 0) return;
    if (want === true) { if (!startHold(room, seat)) return socket.emit("refusal", { code: "hold", message: "The clock keeps running.", op: "hold" }); }
    else if (!releaseHold(room, seat)) return;
    bump(room);
  });

  on("takeSeat", () => {
    const room = currentRoom(); if (!room) return;
    const me = room.players[mySeat()];
    if (me && humanIsBack(room, me, "took the seat back")) bump(room);
  });
  on("pushToken", ({ token } = {}) => { const room = currentRoom(); if (!room) return; const p = room.players.find((q) => q.id === socket.data.playerId); if (p && typeof token === "string" && /^[0-9a-f]{32,200}$/i.test(token)) p.pushToken = token; });
  on("presence", ({ away } = {}) => { const room = currentRoom(); if (!room) return; const p = room.players.find((q) => q.id === socket.data.playerId); if (p) p.away = !!away; });


  on("chat", ({ t } = {}) => {
    const room = currentRoom();
    if (!room) return;
    const seat = mySeat();
    const me = room.players[seat];
    if (!me || me.left) return;
    const now = Date.now();
    if (me._lastChat && now - me._lastChat < 700) return;
    me._lastChat = now;
    t = clean(t, 140); if (!t) return;
    const code = room.code, pid = me.id;
    Moderation.chat(t).then((shown) => {
      const room = rooms.get(code), me = room && room.players.find((q) => q.id === pid);   // gone while it was read
      if (!me || me.left) return;
      room.chat.push({ n: me.name, a: me.avatar, t: shown }); for (const q of room.players) if (q !== me) pushTo(q, me.name + ": " + shown, { code: room.code, game: PUSH_TITLE }, room.code + "-chat");
      if (room.chat.length > 200) room.chat.splice(0, room.chat.length - 200);
      bump(room);
    });
  });

  on("voice", ({ kind, to, data } = {}) => {
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

  on("rematch", () => {
    const room = currentRoom();
    if (!room || room.status !== "over" || room.host !== socket.data.playerId) return;
    room.players = room.players.filter((p) => !p.left);
    seatTheLine(room);
    if (room.players.length < MIN_PLAYERS) { room.status = "lobby"; room.phase = "lobby"; redealLobby(room); room.log = `Back to the lobby — need ${MIN_PLAYERS}+ (comics count).`; bump(room); return; }
    addComics(room, FLOOR_SEATS);
    room.players.forEach((p) => { if (p.botControlled) { p.botControlled = false; p.timeouts = 0; } });   // a new game: nobody starts it away
    setupGame(room);
    bump(room);
  });

  function handleLeave() {
    const room = currentRoom();
    if (!room) return detach();
    const p = room.players.find((q) => q.id === socket.data.playerId);
    if (!p) {
      // Out of the waiting line.
      const before = (room.waiting || []).length;
      room.waiting = (room.waiting || []).filter((w) => w.id !== socket.data.playerId);
      detach();
      if (room.waiting.length !== before) bump(room);
      return;
    }
    if (room.voice) room.voice.delete(room.players.indexOf(p));
    if (room.hold) releaseHold(room, room.players.indexOf(p));
    if (room.status === "lobby") {
      room.players = room.players.filter((q) => q.id !== p.id);
      if (!room.players.some((q) => !q.bot)) { detach(); deleteRoom(room.code); return; }   // no person left, only comics
      if (room.host === p.id) room.host = room.players.find((q) => !q.bot).id;
      redealLobby(room);
      room.log = `${p.name} left.`;
    } else {
      const seat = room.players.indexOf(p);
      p.left = true; p.connected = false;
      // The first in line takes the seat before anything is decided for want of players.
      const taken = takeLeftSeats(room);
      if (room.players.every((q) => q.left || q.bot)) { detach(); deleteRoom(room.code); return; }   // nobody but comics at the table
      if (room.host === p.id) room.host = (room.players.find((q) => !q.left && !q.bot) || room.players[0]).id;
      if (!taken) room.log = `${p.name} left the game.`;
      if (room.status === "playing" && !taken && !p.bot) {   // nobody waiting for it: a comic takes the seat, with its score, so the table keeps its size
        const c = newComic(room);
        room.players[seat] = c;
        room.log = `${p.name} left. ${c.name} (a comic) took the mic.`;
      }
      if (room.status === "playing") {
        if (activeSeats(room).length < 2) finishGame(room, "left", activeSeats(room)[0]);
        else { scheduleStandIns(room); maybeAdvance(room); }
      }
    }
    detach();
    bump(room);
  }
  on("leave", () => handleLeave());
  socket.on("disconnect", () => {
    const room = currentRoom();
    if (!room) return;
    const p = room.players.find((q) => q.id === socket.data.playerId);
    if (p) { p.connected = false; p.discAt = Date.now(); if (room.voice) room.voice.delete(room.players.indexOf(p)); if (room.hold) releaseHold(room, room.players.indexOf(p)); ensureHost(room); room.v++; }
    detach();
    if (rooms.has(room.code)) { scheduleStandIns(room); refreshAfkClock(room); sendState(room.code); }   // a dropped seat is stood in for once the grace is past
  });
});

setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) if (now - room.touched > 2 * 60 * 60 * 1000) deleteRoom(code);
}, 10 * 60 * 1000);

if (require.main === module) server.listen(PORT, () => console.log("Punchlines running on port " + PORT));
module.exports = { makeMatchups, PROMPTS };
