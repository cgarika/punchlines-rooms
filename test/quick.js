/* Punchlines: Quick Play (Q1, 2026-11-01).  node test/quick.js   (its own server on TEST_PORT7, default 3571)
   Proves: one tap (the app's "quick" with its name and id) makes a room that finds people for 2.5 s, then the comics fill the
   empty seats to four and the game starts, with nothing to tap; two people who tap together are in one room, with two comics;
   a person who cancels takes the room with them; nothing is rated (no ladder for this game). */
"use strict";
const assert = require("assert");
const H = require("./helpers");
const SEATS = 4;
let passed = 0;
const ok = (m) => { passed++; console.log("  ok " + m); };
const quick = (c) => c.emit("quick", { name: c.nm, playerId: c.pid, avatar: "\u{1F3A4}", caps: ["waitList"] });

(async () => {
  const port = H.portOf("TEST_PORT7", 3571);
  console.log("quick play: a server of our own, the real 2.5 s (port " + port + ")");
  const srv = await H.server(port, {});
  try {
    {   // A: one person
      const a = H.client(port, "QA"); await H.wait(() => a.connected);
      const t0 = Date.now(); quick(a);
      assert.ok(await H.wait(() => a.st && a.st.quick, 2000), "no quick state");
      const q = a.st.quick; assert.ok(q.searching && q.seats === SEATS && q.fillAt - q.now > 1500 && q.fillAt - q.now <= 2600, JSON.stringify(q));
      assert.ok(await H.wait(() => a.st.status === "playing", 6000), "the game never started");
      const dt = Date.now() - t0;
      assert.ok(dt >= 2300 && dt < 3600, "started after " + dt + " ms");
      assert.strictEqual(a.st.players.length, SEATS); assert.strictEqual(a.st.players.filter((p) => p.bot).length, SEATS - 1);
      assert.ok(a.st.quick && a.st.quick.searching === false, "still searching: " + JSON.stringify(a.st.quick));
      assert.strictEqual(a.st.rankedOn, false, "a party game must not be rated");
      assert.ok(a.st.phase === "write" && a.st.yourPrompts.length === 2);
      ok(`one tap: a room, ${(q.fillAt - q.now) / 1000} s to find people, then ${SEATS - 1} comics and the game began ${dt} ms after the tap`);
      a.close();
    }
    {   // B: two people tap together
      const b1 = H.client(port, "QB1"), b2 = H.client(port, "QB2"); await H.wait(() => b1.connected && b2.connected);
      const t0 = Date.now(); quick(b1); await H.sleep(300); quick(b2);
      assert.ok(await H.wait(() => b1.code && b2.code, 3000)); assert.strictEqual(b1.code, b2.code, "two rooms");
      assert.ok(await H.wait(() => b1.st.status === "playing", 8000), "never started");
      assert.strictEqual(b1.st.players.filter((p) => !p.bot).length, 2); assert.strictEqual(b1.st.players.length, SEATS);
      ok(`two people who tap together share one room (${b1.code}); the game began ${Date.now() - t0} ms after the first tap with ${SEATS - 2} comics`);
      [b1, b2].forEach((c) => c.close());
    }
    {   // C: cancel
      const c = H.client(port, "QC"); await H.wait(() => c.connected);
      quick(c); assert.ok(await H.wait(() => c.st && c.st.quick, 2000));
      const code = c.code; c.emit("quickCancel"); await H.sleep(2800);
      const d = H.client(port, "QD"); await H.wait(() => d.connected);
      d.emit("join", { code, name: "QD", playerId: d.pid, avatar: "x" });
      assert.ok(await H.wait(() => d.errs.length, 2000), "the cancelled room still answers a join");
      ok("quickCancel takes the person, and the room, out; the room never starts a game");
      [c, d].forEach((x) => x.close());
    }
  } finally { srv.stop(); }
  console.log(`quick play: ${passed} passed`);
  process.exit(0);
})().catch((e) => { console.error("FAIL:", e && e.stack || e); process.exit(1); });
