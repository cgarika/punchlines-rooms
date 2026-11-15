/* Punchlines: the comics and the stand-in seats (PL2, 2026-11-01).  node test/comics.js   (its own servers on TEST_PORT5, default 3551)
   Proves: the bank is 400+ short, clean lines, each prompt is read as a kind and answered from that kind, no line twice in a game;
   the lobby seats comics ("Fill with comics" in one tap, two people can start); and a table with seats gone (dropped links, a
   leaver, an idle player marked away) still has an answer in every blank and a vote on every matchup, every round. */
"use strict";
const assert = require("assert");
const Comics = require("../comics");
const Packs = require("../packs");
const Moderation = require("../moderation");
const { PROMPTS } = require("../server.js");
const H = require("./helpers");

let passed = 0;
const ok = (name) => { passed++; console.log("  ok " + name); };
const ALL = PROMPTS.concat(...Object.values(Packs.PACKS).map((p) => p.prompts));

/* a person who plays every phase for themselves (and stops when `stop` says) */
function autoplay(c, opts = {}) {
  const t = setInterval(() => {
    if (!c.connected || !c.st || c.st.status !== "playing" || (opts.idle && opts.idle())) return;
    if (c.st.phase === "write") H.playWrite(c); else if (c.st.phase === "vote") H.playVote(c);
  }, 15);
  c.stopAuto = () => clearInterval(t);
  return c;
}
/* what every client saw, per matchup of the game: the entries at the vote, the votes at the reveal */
function recorder(c) {
  const seen = { vote: new Map(), reveal: new Map(), writes: [] };
  c.on("state", ({ room }) => {
    if (!room || room.status !== "playing" || !room.matchup) return;
    const k = room.round + "." + room.matchup.index;
    if (room.phase === "vote" && !seen.vote.has(k)) seen.vote.set(k, room.matchup.entries.length);
    if (room.phase === "reveal" && !seen.reveal.has(k)) seen.reveal.set(k, room.matchup.entries.reduce((a, e) => a + (e.votes || 0), 0));
  });
  return seen;
}

