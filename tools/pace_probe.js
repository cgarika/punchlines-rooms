/* Punchlines pacing probe (2026-11-01): R rooms at once on a private server with the real clocks, each with P people who play
   at a person's speed (1.5-4 s to write an answer, 1-3 s to pick a vote), C comics, one full game per room. From the states the
   people see it prints p50 / p95 / max (seconds) of
     start -> writing open     (Start to prompts in hand)
     write phase               (the phase's length, first state to the vote)
     vote phase (a matchup)    (the vote's length)
     reveal                    (the reveal's length)
     a person's idle           (from locking in their last move of a phase to the next time they have a move)
     comic answer / vote       (how long after the phase began a stand-in's answer / vote landed)
     game                      (Start to over)
   usage: node tools/pace_probe.js <server root> <rooms> <people> <comics> [rounds]   env: PROBE_PORT (5281) */
"use strict";
const path = require("path");
const { io } = require("socket.io-client");
const root = path.resolve(process.argv[2] || ".");
const ROOMS = Number(process.argv[3] || 2), PEOPLE = Number(process.argv[4] || 3), COMICS = Number(process.argv[5] || 0), ROUNDS = process.argv[6] || "3";
const port = Number(process.env.PROBE_PORT || 5281);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const rnd = (a, b) => a + Math.random() * (b - a);
const pct = (a, p) => { if (!a.length) return null; a = a.slice().sort((x, y) => x - y); const k = (a.length - 1) * p / 100, f = Math.floor(k), c = Math.min(f + 1, a.length - 1); return +((a[f] + (a[c] - a[f]) * (k - f)) / 1000).toFixed(2); };

async function room(n, log) {
  const cs = [];
  for (let i = 0; i < PEOPLE; i++) {
    const c = io(`http://127.0.0.1:${port}`, { transports: ["websocket"], forceNew: true });
    Object.assign(c, { nm: `P${n}_${i}`, pid: `probe_${n}_${i}_${Math.random().toString(16).slice(2, 7)}`, st: null, states: [], acts: [] });
    c.on("state", ({ room: r }) => { c.st = r; c.states.push({ t: Date.now(), r }); });
    c.on("joined", (j) => { c.code = j.code; });
    cs.push(c);
  }
  await sleep(300);
  cs[0].emit("create", { name: cs[0].nm, playerId: cs[0].pid, avatar: "\u{1F3A4}" });
  while (!cs[0].code) await sleep(20);
  for (let i = 1; i < PEOPLE; i++) cs[i].emit("join", { code: cs[0].code, name: cs[i].nm, playerId: cs[i].pid, avatar: "\u{1F3A4}" });
  while (!cs[0].st || cs[0].st.players.length < PEOPLE) await sleep(20);
  for (let i = 0; i < COMICS; i++) { const k = cs[0].st.players.length; cs[0].emit("addBot"); while (cs[0].st.players.length === k) await sleep(20); }
  // a person's play, at a person's speed
  const busy = new Set();
  const player = (c) => setInterval(async () => {
    const r = c.st; if (!r || r.status !== "playing" || busy.has(c)) return;
    if (r.phase === "write") {
      const open = (r.yourPrompts || []).filter((p) => p.text === null); if (!open.length) return;
      busy.add(c); const round = r.round;
      for (const p of open) { await sleep(rnd(1500, 4000)); if (!c.st || c.st.round !== round || c.st.phase !== "write") break; c.emit("submit", { id: p.id, text: `answer ${c.nm} ${p.id.slice(0, 3)}` }); c.acts.push({ t: Date.now(), kind: "write" }); }
      busy.delete(c);
    } else if (r.phase === "vote" && r.matchup && r.matchup.canVote && !r.yourVote) {
      busy.add(c); const id = r.matchup.id; await sleep(rnd(1000, 3000));
      if (c.st && c.st.phase === "vote" && c.st.matchup && c.st.matchup.id === id && !c.st.yourVote) { const e = c.st.matchup.entries.find((x) => !x.mine); c.emit("vote", { id: e.id }); c.acts.push({ t: Date.now(), kind: "vote" }); }
      busy.delete(c);
    }
  }, 40);
  const timers = cs.map(player);
  const t0 = Date.now();
  cs[0].emit("start");
  while (!cs[0].st || cs[0].st.status !== "over") { await sleep(100); if (Date.now() - t0 > 900000) throw new Error("a game took over 15 minutes"); }
  timers.forEach(clearInterval);
  const A = cs[0].states;
  const out = { startToWrite: null, write: [], vote: [], reveal: [], idle: [], comicAnswer: [], comicVote: [], game: Date.now() - t0 };
  const first = A.find((s) => s.r.phase === "write" && s.r.yourPrompts && s.r.yourPrompts.length);
  out.startToWrite = first.t - t0;
  // phase lengths: from the first state of a phase to the first state of the next
  let prev = null;
  for (const s of A) {
    const k = s.r.phase + "|" + s.r.round + "|" + (s.r.matchup ? s.r.matchup.index : "-");
    if (!prev || prev.k !== k) { if (prev && ["write", "vote", "reveal"].includes(prev.phase)) out[prev.phase].push(s.t - prev.t); prev = { k, t: s.t, phase: s.r.phase, ph: s.r }; }
  }
  // comics: when each stand-in's answer or vote landed, from the start of the phase
  const phaseStart = new Map();
  for (const s of A) {
    const r = s.r; if (r.status !== "playing") continue;
    const key = r.phase + "|" + r.round + "|" + (r.matchup ? r.matchup.index : "-");
    if (!phaseStart.has(key)) phaseStart.set(key, { t: s.t, seen: new Set() });
    const ps = phaseStart.get(key);
    r.players.forEach((p, i) => {
      if (!p.bot || ps.seen.has(i)) return;
      if (r.phase === "write" && p.submitted) { ps.seen.add(i); out.comicAnswer.push(s.t - ps.t); }
      if (r.phase === "vote" && p.voted && !(r.matchup && false)) { ps.seen.add(i); out.comicVote.push(s.t - ps.t); }
    });
  }
  // a person's idle: from their last move of a phase to the next time they have one
  for (const c of cs) {
    let lastDone = null, wasActionable = false;
    for (const s of c.states) {
      const r = s.r;
      const actionable = r.status === "playing" && ((r.phase === "write" && (r.yourPrompts || []).some((p) => p.text === null)) || (r.phase === "vote" && r.matchup && r.matchup.canVote && !r.yourVote));
      if (wasActionable && !actionable) lastDone = s.t;
      if (!wasActionable && actionable && lastDone) { out.idle.push(s.t - lastDone); lastDone = null; }
      wasActionable = actionable;
    }
  }
  cs.forEach((c) => c.close());
  return out;
}

