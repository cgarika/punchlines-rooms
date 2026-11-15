/*
 Punchlines — one guard for every client event (junk payloads), over real sockets.
 Run:  TEST_PORT=<free port> node test/guard.js   (starts its own server; never 3111-3118)
 Proves: a payload that is not an object (null, a number, a string, an array, true) on every event leaves the server
 running (42["join",null] used to stop the whole process, every room with it); a new room can still be made and
 the room in play still hears its players.
*/
"use strict";
const { io } = require("socket.io-client");
const { spawn } = require("child_process");
const path = require("path");

const PORT = Number(process.env.TEST_PORT || 3146), URL = "http://localhost:" + PORT;
if (PORT >= 3111 && PORT <= 3118) { console.error("refusing " + PORT + ": 3111-3118 are the live servers"); process.exit(2); }
const EVENTS = ["chat", "create", "hold", "join", "leave", "next", "presence", "pushToken", "rematch", "start", "submit", "takeSeat", "voice", "vote"];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(10); } return false; };
let n = 0;
const pid = () => "g" + (++n) + "_" + Math.random().toString(36).slice(2, 10);
function mk() {
  const c = io(URL, { transports: ["websocket"], reconnection: false, forceNew: true });
  c.st = null; c.states = 0; c.joined = null;
  c.on("state", (f) => { c.states++; c.st = f.room; });
  c.on("joined", (j) => { c.joined = j.code; });
  return c;
}
let failed = 0;
const ok = (m) => console.log("PASS " + m), bad = (m) => { console.log("FAIL " + m); failed++; };

(async () => {
  let exited = null;
  const srv = spawn(process.execPath, ["server.js"], { cwd: path.join(__dirname, ".."), env: { ...process.env, PORT: String(PORT) }, stdio: ["ignore", "ignore", "pipe"] });
  let stderr = ""; srv.stderr.on("data", (b) => { stderr += b; });
  srv.on("exit", (code, sig) => { exited = code != null ? "code " + code : sig; });
  const socks = [];
  const open = () => { const c = mk(); socks.push(c); return c; };
  try {
    await sleep(700);
    const A = open(), B = open();
    await until(() => A.connected && B.connected);
    A.emit("create", { name: "Host", playerId: pid() });
    await until(() => A.joined && A.st);
    B.emit("join", { code: A.joined, name: "Guest", playerId: pid() });
    await until(() => B.st && B.st.players && B.st.players.length === 2);
    if (!A.joined) throw new Error("the room was not made");

    const C = open(); await until(() => C.connected);
    const junk = [null, 7, "x", [1, 2], true];
    for (const ev of EVENTS) for (const j of junk) { if (ev !== "leave") { A.emit(ev, j); B.emit(ev, j); } C.emit(ev, j); await sleep(5); }
    await sleep(400);
    if (exited) bad(`junk payloads: the server stopped (${exited}); ${stderr.split("\n").find((l) => /Error/.test(l)) || ""}`);
    else ok(`junk payloads: null, a number, a string, an array and true on all ${EVENTS.length} events leave the server running`);

    const D = open(); await until(() => D.connected);
    D.emit("create", { name: "After", playerId: pid() });
    const made = await until(() => D.joined && D.st, 3000);
    const before = A.states;
    B.emit("chat", { t: "still here" });
    const heard = await until(() => A.states > before, 3000);
    if (!exited && made && heard) ok("after the junk: a new room is made and the room in play still hears its players");
    else bad(`after the junk: made ${made}, heard ${heard}, exited ${exited}`);

    // What players type is kept friendly (moderation.js): chat and answers.
    const M = [open(), open(), open()]; await until(() => M.every((c) => c.connected));
    M[0].emit("create", { name: "Mo", playerId: pid() }); await until(() => M[0].joined && M[0].st);
    for (const c of M.slice(1)) c.emit("join", { code: M[0].joined, name: "Mi", playerId: pid() });
    await until(() => M[0].st.players.length === 3);
    M[0].emit("chat", { t: "kill yourself" });
    const rm = await until(() => M[0].st.chat.some((m) => m.t === "(message removed)"), 30000);
    await sleep(800);
    M[0].emit("chat", { t: "what the fuck" });
    const st = await until(() => M[0].st.chat.some((m) => m.t === "what the f***"), 30000);
    if (rm && st) ok("chat: a push to self-harm is removed, swearing is starred"); else bad(`chat moderation: removed ${rm}, starred ${st}`);
    M[0].emit("start"); await until(() => M[0].st.phase === "write");
    M[0].emit("submit", { text: "send nudes" });
    const held = await until(() => (M[0].st.yourPrompts || []).some((q) => q.text === "(answer removed)"), 30000);
    if (held) ok("an answer asking for nudes is stored as (answer removed)"); else bad("answer moderation: not removed");
  } catch (e) { bad("suite error: " + (e && e.stack || e)); }
  finally { socks.forEach((c) => c.close()); srv.kill(); }
  console.log(failed ? `\n${failed} GUARD TEST(S) FAILED` : "\nALL GUARD TESTS PASS");
  process.exit(failed ? 1 : 0);
})();
