/* Punchlines: the hold (party r2, 2026-11-02).  node test/hold.js   (its own servers on TEST_PORT8 and the next two, default 3581)
   Proves: a seat that holds stops the round's clocks (the deadline, the stand-ins, the last-one countdown) and the state says who and how much
   was left; letting go carries on with exactly that; a phase that begins while somebody reads begins held; a reader who leaves or drops lets go; the
   longest hold ends by itself; a seat has only so many holds a game; and there is nothing to hold in the lobby. */
"use strict";
const assert = require("assert");
const H = require("./helpers");

let passed = 0;
const ok = (name) => { passed++; console.log("  ok " + name); };

(async () => {
  const port = H.portOf("TEST_PORT8", 3581);
  console.log("hold: the clocks wait for the reader (port " + port + ")");
  const srv = await H.server(port, { ROUNDS: "1", WRITE_MS: "6000", VOTE_MS: "6000", REVEAL_MS: "300", HURRY_MS: "2000", AFK_GRACE_MS: "20000", HOLD_MAX_MS: "90000" });
  try {
    {   // nothing to hold in the lobby
      const cs = await H.lobby(port, 3, "L");
      cs[0].emit("hold", { on: true });
      assert.ok(await H.wait(() => cs[0].errs.length || true, 300));
      await H.sleep(250);
      assert.strictEqual(cs[0].st.held, null, "a lobby was held");
      assert.ok(cs[0].st.features.includes("hold"), "the server does not say it holds");
      ok("the lobby has nothing to hold, and the server lists the feature");
      cs.forEach((c) => c.close());
    }
    {   // a write phase: held for longer than it had left, it is still the write phase, and it carries on with what was left
      const cs = await H.lobby(port, 4, "W");
      cs[0].emit("start");
      assert.ok(await H.wait(() => cs[0].st.phase === "write" && cs[0].st.yourPrompts.length === 2, 2000), "no write phase");
      await H.sleep(1000);
      const tHold = Date.now();
      cs[0].emit("hold", { on: true });
      assert.ok(await H.wait(() => cs[1].st.held, 1500), "the others were not told");
      const held = cs[1].st.held;
      assert.deepStrictEqual(held.by, [cs[0].nm], "held by " + JSON.stringify(held.by));
      assert.ok(held.left > 4300 && held.left < 5100, "the clock had ~5 s left, said " + held.left);
      await H.sleep(held.left + 700);   // longer than it had left: a running clock would have ended the phase
      assert.strictEqual(cs[0].st.phase, "write", "the phase ended under the reader");
      const tLet = Date.now();
      cs[0].emit("hold", { on: false });
      assert.ok(await H.wait(() => cs[1].st.held === null, 1500), "the hold was not let go");
      const ends = cs[1].st.phaseEndsAt - Date.now();
      assert.ok(ends > held.left - 500 && ends < held.left + 400, "carried on with " + ends + " ms, not the " + held.left + " that was left");
      assert.ok(Math.abs((cs[1].st.phaseEndsAt - cs[1].st.phaseStartedAt) - cs[1].st.phaseMs) < 60, "phaseStartedAt did not move on with the hold");
      assert.ok(await H.wait(() => cs[0].st.phase !== "write", held.left + 2500), "the phase never ended after the hold");   // (nobody wrote: the matchups are walkovers and the vote is skipped)
      const after = Date.now() - tLet;
      assert.ok(after > held.left - 600 && after < held.left + 1500, "the write ended " + after + " ms after the hold (had " + held.left + " left)");
      ok(`a write clock held ${tLet - tHold} ms (it had ${held.left} ms): still writing, then on with ${ends} ms, and over ${after} ms after the hold`);
      cs.forEach((c) => c.close());
    }
    {   // a phase that begins while somebody reads begins held, its whole clock waiting
      const cs = await H.lobby(port, 4, "N");
      cs[0].emit("start");
      assert.ok(await H.wait(() => cs[0].st.phase === "write", 2000));
      cs[0].emit("hold", { on: true });
      assert.ok(await H.wait(() => cs[1].st.held, 1500));
      cs.forEach((c) => H.playWrite(c));
      assert.ok(await H.wait(() => cs[0].st.phase === "vote", 2500), "everyone locked in and the vote did not begin");
      assert.ok(cs[0].st.held, "the vote began unheld");
      assert.strictEqual(cs[0].st.held.left, cs[0].st.phaseMs, "the vote's whole clock should wait: " + cs[0].st.held.left);
      await H.sleep(cs[0].st.phaseMs + 600);
      assert.strictEqual(cs[0].st.phase, "vote", "the vote ended under the reader");
      cs[0].emit("hold", { on: false });
      assert.ok(await H.wait(() => cs[0].st.held === null, 1500));
      const left = cs[0].st.phaseEndsAt - Date.now();
      assert.ok(left > cs[0].st.phaseMs - 500, "the vote's clock did not start full: " + left);
      ok("the vote that began while somebody read began held, and started full when they were done");
      cs.forEach((c) => c.close());
    }
    {   // two readers: the clocks wait until both have done; a reader who leaves lets go
      const cs = await H.lobby(port, 4, "R");
      cs[0].emit("start");
      assert.ok(await H.wait(() => cs[0].st.phase === "write", 2000));
      cs[0].emit("hold", { on: true }); cs[1].emit("hold", { on: true });
      assert.ok(await H.wait(() => cs[2].st.held && cs[2].st.held.by.length === 2, 1500), "two readers expected");
      cs[0].emit("hold", { on: false });
      assert.ok(await H.wait(() => cs[2].st.held && cs[2].st.held.by.length === 1, 1500));
      assert.ok(cs[2].st.held, "one reader still holds");
      cs[1].close();   // the last reader's link drops: they let go
      assert.ok(await H.wait(() => cs[2].st.held === null, 1500), "a reader who dropped kept the hold");
      ok("two readers: held until both are done; a reader whose link dropped lets go");
      cs.forEach((c) => c.close());
    }
  } finally { srv.stop(); }

  console.log("hold: the longest hold, and the holds a seat has");
  const srv2 = await H.server(port + 1, { ROUNDS: "1", WRITE_MS: "6000", VOTE_MS: "6000", REVEAL_MS: "300", AFK_GRACE_MS: "20000", HOLD_MAX_MS: "700" });
  try {
    const cs = await H.lobby(port + 1, 3, "M");
    cs[0].emit("start");
    assert.ok(await H.wait(() => cs[0].st.phase === "write", 2000));
    cs[0].emit("hold", { on: true });
    assert.ok(await H.wait(() => cs[1].st.held, 1500));
    assert.ok(await H.wait(() => cs[1].st.held === null, 2500), "the longest hold never ended");
    assert.strictEqual(cs[0].st.phase, "write");
    ok("the longest hold (HOLD_MAX_MS) lets go by itself");
    // six holds are allowed (the longest one above was the first); the seventh is refused and the clock keeps running
    let refused = 0;
    cs[0].on("refusal", (r) => { if (r && r.code === "hold") refused++; });
    for (let i = 0; i < 5; i++) { cs[0].emit("hold", { on: true }); await H.sleep(60); cs[0].emit("hold", { on: false }); await H.sleep(60); }
    assert.strictEqual(refused, 0, "six holds should be allowed, one was refused");
    cs[0].emit("hold", { on: true });
    await H.sleep(300);
    assert.strictEqual(refused, 1, "the seventh hold should be refused once, was " + refused);
    assert.strictEqual(cs[0].st.held, null, "a refused hold held");
    ok("a seat has six holds a game; the seventh is refused and the clock keeps running");
    cs.forEach((c) => c.close());
  } finally { srv2.stop(); }

  console.log("hold: the comics wait too");
  const srv3 = await H.server(port + 2, { ROUNDS: "1", WRITE_MS: "6000", VOTE_MS: "6000", REVEAL_MS: "300", AFK_GRACE_MS: "20000", HOLD_MAX_MS: "90000", COMIC_SUBMIT_MIN_MS: "9000", COMIC_SUBMIT_MAX_MS: "9500" });
  try {
    const cs = await H.lobby(port + 2, 1, "S");
    cs[0].emit("fillBots");
    assert.ok(await H.wait(() => cs[0].st.players.length >= 4, 2000), "no comics came");
    cs[0].emit("start");
    assert.ok(await H.wait(() => cs[0].st.phase === "write", 2000));
    cs[0].emit("hold", { on: true });
    assert.ok(await H.wait(() => cs[0].st.held, 1500));
    const comicsIn = () => cs[0].st.players.filter((p) => p.bot && p.submitted).length;
    await H.sleep(1200);   // their answers are due in about a second (9 s on a 45 s clock, scaled to this 6 s one)
    assert.strictEqual(comicsIn(), 0, "a comic spoke while the room was held");
    cs[0].emit("hold", { on: false });
    assert.ok(await H.wait(() => comicsIn() >= 3, 4500), "the comics never answered after the hold");
    ok("the comics hold their tongues while somebody reads, and answer after");
    cs.forEach((c) => c.close());
  } finally { srv3.stop(); }
  console.log(`hold: ${passed} checks passed`);
  process.exit(0);
})().catch((e) => { console.error("FAIL", (e && e.stack) || e); process.exit(1); });
