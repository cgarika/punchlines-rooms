/* Punchlines: the pacing (PL3, 2026-11-01).  node test/pacing.js   (its own servers on TEST_PORT6 and the next, default 3561)
   Proves: the clocks (about 45 s to write and 25 s to vote for 4 players, scaled by the number of players); writing is open the
   moment Start lands; the round moves on the moment the last person locks in; once all but one of the people have locked in
   the last one has a 10 s countdown (HURRY_MS here is shorter), in the vote as in the write, and never a lone person with comics. */
"use strict";
const assert = require("assert");
const H = require("./helpers");

let passed = 0;
const ok = (name) => { passed++; console.log("  ok " + name); };

(async () => {
  const port = H.portOf("TEST_PORT6", 3561);
  console.log("pacing: the clocks, on a server with the real ones (port " + port + ")");
  const real = await H.server(port, {});
  try {
    const want = { 3: [42000, 23500], 4: [45000, 25000], 5: [48000, 26500], 6: [51000, 28000], 8: [57000, 31000], 12: [69000, 37000] };
    for (const n of Object.keys(want).map(Number)) {
      const cs = await H.lobby(port, n, "C" + n + "_");
      const t0 = Date.now();
      cs[0].emit("start");
      assert.ok(await H.wait(() => cs[0].st.phase === "write" && cs[0].st.yourPrompts.length === 2, 2000), "no prompts 2 s after Start");
      const typingAt = Date.now() - t0;
      const w = cs[0].st;
      assert.strictEqual(w.phaseMs, want[n][0], `${n} players: write clock ${w.phaseMs}`);
      assert.ok(Math.abs((w.phaseEndsAt - w.phaseStartedAt) - w.phaseMs) < 5, "phaseEndsAt, phaseStartedAt and phaseMs disagree");
      cs.forEach((c) => H.playWrite(c));
      assert.ok(await H.wait(() => cs[0].st.phase === "vote", 3000), `${n} players: the vote never began`);
      assert.strictEqual(cs[0].st.phaseMs, want[n][1], `${n} players: vote clock ${cs[0].st.phaseMs}`);
      if (n === 4) ok(`writing is open ${typingAt} ms after Start (prompts in hand)`);
      if (n === 3) {   // the reveal lasts as long as the app's moment: 6 s with no vote, a third of a second more for each
        assert.ok(await H.wait(() => cs.some((c) => c.st.matchup && c.st.matchup.canVote), 2000)); cs.forEach((c) => H.playVote(c));
        assert.ok(await H.wait(() => cs[0].st.phase === "reveal", 3000), "no reveal");
        assert.strictEqual(cs[0].st.phaseMs, 6500, "reveal clock " + cs[0].st.phaseMs);
        ok("the reveal clock: 6.5 s for a matchup with one vote (it was 12 s)");
      }
      cs.forEach((c) => c.close());
    }
    ok("the clocks: 4 players 45 s to write and 25 s to vote; 3: 42 s / 23.5 s; 6: 51 s / 28 s; 12: 69 s / 37 s");
  } finally { real.stop(); }

  console.log("pacing: the countdown, with short clocks");
  const srv = await H.server(port + 1, { ROUNDS: "2", WRITE_MS: "6000", VOTE_MS: "6000", REVEAL_MS: "200", HURRY_MS: "700", AFK_GRACE_MS: "20000" });
  try {
    {   // the write: three of four people lock in; the last has HURRY_MS, and the phase moves on when it is up
      const cs = await H.lobby(port + 1, 4, "W");
      cs[0].emit("start"); assert.ok(await H.wait(() => cs[0].st.phase === "write", 3000));
      for (const c of cs.slice(0, 3)) H.playWrite(c);
      assert.ok(await H.wait(() => cs[0].st.hurry, 2000), "no countdown after three of four were in");
      const h = cs[0].st.hurry, t1 = Date.now();
      assert.strictEqual(h.seat, cs[3].seat); assert.ok(h.endsAt - t1 <= 700 && h.endsAt - t1 > 300, "countdown " + (h.endsAt - t1)); assert.strictEqual(cs[0].st.phaseEndsAt, h.endsAt);
      assert.ok(cs[0].st.phaseEndsAt - cs[0].st.phaseStartedAt < 6000, "the clock was not shortened");
      assert.ok(await H.wait(() => cs[0].st.phase === "vote", 2000), "the phase did not move on when the countdown ran out");
      const waited = Date.now() - t1; assert.ok(waited >= 400 && waited < 1300, "moved on after " + waited);
      ok(`write: three of four in -> the last one gets ${h.endsAt - t1} ms, and the phase moves on when it is up (${waited} ms later)`);
      cs.forEach((c) => c.close());
    }
    {   // the last one beats the countdown: on at once
      const cs = await H.lobby(port + 1, 4, "Q");
      cs[0].emit("start"); assert.ok(await H.wait(() => cs[0].st.phase === "write", 3000));
      for (const c of cs.slice(0, 3)) H.playWrite(c);
      assert.ok(await H.wait(() => cs[0].st.hurry, 2000));
      const t = Date.now(); H.playWrite(cs[3]);
      assert.ok(await H.wait(() => cs[0].st.phase === "vote", 2000), "did not move on when the last one locked in");
      const dt = Date.now() - t; assert.ok(dt < 250, "moved on after " + dt + " ms");
      ok(`the moment the last one locks in the round moves on (${dt} ms)`);
      // the vote of this matchup: two voters, one votes -> the other has the countdown
      const canVote = () => cs.filter((c) => c.st.phase === "vote" && c.st.matchup && c.st.matchup.canVote);
      assert.ok(await H.wait(() => canVote().length === 2, 2000), "two voters expected, saw " + canVote().length);
      const voters = canVote();
      assert.ok(!cs[0].st.hurry, "a countdown carried into the vote");
      H.playVote(voters[0]);
      assert.ok(await H.wait(() => cs[0].st.hurry && cs[0].st.hurry.seat === voters[1].seat, 2000), "no countdown for the last voter");
      const t2 = Date.now(); assert.ok(await H.wait(() => cs[0].st.phase === "reveal", 2000), "the vote did not end when the countdown did");
      ok(`vote: one of two voters in -> the other has the countdown, then the reveal (${Date.now() - t2} ms)`);
      cs.forEach((c) => c.close());
    }
    {   // a person with comics is never hurried; the phase ends when the comics are in
      const [A] = await H.lobby(port + 1, 1, "S");
      A.emit("fillBots"); await H.wait(() => A.st.players.length === 4);
      A.emit("start"); assert.ok(await H.wait(() => A.st.phase === "write", 3000));
      // the comics are in within 2.7 s (their 8-20 s scaled to this 6 s clock); the person is the only one left
      assert.ok(await H.wait(() => A.st.players.filter((p) => p.bot).every((p) => p.submitted), 4500), "the comics have not answered");
      await H.sleep(300);
      assert.strictEqual(A.st.hurry, null, "a lone person was hurried");
      const t = Date.now(); H.playWrite(A);
      assert.ok(await H.wait(() => A.st.phase === "vote", 2000)); const dt = Date.now() - t; assert.ok(dt < 250, "moved on after " + dt);
      ok("one person and three comics: the person is never hurried, and the round moves on the moment they lock in (" + dt + " ms)");
      A.close();
    }
  } finally { srv.stop(); }
  console.log(`pacing: ${passed} passed`);
  process.exit(0);
})().catch((e) => { console.error("FAIL:", e && e.stack || e); process.exit(1); });
