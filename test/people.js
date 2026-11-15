/* Punchlines: the people (2026-11-04, the Prime-Time Show).  node test/people.js   (its own servers on TEST_PORT9, default 3591)
   Proves: every player carries a `person` (m1-m4, f1-f4, else null) from create and join and a lobby event changes it; no two at a table wear the same person while there
   are free ones (a pick that is worn gives the next free one of the same kind, a man's for a man and a woman's for a woman) and once all four of a kind are worn people repeat
   within the kind; a pick stays theirs (a player bumped from it gets it back when it frees); comics are dealt a free person and the name that goes with it, never the old cast,
   and yield their person to a human who picks it; an older app (no person) has none and everything still works; the waiting line and Quick Play take it too; and nobody's
   person changes once a game is under way. */
"use strict";
const assert = require("assert");
const Comics = require("../comics");
const H = require("./helpers");

let passed = 0;
const ok = (m) => { passed++; console.log("  ok " + m); };
const persons = (c) => c.st.players.map((p) => p.person);
const create = (c, person) => c.emit("create", { name: c.nm, playerId: c.pid, avatar: "\u{1F3A4}", person });
const join = (c, code, person) => c.emit("join", { code, name: c.nm, playerId: c.pid, avatar: "\u{1F3A4}", person });
/* a lobby of humans, in order, each with the pick named (undefined = an older app that sends none) */
async function table(port, picks, prefix) {
  const cs = picks.map((_, i) => H.client(port, prefix + i));
  await H.wait(() => cs.every((c) => c.connected), 4000);
  create(cs[0], picks[0]); assert.ok(await H.wait(() => cs[0].code, 3000), "no room");
  for (let i = 1; i < cs.length; i++) { join(cs[i], cs[0].code, picks[i]); assert.ok(await H.wait(() => cs[0].st && cs[0].st.players.length === i + 1, 3000), "player " + i + " did not sit"); }
  await H.sleep(60);
  return cs;
}

