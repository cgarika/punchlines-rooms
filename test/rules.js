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
    if (room.phase==="vote" && room.entries){
      for (const e of room.entries){
        if (e.by!==undefined) s.leaks.push("author leaked during vote");
        if (e.votes!==undefined) s.leaks.push("tally leaked during vote");
      }
      const mine=room.entries.filter(e=>e.mine);
      if (room.yourSub && mine.length!==1) s.leaks.push("mine flag wrong: "+mine.length);
    }
  });
  return s;
}
(async()=>{
  try{
    const A=mk("A"),B=mk("B"),C=mk("C");
    const cs=[A,B,C];
    await sleep(300);
    let code=null; A.on("joined",j=>{code=j.code;});
    A.emit("create",{name:"A",playerId:"pA",avatar:"🎤"}); await sleep(250);
    B.emit("join",{code,name:"B",playerId:"pB",avatar:"🎤"});
    C.emit("join",{code,name:"C",playerId:"pC",avatar:"🎤"}); await sleep(300);
    A.emit("start"); await sleep(700);   // first state can take >250 ms on a loaded machine
    let st=A.st;
    if (st.phase!=="write"||!st.prompt||!st.prompt.includes("___")) throw new Error("write phase/prompt wrong");
    const prompt1=st.prompt;

    A.emit("submit",{text:"answer from A"}); await sleep(150);
    if (A.st.phase!=="write") throw new Error("advanced before all submitted");
    B.emit("submit",{text:"answer from B"});
    C.emit("submit",{text:"answer from C"}); await sleep(300);
    st=A.st;
    if (st.phase!=="vote") throw new Error("didn't auto-advance to vote");
    if (st.entries.length!==3) throw new Error("entries wrong: "+st.entries.length);
    const mineA=st.entries.find(e=>e.mine);
    if (!mineA||mineA.text!=="answer from A") throw new Error("mine mapping wrong");

    // self-vote rejected
    A.errs.length=0;
    A.emit("vote",{id:mineA.id}); await sleep(200);
    if (!A.errs.length) throw new Error("self-vote was accepted");
    // A,B vote C; C votes A
    const idOf=(cli,who)=>cli.st.entries.find(e=>e.text==="answer from "+who).id;
    A.emit("vote",{id:idOf(A,"C")});
    B.emit("vote",{id:idOf(B,"C")});
    C.emit("vote",{id:idOf(C,"A")}); await sleep(300);
    st=A.st;
    if (st.phase!=="reveal") throw new Error("didn't advance to reveal after all voted");
    const eC=st.entries.find(e=>e.text==="answer from C");
    if (eC.votes!==2||eC.by===undefined) throw new Error("reveal tally/author wrong");
    const score=(n)=>st.players[st.entries.find(e=>e.text==="answer from "+n).by].score;
    if (score("C")!==200||score("A")!==100||score("B")!==0) throw new Error("scores wrong: "+st.players.map(p=>p.score));
    console.log("PASS round flow — anonymity held, self-vote blocked, 2 votes = 200 points");

    // host skips reveal -> round 2 with a fresh prompt
    A.emit("next"); await sleep(300);
    st=A.st;
    if (st.round!==2||st.phase!=="write") throw new Error("host skip failed: r"+st.round+" "+st.phase);
    if (st.prompt===prompt1) throw new Error("prompt repeated");
    A.emit("submit",{text:"again A"}); B.emit("submit",{text:"again B"}); C.emit("submit",{text:"again C"}); await sleep(300);
    const idOf2=(cli,txt)=>cli.st.entries.find(e=>e.text===txt).id;
    A.emit("vote",{id:idOf2(A,"again C")}); B.emit("vote",{id:idOf2(B,"again C")}); C.emit("vote",{id:idOf2(C,"again B")}); await sleep(300);
    // reveal auto-expires via small REVEAL_MS -> over
    await sleep(900);
    st=A.st;
    if (st.status!=="over") throw new Error("game didn't end after final round: "+st.phase);
    const winSeat=st.winner;
    if (st.players[winSeat].name!=="C") throw new Error("winner wrong: "+st.players[winSeat].name);
    if (st.players[winSeat].score!==400) throw new Error("final score wrong");
    for (const c of cs) if (c.leaks.length) throw new Error(c.nm+": "+c.leaks[0]);
    console.log("PASS full game — 2 rounds, host skip, fresh prompts, winner C with 400");
    cs.forEach(c=>c.close());

    // ---- Test 3 (T1 AFK policy): own fast-clock server on 3521 ----
    {
      const { spawn } = require("child_process");
      const WRITE=700, AFK=250, P=3521, URL2="http://localhost:"+P;
      const srv = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT:String(P), ROUNDS:"6", WRITE_MS:String(WRITE), VOTE_MS:String(WRITE), REVEAL_MS:"60", AFK_MS:String(AFK) }, stdio:"ignore" });
      await sleep(600);
      const mk2=(name)=>{ const c=io(URL2,{transports:["websocket"],reconnection:false}); c.nm=name; c.st=null; c.seat=-1; c.logs=[]; c.on("state",({room,mySeat})=>{ c.st=room; c.seat=mySeat; if(room&&room.log) c.logs.push(room.log); }); return c; };
      const wait=async(fn,ms)=>{ const t0=Date.now(); while(Date.now()-t0<ms){ if(fn()) return true; await sleep(15);} return false; };
      const boot2=async(pfx)=>{ const cs=[mk2(pfx+"A"),mk2(pfx+"B"),mk2(pfx+"C")]; await sleep(250); let code=null; cs[0].on("joined",j=>{code=j.code;}); cs[0].emit("create",{name:pfx+"A",playerId:pfx+"a"+Math.random(),avatar:"🎤"}); await wait(()=>code,2000); cs[1].emit("join",{code,name:pfx+"B",playerId:pfx+"b"+Math.random(),avatar:"🎤"}); cs[2].emit("join",{code,name:pfx+"C",playerId:pfx+"c"+Math.random(),avatar:"🎤"}); await wait(()=>cs[0].st&&cs[0].st.players.length===3,2000); cs[0].emit("start"); await wait(()=>cs[0].st&&cs[0].st.phase==="write",2000); return cs; };
      const auto=(c)=>c.on("state",()=>{ const r=c.st; if(!r||r.status!=="playing") return; setTimeout(()=>{ const r2=c.st; if(!r2||r2.status!=="playing") return; if(r2.phase==="write"&&r2.yourSub===null) c.emit("submit",{text:"answer "+c.nm+" r"+r2.round}); else if(r2.phase==="vote"&&!r2.yourVote&&r2.entries){ const e=r2.entries.find(x=>!x.mine); if(e) c.emit("vote",{id:e.id}); } },8); });
      try {
        // 3a. the last writer still to answer is disconnected → the write phase ends on the AFK clock
        { const [A,B,C]=await boot2("p"); C.disconnect(); const t0=Date.now(); A.emit("submit",{text:"a"}); B.emit("submit",{text:"b"});
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
    console.log("ALL PUNCHLINES TESTS PASS");
    process.exit(0);
  }catch(e){ console.error("FAIL:", e.message); process.exit(1); }
})();
