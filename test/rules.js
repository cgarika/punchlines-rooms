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
    A.emit("start"); await sleep(250);
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
    console.log("ALL PUNCHLINES TESTS PASS");
    process.exit(0);
  }catch(e){ console.error("FAIL:", e.message); process.exit(1); }
})();
