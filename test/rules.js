/*
 Punchlines — rules & anonymity suite (proven against v1)
 Run:  ROUNDS=2 REVEAL_MS=600 PORT=3511 node server.js   then:  node test/rules.js
 Proves: secret submissions stay anonymous during voting (no author/tally
 fields leak; only your own entry carries mine:true), self-votes rejected,
 auto-advance when all submitted/voted, votes x100 scoring, host skip of the
 reveal, fresh prompt each round, correct winner over a full 2-round game.
*/
const { io } = require("socket.io-client");
const URL = "http://localhost:3511";
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

function mk(name){
  const s = io(URL,{ transports:["websocket"] });
  s.nm=name; s.st=null; s.seat=-1; s.leaks=[]; s.errs=[];
  s.on("err",(m)=>s.errs.push(m));
  s.on("state",({room,mySeat})=>{
    s.st=room; s.seat=mySeat;
    if (room.phase==="vote" && room.matchup && room.matchup.entries){
      for (const e of room.matchup.entries){
        if (/^e\d+$/.test(e.id) || !/^[0-9a-f]{10}$/.test(e.id)) s.leaks.push("T4: predictable/non-random entry id "+e.id);
        if ("seat" in e || "author" in e) s.leaks.push("T4: entry leaks the seat");
        if (e.by!==undefined) s.leaks.push("author leaked during vote");
        if (e.votes!==undefined || e.pts!==undefined) s.leaks.push("tally leaked during vote");
      }
      const mine=room.matchup.entries.filter(e=>e.mine);
      if (room.matchup.contestant ? mine.length!==1 : mine.length!==0) s.leaks.push("mine flag wrong: "+mine.length);
    }
  });
  return s;
}
(async()=>{
  try{
    // ---- T13 unit: prompt assignment ----
    { const { makeMatchups } = require("../server.js");
      for (let P=3; P<=12; P++) {
        const seats = Array.from({length:P},(_,i)=>i*2);   // odd seat numbers to prove nothing assumes 0..P-1
        const ms = makeMatchups(seats, Array.from({length:P},(_,k)=>"prompt "+k+" ___"));
        if (ms.length!==P) throw new Error("T13: "+P+" players should get "+P+" matchups, got "+ms.length);
        const per={}; for (const m of ms){ if (m.seats.length!==2||m.seats[0]===m.seats[1]) throw new Error("T13: self-pairing / bad pair "+m.seats); for (const s of m.seats) per[s]=(per[s]||0)+1; if(!/^[0-9a-f]{10}$/.test(m.id)) throw new Error("T13: matchup id not random"); }
        for (const s of seats) if (per[s]!==2) throw new Error("T13: seat "+s+" got "+per[s]+" prompts at P="+P);
        if (new Set(ms.map(m=>m.prompt)).size!==P) throw new Error("T13: prompts repeat within a round");
      }
      console.log("PASS T13 assignment — every player gets exactly two prompts, every prompt two different players, 10 players → 10 matchups"); }

    // ---- Test 1: 3 humans — round flow with head-to-head matchups ----
    const A=mk("A"),B=mk("B"),C=mk("C");
    const cs=[A,B,C];
    await sleep(300);
    let code=null; A.on("joined",j=>{code=j.code;});
    A.emit("create",{name:"A",playerId:"pA",avatar:"🎤"}); await sleep(250);
    B.emit("join",{code,name:"B",playerId:"pB",avatar:"🎤"});
    C.emit("join",{code,name:"C",playerId:"pC",avatar:"🎤"}); await sleep(300);
    A.emit("start"); await sleep(700);   // first state can take >250 ms on a loaded machine
    let st=A.st;
    if (st.phase!=="write"||!st.yourPrompts||st.yourPrompts.length!==2||!st.yourPrompts.every(p=>p.prompt.includes("___"))) throw new Error("write phase/prompts wrong: "+JSON.stringify(st.yourPrompts));
    const ids1=new Set(cs.flatMap(c=>c.st.yourPrompts.map(p=>p.id)));
    if (ids1.size!==3) throw new Error("3 players should share 3 prompts, saw "+ids1.size);
    for (const id of ids1) if (cs.filter(c=>c.st.yourPrompts.some(p=>p.id===id)).length!==2) throw new Error("each prompt must go to exactly two players");
    const round1Prompts = new Set(cs.flatMap(c=>c.st.yourPrompts.map(p=>p.prompt)));
    const submitAll=(c,tag)=>{ for (const p of c.st.yourPrompts) if (p.text===null) c.emit("submit",{id:p.id,text:tag+" from "+c.nm}); };
    A.emit("submit",{id:"nope",text:"x"}); await sleep(120); if (!A.errs.length) throw new Error("submit to a foreign prompt id was accepted"); A.errs.length=0;
    submitAll(A,"answer"); await sleep(150);
    if (A.st.phase!=="write") throw new Error("advanced before all submitted");
    if (!A.st.players[A.seat].submitted || A.st.players[B.seat].submitted) throw new Error("submitted flags wrong");
    submitAll(B,"answer"); submitAll(C,"answer"); await sleep(300);
    st=A.st;
    if (st.phase!=="vote"||!st.matchup||st.matchup.index!==0||st.matchup.count!==3||st.matchup.entries.length!==2) throw new Error("didn't auto-advance to the first matchup: "+st.phase+" "+JSON.stringify(st.matchup));
    let expect={ A:0, B:0, C:0 };
    // play every matchup of round 1: the lone voter (not in the pair) votes for the first entry; contestants can't vote
    for (let k=0;k<3;k++){
      const mu=A.st.matchup; if (mu.index!==k) throw new Error("matchup order wrong: "+mu.index+" vs "+k);
      const voter=cs.find(c=>c.st.matchup.canVote), contestants=cs.filter(c=>c.st.matchup.contestant);
      if (!voter||contestants.length!==2) throw new Error("exactly one voter and two contestants expected");
      const mine=contestants[0].st.matchup.entries.find(e=>e.mine); if(!mine) throw new Error("contestant's own entry not flagged mine");
      contestants[0].errs.length=0; contestants[0].emit("vote",{id:mine.id}); await sleep(150); if (!contestants[0].errs.length) throw new Error("contestant vote was accepted"); if (A.st.phase!=="vote") throw new Error("phase moved on a rejected vote");
      const target=voter.st.matchup.entries[0]; voter.emit("vote",{id:target.id}); await sleep(300);
      st=voter.st; if (st.phase!=="reveal") throw new Error("didn't reveal after the only voter voted");
      const won=st.matchup.entries.find(e=>e.id===target.id); if (won.by===undefined||won.votes!==1||won.pts!==100||won.bonus!==0) throw new Error("reveal tally wrong: "+JSON.stringify(won));
      const lost=st.matchup.entries.find(e=>e.id!==target.id); if (lost.votes!==0||lost.pts!==0) throw new Error("loser tally wrong");
      const winner=cs[won.by]; expect[winner.nm]+=100;
      for (const c of cs) if (c.st.players[c.seat].score!==expect[c.nm]) throw new Error("score wrong for "+c.nm+": "+c.st.players[c.seat].score+" vs "+expect[c.nm]);
      if (k<2){ A.emit("next"); await sleep(250); if (A.st.phase!=="vote"||A.st.matchup.index!==k+1) throw new Error("host skip to next matchup failed: "+A.st.phase+" "+(A.st.matchup&&A.st.matchup.index)); }
    }
    for (const c of cs) if (c.leaks.length) throw new Error(c.nm+": "+c.leaks[0]);
    console.log("PASS T13 round flow — 3 matchups, contestants can't vote, 100 per vote, anonymity held (T4)");

    // host skips the last reveal -> round 2 with fresh prompts
    A.emit("next"); await sleep(300);
    st=A.st;
    if (st.round!==2||st.phase!=="write") throw new Error("host skip failed: r"+st.round+" "+st.phase);
    for (const c of cs) for (const p of c.st.yourPrompts) if (round1Prompts.has(p.prompt)) throw new Error("prompt repeated across rounds");
    for (const c of cs) submitAll(c,"again"); await sleep(300);
    for (let k=0;k<3;k++){ const voter=cs.find(c=>c.st.matchup&&c.st.matchup.canVote); const target=voter.st.matchup.entries[0]; voter.emit("vote",{id:target.id}); await sleep(250); const won=voter.st.matchup.entries.find(e=>e.id===target.id); expect[cs[won.by].nm]+=100; if (k<2){ A.emit("next"); await sleep(200);} }
    // reveal auto-expires via small REVEAL_MS -> over
    await sleep(900);
    st=A.st;
    if (st.status!=="over") throw new Error("game didn't end after final round: "+st.phase);
    const top=Object.entries(expect).sort((a,b)=>b[1]-a[1])[0];
    if (st.players[st.winner].name!==top[0] && st.players[st.winner].score!==top[1]) throw new Error("winner wrong: "+st.players[st.winner].name+" "+st.players[st.winner].score+" vs "+top);
    for (const c of cs) if (c.st.players[c.seat].score!==expect[c.nm]) throw new Error("final score wrong for "+c.nm);
    if (!Array.isArray(st.matchups)||st.matchups.length!==3||st.matchups.some(m=>m.entries.some(e=>typeof e.by!=="number"))) throw new Error("T4: final reveal lacks authors");
    for (const c of cs) if (c.leaks.length) throw new Error(c.nm+": "+c.leaks[0]);
    console.log("PASS T4 hidden authorship — random ids during the vote, authors only at the reveal");
    console.log("PASS full game — 2 rounds × 3 matchups, host skips, fresh prompts, scores "+JSON.stringify(expect));
    cs.forEach(c=>c.close());

    // ---- T13 unanimous bonus: 4 players → two voters per matchup; both agree → +100 quiplash bonus ----
    {
      const q=[mk("Q0"),mk("Q1"),mk("Q2"),mk("Q3")]; await sleep(300); let c4=null; q[0].on("joined",j=>{c4=j.code;});
      q[0].emit("create",{name:"Q0",playerId:"q0"+Math.random(),avatar:"🎤"}); await sleep(250); for (let i=1;i<4;i++) q[i].emit("join",{code:c4,name:"Q"+i,playerId:"q"+i+Math.random(),avatar:"🎤"}); await sleep(300);
      q[0].emit("start"); await sleep(600);
      if (q[0].st.yourPrompts.length!==2 || new Set(q.flatMap(c=>c.st.yourPrompts.map(p=>p.id))).size!==4) throw new Error("T13: 4 players should get 4 matchups");
      for (const c of q) for (const p of c.st.yourPrompts) c.emit("submit",{id:p.id,text:"quip "+c.nm+" "+p.id.slice(0,3)}); await sleep(400);
      if (q[0].st.phase!=="vote") throw new Error("T13: vote phase expected");
      const voters=q.filter(c=>c.st.matchup.canVote); if (voters.length!==2) throw new Error("T13: expected two voters, got "+voters.length);
      const target=voters[0].st.matchup.entries[1]; const scoreBefore=q[0].st.players.map(p=>p.score);
      voters[0].emit("vote",{id:target.id}); await sleep(150); if (q[0].st.phase!=="vote") throw new Error("T13: revealed before both voters voted");
      voters[1].emit("vote",{id:target.id}); await sleep(300);
      const mu=q[0].st.matchup; if (q[0].st.phase!=="reveal") throw new Error("T13: no reveal after both votes");
      const won=mu.entries.find(e=>e.id===target.id); if (won.votes!==2||won.bonus!==100||won.pts!==300) throw new Error("T13: unanimous win should score 2×100 + 100 bonus, got "+JSON.stringify(won));
      if (q[0].st.players[won.by].score-scoreBefore[won.by]!==300) throw new Error("T13: bonus not added to the score");
      // split vote next matchup: no bonus
      q[0].emit("next"); await sleep(250); const v2=q.filter(c=>c.st.matchup&&c.st.matchup.canVote); v2[0].emit("vote",{id:v2[0].st.matchup.entries[0].id}); v2[1].emit("vote",{id:v2[1].st.matchup.entries[1].id}); await sleep(300);
      if (q[0].st.matchup.entries.some(e=>e.bonus!==0||e.pts!==100)) throw new Error("T13: split vote must score 100 each with no bonus: "+JSON.stringify(q[0].st.matchup.entries));
      console.log("PASS T13 quiplash bonus — unanimous win 300 (2 votes + bonus), split vote 100 each");
      q.forEach(c=>c.close());
    }

    // ---- Test 3 (T1 AFK policy): own fast-clock server on 3521 ----
    {
      const { spawn } = require("child_process");
      const WRITE=700, AFK=250, P=3521, URL2="http://localhost:"+P;
      const srv = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT:String(P), ROUNDS:"6", WRITE_MS:String(WRITE), VOTE_MS:String(WRITE), REVEAL_MS:"60", AFK_MS:String(AFK) }, stdio:"ignore" });
      await sleep(600);
      const mk2=(name)=>{ const c=io(URL2,{transports:["websocket"],reconnection:false}); c.nm=name; c.st=null; c.seat=-1; c.logs=[]; c.on("state",({room,mySeat})=>{ c.st=room; c.seat=mySeat; if(room&&room.log) c.logs.push(room.log); }); return c; };
      const wait=async(fn,ms)=>{ const t0=Date.now(); while(Date.now()-t0<ms){ if(fn()) return true; await sleep(15);} return false; };
      const boot2=async(pfx)=>{ const cs=[mk2(pfx+"A"),mk2(pfx+"B"),mk2(pfx+"C")]; await sleep(250); let code=null; cs[0].on("joined",j=>{code=j.code;}); cs[0].emit("create",{name:pfx+"A",playerId:pfx+"a"+Math.random(),avatar:"🎤"}); await wait(()=>code,2000); cs[1].emit("join",{code,name:pfx+"B",playerId:pfx+"b"+Math.random(),avatar:"🎤"}); cs[2].emit("join",{code,name:pfx+"C",playerId:pfx+"c"+Math.random(),avatar:"🎤"}); await wait(()=>cs[0].st&&cs[0].st.players.length===3,2000); cs[0].emit("start"); await wait(()=>cs[0].st&&cs[0].st.phase==="write",2000); return cs; };
      const auto=(c)=>c.on("state",()=>{ const r=c.st; if(!r||r.status!=="playing") return; setTimeout(()=>{ const r2=c.st; if(!r2||r2.status!=="playing") return; if(r2.phase==="write"){ for (const p of (r2.yourPrompts||[])) if (p.text===null) c.emit("submit",{id:p.id,text:"answer "+c.nm+" r"+r2.round}); } else if(r2.phase==="vote"&&!r2.yourVote&&r2.matchup&&r2.matchup.canVote){ const e=r2.matchup.entries.find(x=>!x.mine); if(e) c.emit("vote",{id:e.id}); } },8); });
      try {
        // 3a. the last writer still to answer is disconnected → the write phase ends on the AFK clock
        { const [A,B,C]=await boot2("p"); C.disconnect(); const t0=Date.now(); for (const p of A.st.yourPrompts) A.emit("submit",{id:p.id,text:"a"}); for (const p of B.st.yourPrompts) B.emit("submit",{id:p.id,text:"b"});
          if(!(await wait(()=>A.st&&A.st.phase!=="write", WRITE+800))) throw new Error("AFK: write phase did not end with a disconnected writer"); const dt=Date.now()-t0; if(dt>=WRITE) throw new Error("AFK: waited the full clock ("+dt+" ms)");
          console.log("PASS AFK write phase with a disconnected player ended after "+dt+" ms (clock "+WRITE+")"); A.disconnect(); B.disconnect(); }
        // 3b. a connected player who never answers: 3 missed phases → marked away, the room stops waiting; a submit brings them back
        { const [A,B,C]=await boot2("q"); auto(A); auto(B); const seat=C.seat;
          if(!(await wait(()=>C.st&&C.st.players[seat].botControlled, WRITE*8))) throw new Error("AFK: idle player never marked away (status "+(C.st&&C.st.status)+", round "+(C.st&&C.st.round)+")");
          if(!(await wait(()=>C.logs.some(l=>/is away/.test(l)),500))) throw new Error("AFK: no away log");
          const roundThen=C.st.round; if(!(await wait(()=>C.st.round>roundThen||C.st.status==="over", 3000))) throw new Error("AFK: the room still waited for the away player");
          C.emit("takeSeat"); if(!(await wait(()=>!C.st.players[seat].botControlled,1500))) throw new Error("AFK: takeSeat did not clear the flag");
          console.log("PASS AFK 3 missed phases → away seat skipped, takeSeat brings the player back"); [A,B,C].forEach(c=>c.disconnect()); }
      } finally { srv.kill(); }
    }

    // ---- T3 host handover: host disconnects during play → another human becomes host ----
    {
      const { spawn } = require("child_process");
      const P=3531, URL2="http://localhost:"+P;
      const srv = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT:String(P), WRITE_MS:"60000", VOTE_MS:"60000", REVEAL_MS:"600" }, stdio:"ignore" });
      await sleep(600);
      const mk2=(name)=>{ const c=io(URL2,{transports:["websocket"],reconnection:false}); c.st=null; c.seat=-1; c.logs=[]; c.on("state",({room,mySeat})=>{ c.st=room; c.seat=mySeat; if(room&&room.log) c.logs.push(room.log); }); return c; };
      const wait=async(fn,ms=6000)=>{ const t0=Date.now(); while(Date.now()-t0<ms){ if(fn()) return true; await sleep(15);} return false; };
      try {
        const n=3; const cs=[]; for(let i=0;i<n;i++) cs.push(mk2("H"+i)); await sleep(250); let code=null; cs[0].on("joined",j=>{code=j.code;});
        cs[0].emit("create",{name:"H0",playerId:"h0"+Math.random(),avatar:"🦊"}); await wait(()=>code); for(let i=1;i<n;i++) cs[i].emit("join",{code,name:"H"+i,playerId:"h"+i+Math.random(),avatar:"🐼"}); await wait(()=>cs[0].st&&cs[0].st.players.length===n);
        
        cs[0].emit("start"); if(!(await wait(()=>cs[1].st&&cs[1].st.status==="playing"))) throw new Error("T3: game did not start");
        if(cs[1].st.hostSeat!==cs[0].seat) throw new Error("T3: creator is not the host at start");
        cs[0].disconnect();
        if(!(await wait(()=>cs[1].st.hostSeat===cs[1].seat, 3000))) throw new Error("T3: host did not move to the connected human (hostSeat "+cs[1].st.hostSeat+")");
        if(!cs[1].logs.some(l=>/is now the host/.test(l))) throw new Error("T3: no host log line");
        console.log("PASS T3 host handover — host disconnected mid-game, next connected human is host");
        
        cs.forEach(c=>c.disconnect());
      } finally { srv.kill(); }
    }
    console.log("ALL PUNCHLINES TESTS PASS");
    process.exit(0);
  }catch(e){ console.error("FAIL:", e.message); process.exit(1); }
})();
