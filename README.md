# Punchlines
Write-and-vote party game for 3-12 humans (no bots — bots aren't funny).
Each round: one prompt, everyone writes a secret answer (75s), then the room
votes on the anonymized, shuffled entries (45s) — you can't vote for your own
(server-enforced). Votes x100 points, authors revealed with tallies, 3 rounds,
podium. ~60 original prompts baked in; each game samples without repeats.
Auto-advances when everyone has submitted/voted; host can skip the reveal.

Run: npm install && node server.js  (PORT, ROUNDS, WRITE_MS, VOTE_MS, REVEAL_MS, BASE_PATH)
Deployed at needasix.com/punchlines behind the arcade proxy (BASE_PATH=/punchlines).