(async () => {
  const env = { ...process.env, PORT: String(port), ROUNDS, RANK_DIR: require("os").tmpdir() + "/gn_rank_probe", GN_EVENT_LOG: "0" };
  for (const k of ["WRITE_MS", "VOTE_MS", "REVEAL_MS", "BOT_THINK_MS"]) delete env[k];
  const child = require("child_process").spawn(process.execPath, ["server.js"], { cwd: root, env, stdio: "ignore" });
  for (let i = 0; i < 100; i++) { try { if ((await fetch(`http://127.0.0.1:${port}/`)).status) break; } catch (e) { /* not yet */ } await sleep(100); }
  try {
    const runs = await Promise.all(Array.from({ length: ROOMS }, (_, n) => room(n)));
    const all = (k) => runs.flatMap((r) => (Array.isArray(r[k]) ? r[k] : [r[k]]));
    const row = (name, a) => console.log(name.padEnd(30), String(a.length).padEnd(5), String(pct(a, 50)).padEnd(8), String(pct(a, 95)).padEnd(8), a.length ? +(Math.max(...a) / 1000).toFixed(2) : null);
    console.log(`${path.basename(root)}: ${ROOMS} rooms x (${PEOPLE} people + ${COMICS} comics), ${ROUNDS} rounds, real clocks`);
    console.log("what".padEnd(30), "n".padEnd(5), "p50".padEnd(8), "p95".padEnd(8), "max   (seconds)");
    row("start -> writing open", all("startToWrite")); row("write phase", all("write")); row("vote phase (a matchup)", all("vote")); row("reveal", all("reveal"));
    row("a person's idle between moves", all("idle")); row("comic answer after write began", all("comicAnswer")); row("comic vote after matchup opened", all("comicVote")); row("game, Start to over", all("game"));
  } finally { child.kill("SIGTERM"); }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