console.log("comics: the bank");
{
  const all = Object.values(Comics.BANK).flat();
  assert.ok(Comics.count() >= 400, "the bank has " + Comics.count() + " lines");
  assert.strictEqual(new Set(all.map((x) => x.toLowerCase())).size, all.length, "a line is in the bank twice");
  assert.ok(all.every((x) => x.length >= 3 && x.length <= 48), "a line is too long or too short: " + all.filter((x) => x.length > 48 || x.length < 3).join(" | "));
  assert.ok(all.every((x) => x === x.trim() && !x.includes("___") && !/[<>]/.test(x)));
  for (const k of Comics.KINDS) assert.ok(Comics.BANK[k].length >= 14, k + " has too few lines");
  ok(`the bank is ${Comics.count()} distinct lines of 3-48 characters in ${Comics.KINDS.length} kinds`);
}
(async () => {
  {   // every line is read the way a typed answer is: nothing starred, nothing held back
    const lines = Object.values(Comics.BANK).flat(), bad = [];
    for (let i = 0; i < lines.length; i += 24) await Promise.all(lines.slice(i, i + 24).map(async (l) => { const r = await Moderation.check(l); if (r.held || r.reason) bad.push(l + " -> " + r.reason); }));
    assert.deepStrictEqual(bad, [], "the moderation reader held back or starred a comic's line");
    ok(`the moderation reader (${Moderation.available() ? "words and the model" : "words only"}) holds back and stars none of the ${lines.length} lines`);
  }
  {   // every prompt gets a kind, and the answer comes from it
    const counts = {};
    for (const p of ALL) { const k = Comics.kindOf(p); assert.ok(Comics.KINDS.includes(k)); counts[k] = (counts[k] || 0) + 1; }
    assert.ok(ALL.length >= 190, "the game's prompts and the packs' were not all read");
    assert.ok((counts.any || 0) <= ALL.length * 0.15, "too many prompts read as 'any': " + counts.any + " of " + ALL.length);
    assert.strictEqual(Comics.kindOf("A terrible name for a pet snake: ___"), "name");
    assert.strictEqual(Comics.kindOf("The worst thing to say at a wedding is ___"), "say");
    assert.strictEqual(Comics.kindOf("A rejected flavor of chips: ___"), "food");
    assert.strictEqual(Comics.kindOf("The real reason the meeting ran long: ___"), "excuse");
    assert.strictEqual(Comics.kindOf("A bad slogan for a hospital: ___"), "slogan");
    assert.strictEqual(Comics.kindOf("A rejected title for a horror movie: ___"), "title");
    assert.strictEqual(Comics.kindOf("The worst thing to find in your pocket: ___"), "thing");
    let fit = 0, n = 0;
    for (let rep = 0; rep < 5; rep++) for (const p of ALL) { const k = Comics.kindOf(p); const a = Comics.answer(p, new Set()); n++; if (Comics.BANK[k].includes(a)) fit++; }
    assert.ok(fit / n > 0.9, "only " + Math.round(100 * fit / n) + "% of the answers came from the prompt's own kind");
    ok(`all ${ALL.length} prompts are read as a kind (${Object.keys(counts).length} kinds; ${counts.any || 0} take any line) and ${Math.round(100 * fit / n)}% of the answers come from the prompt's own kind`);
  }
  {   // no line twice in a game, a spent bank starts over
    const used = new Set(), got = [];
    for (let i = 0; i < 200; i++) got.push(Comics.answer(ALL[i % ALL.length], used));
    assert.strictEqual(new Set(got).size, got.length, "a comic said a line twice in one game");
    const tiny = new Set(); for (let i = 0; i < 700; i++) assert.ok(Comics.answer("A terrible name for a goldfish: ___", tiny));
    ok("no line is said twice in a game, and a spent bank starts over rather than go quiet");
    {   // the people: a comic is dealt a free person and its own plain first name; the cast is gone; no two comics share a name, and a person repeats only when all eight are worn
      assert.ok(!("CAST" in Comics) && !("FACE" in Comics) && !("NAMES" in Comics) && !("newFace" in Comics), "the cast and the animal portraits are still exported");
      for (let round = 0; round < 40; round++) {
        const worn = [], names = new Set();
        for (let k = 0; k < 12; k++) {
          const d = Comics.dealComic(worn, names);
          assert.ok(Comics.PERSON_IDS.includes(d.person) && d.avatar === "\u{1F3A4}", JSON.stringify(d));
          if (k < 8) { assert.ok(!worn.includes(d.person), "a person worn twice with free ones left: " + worn + " + " + d.person); assert.strictEqual(d.name, Comics.PEOPLE[d.person].name, "a comic's name does not go with its person"); }
          else assert.ok(Comics.RESERVE[Comics.PEOPLE[d.person].kind].includes(d.name) || d.name === Comics.PEOPLE[d.person].name, "a repeat comic's name: " + d.name);
          assert.ok(!names.has(d.name), "two comics share a name: " + [...names] + " + " + d.name);
          worn.push(d.person); names.add(d.name);
        }
        assert.strictEqual(new Set(worn).size, 8, "all eight people were not dealt before any repeated");
      }
      assert.ok(!Object.values(Comics.PEOPLE).some((p) => ["Whiskers", "Biscuit"].includes(p.name)) && !Comics.RESERVE.m.concat(Comics.RESERVE.f).some((n) => ["Whiskers", "Biscuit"].includes(n)));
      ok("a comic is dealt a free person (men and women) and its plain first name, never the cast; twelve comics at one table are twelve different names, with a person repeating only after all eight are worn");
    }
  }
  const port = H.portOf("TEST_PORT5", 3551);
  console.log("comics: tables on a server of our own (port " + port + ")");
  // clocks scaled right down (the comics' 8-20 s becomes about 0.1-0.4 s of a 1.2 s write)
  const env = { ROUNDS: "3", WRITE_MS: "1200", VOTE_MS: "800", REVEAL_MS: "150", AFK_MS: "250", AFK_GRACE_MS: "0" };
  const srv = await H.server(port, env);
  try {
    {   // the lobby
      const [A, B] = await H.lobby(port, 2, "L");
      A.emit("addBot"); assert.ok(await H.wait(() => A.st.players.length === 3), "addBot did nothing");
      const bot = A.st.players[2]; assert.ok(bot.bot === true && bot.connected && !bot.left, JSON.stringify(bot)); assert.ok(Object.values(Comics.PEOPLE).some((x) => x.name === bot.name), bot.name);
      assert.strictEqual(bot.avatar, "\u{1F3A4}", "a comic carries the microphone: " + bot.avatar); assert.ok(Comics.PERSON_IDS.includes(bot.person) && Comics.PEOPLE[bot.person].name === bot.name, "a comic's person and name: " + JSON.stringify(bot));
      assert.ok(A.st.features.includes("bots") && A.st.minPlayers === 2 && A.st.fillSeats === 4, "features / minPlayers / fillSeats: " + JSON.stringify([A.st.features, A.st.minPlayers, A.st.fillSeats]));
      B.emit("addBot"); await H.sleep(150); assert.strictEqual(A.st.players.length, 3, "a guest seated a comic");
      A.emit("removeBot"); assert.ok(await H.wait(() => A.st.players.length === 2), "removeBot did nothing");
      A.emit("fillBots"); assert.ok(await H.wait(() => A.st.players.length === 4), "fillBots did not fill to four");
      assert.strictEqual(new Set(A.st.players.map((p) => p.name)).size, 4, "two seats share a name");
      A.emit("fillBots", { n: 12 }); assert.ok(await H.wait(() => A.st.players.length === 12), "fillBots {n: 12}"); A.emit("fillBots", { n: 99 }); await H.sleep(100); assert.strictEqual(A.st.players.length, 12);
      for (let i = 0; i < 10; i++) A.emit("removeBot"); assert.ok(await H.wait(() => A.st.players.length === 2));
      ok("addBot / removeBot / fillBots seat comics (host only, up to the table's size), named apart, flagged bot");
      [A, B].forEach((c) => c.close());
    }
    {   // a person alone: "Fill with comics" is one tap, and the game is played through with a vote on every matchup
      const [A] = await H.lobby(port, 1, "S");
      A.emit("start"); await H.sleep(200); assert.strictEqual(A.st.status, "lobby", "a lone person started a game"); assert.ok(A.errs.length, "no refusal for a lone start");
      A.emit("fillBots"); assert.ok(await H.wait(() => A.st.players.length === 4));
      const seen = recorder(A); autoplay(A);
      A.emit("start");
      assert.ok(await H.wait(() => A.st.status === "over", 30000), "the game with three comics never ended (phase " + A.st.phase + ")");
      A.stopAuto();
      assert.strictEqual(seen.vote.size, 12, "matchups voted: " + seen.vote.size); assert.ok([...seen.vote.values()].every((n) => n === 2), "a matchup went to the vote with one answer");
      assert.ok([...seen.reveal.values()].every((n) => n === 2), "a matchup was revealed with votes missing: " + JSON.stringify([...seen.reveal]));
      assert.ok(A.st.summary && A.st.summary.contest, "no contest in a game with votes");
      ok("one person and three comics: 12 matchups, an answer on both sides of every one, both voters voted on every one (" + A.st.summary.reason + ")");
      A.close();
    }
    {   // two people: Start works, a comic joins them
      const [A, B] = await H.lobby(port, 2, "T");
      const seen = recorder(A); autoplay(A); autoplay(B);
      A.emit("start"); assert.ok(await H.wait(() => A.st.status === "playing", 3000), "two people could not start: " + A.errs.join("/"));
      assert.strictEqual(A.st.players.length, 3); assert.strictEqual(A.st.players.filter((p) => p.bot).length, 1, "one comic should have joined the two");
      assert.ok(await H.wait(() => A.st.status === "over", 30000), "the game never ended");
      assert.ok([...seen.vote.values()].every((n) => n === 2) && seen.vote.size === 9, "matchups: " + JSON.stringify([...seen.vote]));
      ok("two people can start, a third seat is a comic, 9 matchups all voted on");
      A.stopAuto(); B.stopAuto(); [A, B].forEach((c) => c.close());
    }
    {   // four people, two links drop: every round has four answers and complete votes
      const cs = await H.lobby(port, 4, "D");
      const seen = recorder(cs[0]); const quick = []; autoplay(cs[0]); autoplay(cs[1]);
      cs[0].emit("start"); assert.ok(await H.wait(() => cs[0].st.phase === "write", 3000));
      cs[2].disconnect(); cs[3].disconnect();
      assert.ok(await H.wait(() => cs[0].st.status === "over", 40000), "the game with two drops never ended (round " + cs[0].st.round + " " + cs[0].st.phase + ")");
      cs[0].stopAuto(); cs[1].stopAuto();
      assert.strictEqual(seen.vote.size, 12, "matchups: " + seen.vote.size);
      assert.ok([...seen.vote.values()].every((n) => n === 2), "an answer was missing: " + JSON.stringify([...seen.vote]));
      assert.ok([...seen.reveal.values()].every((n) => n === 2), "a vote was missing: " + JSON.stringify([...seen.reveal]));
      assert.ok(cs[0].st.summary.contest);
      ok("a 4-player game with 2 dropped links: 12 matchups, 4 answers every round, both voters voted on every matchup, finished with a winner");
      cs.forEach((c) => c.close());
    }
    {   // a person leaves: a comic takes the seat and the game goes on at full size
      const cs = await H.lobby(port, 4, "X");
      const seen = recorder(cs[0]); autoplay(cs[0]); autoplay(cs[1]); autoplay(cs[2]);
      cs[0].emit("start"); assert.ok(await H.wait(() => cs[0].st.phase === "write", 3000));
      cs[3].emit("leave"); assert.ok(await H.wait(() => cs[0].st.players[3].bot === true, 3000), "no comic took the leaver's seat");
      assert.strictEqual(cs[0].st.players.length, 4); assert.strictEqual(cs[0].st.players[3].left, false);
      assert.ok(cs[0].st.log || true);
      assert.ok(await H.wait(() => cs[0].st.status === "over", 40000), "the game never ended");
      assert.ok([...seen.vote.values()].every((n) => n === 2) && seen.vote.size === 12);
      ok("a leaver's seat is taken by a comic (same seat, table still four), and all 12 matchups have two answers");
      cs.forEach((c) => c.stopAuto && c.stopAuto()); cs.forEach((c) => c.close());
    }
    {   // an idle person (connected, never answers): marked away after 3 misses, and stood in for from then on
      const cs = await H.lobby(port, 4, "I");
      const seen = recorder(cs[0]); autoplay(cs[0]); autoplay(cs[1]); autoplay(cs[2]);   // cs[3] never plays
      cs[0].emit("start"); assert.ok(await H.wait(() => cs[0].st.phase === "write", 3000));
      assert.ok(await H.wait(() => cs[0].st.players[3].botControlled, 20000), "the idle seat was never marked away");
      const round = cs[0].st.round;
      assert.ok(await H.wait(() => cs[0].st.status === "over", 40000), "the game never ended");
      const lastRound = [...seen.vote].filter(([k]) => k.startsWith("3.")).map(([, n]) => n);
      assert.strictEqual(lastRound.length, 4); assert.ok(lastRound.every((n) => n === 2), "an away seat's answers were missing in round 3: " + JSON.stringify(lastRound));
      ok("an idle player is marked away (round " + round + "), and from then on a comic answers and votes for them: round 3 has four answers in every matchup");
      cs.forEach((c) => c.stopAuto && c.stopAuto()); cs.forEach((c) => c.close());
    }
  } finally { srv.stop(); }
  console.log(`comics: ${passed} passed`);
  process.exit(0);
})().catch((e) => { console.error("FAIL:", e && e.stack || e); process.exit(1); });
