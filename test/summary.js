/* Punchlines: the match summary (PL1, 2026-11-01). node test/summary.js   (its own server on TEST_PORT4, default 3541)
   Proves: a game nobody voted in has no winner (no contest); the table, the winner and every score come from one summary
   (the players' scores and the summary's agree; the recap's votes add up); a tie is broken by round wins, then votes, then
   the earliest answer, and says why. */
"use strict";
const assert = require("assert");
const Summary = require("../summary");
const H = require("./helpers");

let passed = 0;
const ok = (name, fn) => { fn(); passed++; console.log("  ok " + name); };
const P = (...names) => names.map((n) => ({ name: n, avatar: "x" }));
const L = (round, seat, votes, at) => ({ round, seat, votes, pts: votes * 100, bonus: 0, at });

console.log("summary: the rules");
ok("no vote at all: no contest, no winner, a modest result", () => {
  const s = Summary.build({ players: P("Ava", "Bo", "Cy"), ledger: [L(1, 0, 0, 5000), L(1, 1, 0, 6000), L(2, 2, 0, 7000)], rounds: 3 });
  assert.strictEqual(s.contest, false); assert.strictEqual(s.winner, null); assert.deepStrictEqual(s.winners, []);
  assert.strictEqual(s.headline, "No laughs this round"); assert.ok(/nobody wins/i.test(s.reason));
  assert.ok(s.standings.every((r) => r.rank === null && r.won === false && r.score === 0));
});
ok("an empty ledger (nobody answered) is a no contest too", () => {
  assert.strictEqual(Summary.build({ players: P("Ava", "Bo"), ledger: [], rounds: 3 }).contest, false);
});
ok("the top of the table wins, and the reason says so", () => {
  const s = Summary.build({ players: P("Ava", "Bo", "Cy"), ledger: [L(1, 0, 2, 5000), L(1, 1, 1, 6000), L(2, 2, 1, 7000)], rounds: 3 });
  assert.strictEqual(s.contest, true); assert.strictEqual(s.winner, 0); assert.strictEqual(s.tiedOn, null);
  assert.deepStrictEqual(s.standings.map((r) => r.seat), [0, 2, 1]);   // Bo and Cy tie on 100: Cy won round 2, so Cy is second
  assert.deepStrictEqual(s.standings.map((r) => r.rank), [1, 2, 3]);
  assert.ok(/Most laughs: 200 points/.test(s.reason)); assert.ok(s.line.includes("Ava takes the crown with 200 points"));
  assert.strictEqual(s.totalVotes, 4);
});
ok("a tie on points goes to round wins, and says so", () => {
  // Ava: 3 votes in round 1 (300, one round won). Bo: 2 votes in round 2 and 1 in round 3 (300, two rounds won).
  const t = Summary.build({ players: P("Ava", "Bo", "Cy"), ledger: [L(1, 0, 3, 9000), L(2, 1, 2, 4000), L(3, 1, 1, 4000)], rounds: 3 });
  assert.deepStrictEqual(t.tied, [1, 0]);   // in rank order assert.strictEqual(t.tiedOn, "rounds"); assert.strictEqual(t.winner, 1);
  assert.ok(/Tied on 300 points\. Bo takes it on round wins, 2 to 1\./.test(t.reason), t.reason);
  assert.deepStrictEqual(t.standings.map((r) => [r.seat, r.rank, r.score, r.roundWins]), [[1, 1, 300, 2], [0, 2, 300, 1], [2, 3, 0, 0]]);
});
ok("then to votes when the round wins are level", () => {
  // equal points through different votes: a quiplash bonus makes 2 votes = 300 pts
  const a = { round: 1, seat: 0, votes: 2, pts: 300, bonus: 100, at: 9000 };
  const b = { round: 1, seat: 1, votes: 3, pts: 300, bonus: 0, at: 4000 };
  const s = Summary.build({ players: P("Ava", "Bo", "Cy"), ledger: [a, b], rounds: 3 });
  assert.strictEqual(s.tiedOn, "votes"); assert.strictEqual(s.winner, 1);
  assert.ok(/Tied on 300 points and 1 round win each\. Bo takes it on votes, 3 to 2\./.test(s.reason), s.reason);
});
ok("then to the earliest answer when the votes are level too", () => {
  const s = Summary.build({ players: P("Ava", "Bo", "Cy"), ledger: [L(1, 0, 2, 9000), L(1, 1, 2, 4000)], rounds: 3 });
  assert.strictEqual(s.tiedOn, "submission"); assert.strictEqual(s.winner, 1);
  assert.ok(/locking in the first answer sooner/.test(s.reason), s.reason);
});
ok("and the draw of the seats when nothing separates them", () => {
  const s = Summary.build({ players: P("Ava", "Bo", "Cy"), ledger: [L(1, 0, 2, 4000), L(1, 1, 2, 4000)], rounds: 3 });
  assert.strictEqual(s.tiedOn, "seat"); assert.strictEqual(s.winner, 0);
});
ok("a seat that left never wins, and is listed after the rest with no rank", () => {
  const players = P("Ava", "Bo", "Cy"); players[0].left = true;
  const s = Summary.build({ players, ledger: [L(1, 0, 5, 1000), L(1, 1, 1, 2000), L(1, 2, 0, 3000)], rounds: 3 });
  assert.strictEqual(s.winner, 1); assert.strictEqual(s.standings[s.standings.length - 1].seat, 0); assert.strictEqual(s.standings[s.standings.length - 1].rank, null);
});
ok("everyone else left: the last one seated wins by default, if anybody laughed", () => {
  const players = P("Ava", "Bo", "Cy"); players[1].left = players[2].left = true;
  const s = Summary.build({ players, ledger: [L(1, 1, 2, 1000), L(1, 0, 0, 2000)], rounds: 3, how: "left", last: 0 });
  assert.strictEqual(s.winner, 0); assert.strictEqual(s.forfeit, true);
  const none = Summary.build({ players, ledger: [], rounds: 3, how: "left", last: 0 });
  assert.strictEqual(none.contest, false); assert.strictEqual(none.winner, null);
});