(async () => {
  const port = H.portOf("TEST_PORT9", 3591);
  console.log("people: tables on a server of our own (port " + port + ")");
  const srv = await H.server(port, { ROUNDS: "1", WRITE_MS: "1500", VOTE_MS: "800", REVEAL_MS: "200", AFK_MS: "250", AFK_GRACE_MS: "0" });
  try {
    {   // S1: the field on create and join; anything that is not one of the eight is null; an older app sends none
      const cs = await table(port, ["f3", "m2", undefined, "x9", 7, { a: 1 }, "M1", null], "S");
      assert.deepStrictEqual(persons(cs[0]), ["f3", "m2", null, null, null, null, null, null]);
      assert.ok(cs[0].st.features.includes("people"), "the server does not say it knows the people: " + cs[0].st.features);
      assert.ok(cs[0].st.players.every((p) => "person" in p), "a player without the field");
      ok("`person` rides every player: f3 and m2 as sent, null for an older app's none and for anything that is not m1-m4 or f1-f4; features say `people`");
      cs.forEach((c) => c.close());
    }
    {   // S2: a pick that is worn gives the next free person of its kind (round from the pick); people repeat only within a kind, once all four are worn
      const men = await table(port, ["m1", "m1", "m1", "m1", "m1"], "M");
      assert.deepStrictEqual(persons(men[0]), ["m1", "m2", "m3", "m4", "m1"], "five men who all picked m1: " + persons(men[0]));
      const women = await table(port, ["f1", "f1", "f1", "f1", "f1", "f1"], "W");
      assert.deepStrictEqual(persons(women[0]), ["f1", "f2", "f3", "f4", "f1", "f2"], "six women who all picked f1: " + persons(women[0]));
      const wrap = await table(port, ["m4", "m4", "f4", "f4", "f2"], "R");
      assert.deepStrictEqual(persons(wrap[0]), ["m4", "m1", "f4", "f1", "f2"], "wrapping round the kind, never across it: " + persons(wrap[0]));
      for (const c of wrap) assert.ok(c.st.players.every((p) => p.person && p.person[0] === (["m4", "m1"].includes(p.person) ? "m" : "f")));
      ok("a taken pick yields the next free one of its kind (m4 then m1; f4 then f1), a fifth man and a fifth and sixth woman repeat within their kind, and a man never wears a woman's");
      [...men, ...women, ...wrap].forEach((c) => c.close());
    }
    {   // a pick stays theirs: bumped when it is worn, back when it frees; the lobby event changes it at once
      const [A, B, C] = await table(port, ["f1", "f1", "m1"], "P");
      assert.deepStrictEqual(persons(A), ["f1", "f2", "m1"]);
      A.emit("leave"); assert.ok(await H.wait(() => B.st && B.st.players.length === 2, 3000));
      assert.deepStrictEqual(persons(B), ["f1", "m1"], "B was not given their own pick back when A left: " + persons(B));
      B.emit("person", { person: "f4" }); assert.ok(await H.wait(() => persons(B)[0] === "f4", 3000), "the lobby event did not change B");
      C.emit("person", { person: "f1" }); assert.ok(await H.wait(() => persons(B)[1] === "f1", 3000), "a man may pick a woman's person (nobody's kind is guessed): " + persons(B));
      C.emit("person", { person: "m3" }); assert.ok(await H.wait(() => persons(B)[1] === "m3", 3000));
      C.emit("person", { person: "nobody" }); C.emit("person", {}); C.emit("person", { person: 3 }); await H.sleep(150); assert.strictEqual(persons(B)[1], "m3", "a bad value changed someone's person");
      B.emit("person", { person: "m3" }); assert.ok(await H.wait(() => persons(B)[0] === "m4", 3000), "a pick worn by someone else gives the next free person of the pick's kind: " + persons(B));
      ok("a player bumped from their pick gets it back when it frees (A leaves, B is f1); the lobby `person` event changes a pick at once, a bad value changes nothing");
      [B, C].forEach((c) => c.close());
    }
    {   // S3: comics are dealt a free person and its name, never the cast; they yield a person to a human who picks it; 12 at one table are 12 names
      const [A] = await table(port, ["m1"], "C");
      A.emit("addBot"); A.emit("addBot"); A.emit("addBot");
      assert.ok(await H.wait(() => A.st.players.length === 4, 3000));
      const cm = A.st.players.slice(1);
      for (const b of cm) { assert.ok(b.bot && Comics.PERSON_IDS.includes(b.person) && b.person !== "m1", JSON.stringify(b)); assert.strictEqual(b.name, Comics.PEOPLE[b.person].name, "a comic's name does not go with its person"); assert.strictEqual(b.avatar, "\u{1F3A4}"); }
      assert.strictEqual(new Set(persons(A)).size, 4, "a person was worn twice with free ones left: " + persons(A));
      assert.ok(!A.st.players.some((p) => ["Whiskers", "Biscuit"].includes(p.name)), "the cast is back");
      // a human sits and picks a person a comic wears: the human gets it, the comic is dealt another free one and its name follows
      const taken = cm[0].person, B = H.client(port, "Cj"); await H.wait(() => B.connected);
      join(B, A.code, taken); assert.ok(await H.wait(() => A.st.players.length === 5, 3000));
      assert.strictEqual(A.st.players[4].person, taken, "the human did not get the person they picked from a comic: " + persons(A));
      assert.ok(A.st.players[1].person !== taken && Comics.PERSON_IDS.includes(A.st.players[1].person) && A.st.players[1].name === Comics.PEOPLE[A.st.players[1].person].name, "the comic was not dealt another person and its name: " + JSON.stringify(A.st.players[1]));
      assert.strictEqual(new Set(persons(A)).size, 5); assert.strictEqual(new Set(A.st.players.map((p) => p.name)).size, 5);
      A.emit("fillBots", { n: 12 }); assert.ok(await H.wait(() => A.st.players.length === 12, 3000));
      const all = A.st.players, counts = {}; for (const p of all) counts[p.person] = (counts[p.person] || 0) + 1;
      assert.ok(all.every((p) => p.person), "someone has no person at a table of twelve: " + persons(A));
      assert.strictEqual(Object.keys(counts).length, 8, "not all eight people on stage at twelve seats: " + JSON.stringify(counts)); assert.ok(Object.values(counts).every((n) => n <= 2), "a person worn three times: " + JSON.stringify(counts));
      assert.strictEqual(new Set(all.map((p) => p.name)).size, 12, "two seats share a name at twelve: " + all.map((p) => p.name));
      for (const p of all.filter((q) => q.bot)) assert.ok(!Comics.PEOPLE[p.person] || p.name === Comics.PEOPLE[p.person].name || Comics.RESERVE[Comics.PEOPLE[p.person].kind].includes(p.name), "a comic's name does not fit its person: " + JSON.stringify(p));
      ok("comics are dealt free people and their own names (never Whiskers or Biscuit); one yields its person to a human who picks it; twelve seats show all eight people at most twice each and twelve different names");
      [A, B].forEach((c) => c.close());
    }
    {   // an older app: no person anywhere, and a comic still has a face (its sticker) and a name
      const [A, B] = await table(port, [undefined, undefined], "O");
      A.emit("addBot"); assert.ok(await H.wait(() => A.st.players.length === 3, 3000));
      assert.deepStrictEqual(persons(A).slice(0, 2), [null, null]);
      const bot = A.st.players[2]; assert.ok(bot.bot && bot.name && bot.avatar === "\u{1F3A4}", JSON.stringify(bot));
      ok("an older app (no person) has none; its comic still has a name and a face (the microphone sticker)");
      [A, B].forEach((c) => c.close());
    }
    {   // nobody changes once the game is under way; the lobby event is for the lobby; the waiting line gets a person; the leaver's comic is a new person
      const [A, B, C] = await table(port, ["f2", "m3", "f2"], "G");
      A.emit("start"); assert.ok(await H.wait(() => A.st.status === "playing", 3000), "no game");
      const before = persons(A); assert.ok(before.every((x) => x), "a seat without a person at the start: " + before);
      B.emit("person", { person: "m1" }); await H.sleep(150); assert.deepStrictEqual(persons(A), before, "the lobby event changed a person in the middle of a game");
      const D = H.client(port, "Gw"); await H.wait(() => D.connected);
      D.emit("join", { code: A.code, name: D.nm, playerId: D.pid, avatar: "\u{1F3A4}", caps: ["waitList"], person: "f2" });
      assert.ok(await H.wait(() => D.code, 3000));
      C.emit("leave");   // the first in line takes the seat at once and is dealt a person (f2 is worn by A, so the next free woman)
      assert.ok(await H.wait(() => A.st.players.some((p) => p.name === D.nm && !p.left), 3000), "the waiting player did not take the seat");
      const seatD = A.st.players.find((p) => p.name === D.nm);
      assert.ok(seatD.person && seatD.person[0] === "f" && seatD.person !== "f2", "the newcomer from the line wears " + seatD.person + " (f2 is worn by A)");
      const during = persons(A);
      assert.ok(await H.wait(() => A.st.status === "over", 40000), "the game never ended");
      for (const [i, x] of before.entries()) if (i !== 2) assert.strictEqual(A.st.players[i].person, x, "seat " + i + " changed person during the game");
      ok("a seat's person never changes during a game (the lobby event is ignored once it starts); a player from the waiting line is dealt a person (the next free woman)");
      [A, B, C, D].forEach((c) => c.close());
    }
    {   // Quick Play carries the pick through to the room it makes, and its comics are dealt people
      const q = H.client(port, "Q"); await H.wait(() => q.connected);
      q.emit("quick", { name: q.nm, playerId: q.pid, avatar: "\u{1F3A4}", caps: ["waitList"], person: "f2" });
      assert.ok(await H.wait(() => q.st && q.st.status === "playing", 8000), "quick play never started");
      assert.strictEqual(q.st.players[0].person, "f2", "the pick was lost on the way through Quick Play: " + persons(q));
      assert.ok(q.st.players.slice(1).every((p) => p.bot && Comics.PERSON_IDS.includes(p.person)), "a quick comic without a person: " + JSON.stringify(q.st.players));
      assert.strictEqual(new Set(persons(q)).size, 4);
      ok("Quick Play keeps the pick (f2) and deals its three comics three other people");
      q.close();
    }
  } finally { srv.stop(); }
  console.log(`people: ${passed} passed`);
  process.exit(0);
})().catch((e) => { console.error("FAIL:", e && e.stack || e); process.exit(1); });
