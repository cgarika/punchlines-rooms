# Punchlines
Write-and-vote party game for 3-12 humans (no bots — bots aren't funny).
Each round: one prompt, everyone writes a secret answer (75s), then the room
votes on the anonymized, shuffled entries (45s) — you can't vote for your own
(server-enforced). Votes x100 points, authors revealed with tallies, 3 rounds,
podium. ~60 original prompts baked in; each game samples without repeats.
Auto-advances when everyone has submitted/voted; host can skip the reveal.

Run: npm install && node server.js  (PORT, ROUNDS, WRITE_MS, VOTE_MS, REVEAL_MS, BASE_PATH)
Deployed at needasix.com/punchlines behind the arcade proxy (BASE_PATH=/punchlines).

## The people (2026-11-04, the Prime-Time Show)
Every player picks who stands behind their podium from eight people the app draws: four men `m1`-`m4` and four women `f1`-`f4`.
- `create` and `join` (and Quick Play's `quick`) take `person`; the lobby event `person` ({ person: "m1" }) changes it. Anything that is not one of the eight is ignored, so an older app has `person: null` and nobody's is guessed. `features` lists `people` when the server knows them.
- The state carries `players[].person`: who that player WEARS at this table. No two at a table wear the same person while there are free ones: a pick that is worn gives the next free one of the same kind (a man's for a man, a woman's for a woman); once all four of a kind are worn, people repeat within the kind. Whoever picked first has it; a player bumped from their pick gets it back when it frees (in the lobby). Once a game starts nobody changes.
- Comics are dealt a free person (else a repeat) and the plain first name that goes with it (Max, Omar, Raj, Leo, Nora, Imani, Sofia, Layla; a repeat gets a plain reserve name of its kind, so no two seats share a name). A comic yields its person to a human who picks it in the lobby. The old cast (the tabby and the puppy) is gone; a comic still carries the microphone `avatar` and a `name`, which is all an older app needs to draw it.
- `test/people.js` proves it; `comics.js` holds the dealing rules (`dealHuman`, `dealComic`).
