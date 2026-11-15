/* The match summary (2026-11-01): the one object every Punchlines result panel reads (the podium, the scores, the
   "Last round's jokes" recap, the reward and the banner), so the points and the votes cannot disagree from one screen to the
   next, and a game nobody laughed at cannot crown anybody.

   It is worked out once, when the game ends, from the ledger the room keeps (one line per answer that went to the vote):
     { round, seat, votes, pts, bonus, at }   at = ms from the start of that round's writing to the answer being locked in.

   NO CONTEST. A game with no vote cast in it, from the first round to the last, has no winner: no win, no XP, no coins,
   no podium and no confetti, and its result says so ("No laughs this round").
   THE WINNER is the top of the table by points. A tie is broken, in this order, by
     1. round wins    (a round is won by the best points in that round; a round tied at the top is a win for each)
     2. votes         (all the votes the player's answers got)
     3. the earliest answer (the quickest answer the player locked in, from the start of its round)
   and the reason is printed ("Tied on 300 points. Mia takes it on round wins, 2 to 1."). A tie nothing can break (the same
   at all three) goes to the lower seat, and the reason says it was the draw of the seats. */
"use strict";

const plural = (n, one, many) => `${n} ${n === 1 ? one : many || one + "s"}`;

/* players: [{ name, avatar, bot, left }] by seat.  ledger: see above.  how: "played" (the rounds were all played) or "left"
   (everyone else left; the one still seated, `last`, wins by default if anybody laughed at all). */
function build({ players, ledger, rounds, how = "played", last = null }) {
  const n = players.length;
  const rows = players.map((p, seat) => ({ seat, name: p.name, avatar: p.avatar, bot: !!p.bot, left: !!p.left, score: 0, votes: 0, roundWins: 0, firstMs: Infinity }));
  const perRound = new Map();   // round -> [pts per seat]
  for (const e of ledger) {
    const r = rows[e.seat];
    if (!r) continue;
    r.score += e.pts || 0;
    r.votes += e.votes || 0;
    if (Number.isFinite(e.at) && e.at < r.firstMs) r.firstMs = e.at;
    if (!perRound.has(e.round)) perRound.set(e.round, new Array(n).fill(0));
    perRound.get(e.round)[e.seat] += e.pts || 0;
  }
  const roundList = [];
  for (const [round, pts] of [...perRound.entries()].sort((a, b) => a[0] - b[0])) {
    const best = Math.max(0, ...pts.filter((_, s) => !rows[s].left));
    const winners = best > 0 ? pts.map((v, s) => (v === best && !rows[s].left ? s : -1)).filter((s) => s >= 0) : [];
    for (const s of winners) rows[s].roundWins++;
    roundList.push({ round, best, winners });
  }
  const totalVotes = rows.reduce((a, r) => a + r.votes, 0);
  const seated = rows.filter((r) => !r.left);
  const order = (a, b) => b.score - a.score || b.roundWins - a.roundWins || b.votes - a.votes || a.firstMs - b.firstMs || a.seat - b.seat;
  const ranked = seated.slice().sort(order);

  const out = {
    contest: totalVotes > 0 && seated.length > 0, winner: null, winners: [], tiedOn: null, tied: [], forfeit: false,
    headline: "", reason: "", line: "",
    totalVotes, rounds: rounds || roundList.length, roundWins: roundList,
    standings: [],
  };
  if (!out.contest) {
    out.headline = "No laughs this round";
    out.reason = how === "left" ? "Everyone left before anybody got a laugh, so nobody wins." : "Nobody got a single vote, so nobody wins, and nothing is won.";
    out.line = how === "left" ? "Everyone left before the first laugh — no contest." : "No laughs this round — nobody got a vote, so there is no winner.";
  } else if (how === "left" && last != null && rows[last] && !rows[last].left) {
    out.winner = last; out.winners = [last]; out.forfeit = true;
    out.headline = `${rows[last].name} takes the crown`;
    out.reason = "Everyone else left, so the last one at the table wins.";
    out.line = `${rows[last].name} wins — everyone else left. 🏆`;
  } else {
    const top = ranked[0], rest = ranked.slice(1);
    out.winner = top.seat; out.winners = [top.seat];
    const tieGroup = ranked.filter((r) => r.score === top.score);
    out.tied = tieGroup.length > 1 ? tieGroup.map((r) => r.seat) : [];
    out.headline = `${top.name} takes the crown`;
    if (tieGroup.length < 2) {
      out.reason = `Most laughs: ${plural(top.score, "point")}.`;
      out.line = `${top.name} takes the crown with ${plural(top.score, "point")}! 🏆`;
    } else {
      const second = tieGroup[1];
      const pts = plural(top.score, "point");
      if (top.roundWins !== second.roundWins) {
        out.tiedOn = "rounds";
        out.reason = `Tied on ${pts}. ${top.name} takes it on round wins, ${top.roundWins} to ${second.roundWins}.`;
      } else if (top.votes !== second.votes) {
        out.tiedOn = "votes";
        out.reason = `Tied on ${pts} and ${plural(top.roundWins, "round win")} each. ${top.name} takes it on votes, ${top.votes} to ${second.votes}.`;
      } else if (top.firstMs !== second.firstMs) {
        out.tiedOn = "submission";
        out.reason = `Tied on ${pts}, round wins and votes. ${top.name} takes it by locking in the first answer sooner.`;
      } else {
        out.tiedOn = "seat";
        out.reason = `Tied on everything. ${top.name} takes it on the draw of the seats.`;
      }
      out.line = `${top.name} takes the crown! ${out.reason} 🏆`;
    }
  }
  // the table: ranked for a contest (the seated by rank, then those who left), in seat order otherwise
  const byRank = out.contest ? ranked.concat(rows.filter((r) => r.left)) : rows.slice();
  out.standings = byRank.map((r, i) => ({
    seat: r.seat, name: r.name, avatar: r.avatar, bot: r.bot, left: r.left,
    score: r.score, votes: r.votes, roundWins: r.roundWins,
    rank: out.contest && !r.left ? ranked.indexOf(r) + 1 : null,
    won: out.winner === r.seat,
  }));
  return out;
}

module.exports = { build };
