/* Prints N random prompt / comic-answer pairs (every prompt of the game and of the Plus packs is a candidate), with the kind the
   prompt was read as, for a person to judge whether the answers fit.   node tools/sample_comics.js [N=30] */
"use strict";
const Comics = require("../comics");
const Packs = require("../packs");
const { PROMPTS } = require("../server.js");
const N = Number(process.argv[2] || 30);
const all = PROMPTS.concat(...Object.values(Packs.PACKS).map((p) => p.prompts));
const used = new Set();
const pick = all.slice().sort(() => Math.random() - 0.5).slice(0, N);
for (const p of pick) { const a = Comics.answer(p, used); console.log(`[${Comics.kindOf(p).padEnd(8)}] ${p.replace("___", "[" + a + "]")}`); }
process.exit(0);