(async () => {
  const port = H.portOf("TEST_PORT4", 3541);
  console.log("summary: whole games on a server of our own (port " + port + ")");
  const srv = await H.server(port, { ROUNDS: "2", WRITE_MS: "900", VOTE_MS: "500", REVEAL_MS: "150", AFK_GRACE_MS: "0" });
  try {
    // 1. a game nobody votes in
    {
      const cs = await H.lobby(port, 3, "N");
      cs[0].emit("start"); await H.wait(() => cs[0].st && cs[0].st.phase === "write", 3000);
      const played = setInterval(() => cs.forEach((c) => c.st && c.st.phase === "write" && H.playWrite(c)), 20);   // answers, and then nobody votes
      try {
        assert.ok(await H.wait(() => cs[0].st.status === "over", 20000), "the game never ended");
      } finally { clearInterval(played); }
      const st = cs[0].st, s = st.summary;
      assert.ok(s, "no summary in the final state");
      assert.strictEqual(s.contest, false); assert.strictEqual(st.winner, null); assert.strictEqual(s.winner, null);
      assert.strictEqual(s.headline, "No laughs this round"); assert.ok(!/crown/i.test(st.log), st.log);
      assert.ok(st.players.every((p) => p.score === 0), "scores should all be 0");
      assert.strictEqual(s.totalVotes, 0);
      passed++; console.log("  ok a game nobody voted in has no winner, a modest result and all-zero scores (log: " + JSON.stringify(st.log) + ")");
      cs.forEach((c) => c.close());
    }
    // 2. a game with votes: one summary, the same numbers everywhere
    {
      const cs = await H.lobby(port, 3, "V");
      cs[0].emit("start"); await H.wait(() => cs[0].st && cs[0].st.phase === "write", 3000);
      const played = setInterval(() => cs.forEach((c) => { if (!c.st) return; if (c.st.phase === "write") H.playWrite(c); else H.playVote(c, (es) => es.find((e) => !e.mine && /V0/.test(e.text)) || es.find((e) => !e.mine)); }), 20);
      try { assert.ok(await H.wait(() => cs[0].st.status === "over", 20000), "the game never ended"); } finally { clearInterval(played); }
      const st = cs[0].st, s = st.summary;
      assert.strictEqual(s.contest, true); assert.strictEqual(st.winner, s.winner); assert.ok(s.winner >= 0);
      assert.strictEqual(s.standings[0].seat, s.winner); assert.ok(s.standings[0].won && s.standings[0].rank === 1);
      for (const row of s.standings) assert.strictEqual(row.score, st.players[row.seat].score, "summary and player score disagree for " + row.name);
      const best = Math.max(...st.players.map((p) => p.score)); assert.strictEqual(st.players[s.winner].score, best);
      assert.strictEqual(s.totalVotes, s.standings.reduce((a, r) => a + r.votes, 0));
      assert.ok(s.standings.reduce((a, r) => a + r.score, 0) >= 100 * s.totalVotes, "points are 100 a vote, and a bonus on top");
      const lastRoundVotes = st.matchups.reduce((a, m) => a + m.entries.reduce((b, e) => b + e.votes, 0), 0);
      assert.ok(lastRoundVotes > 0 && lastRoundVotes <= s.totalVotes, "the recap's votes are part of the summary's");
      assert.ok(/takes the crown/.test(st.log) && st.log.includes(st.players[s.winner].name), st.log);
      passed++; console.log("  ok a game with votes: winner " + st.players[s.winner].name + " (" + st.players[s.winner].score + "), summary = scores = recap; reason: " + s.reason);
      cs.forEach((c) => c.close());
    }
  } finally { srv.stop(); }
  console.log(`summary: ${passed} passed`);
  process.exit(0);
})().catch((e) => { console.error("FAIL:", e && e.stack || e); process.exit(1); });
