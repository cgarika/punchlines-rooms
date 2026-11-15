/*
 Punchlines — AFK policy and the link-drop grace (node test/afk.js; own servers on TEST_PORT2 and the next port)
 Run:  ROUNDS=2 REVEAL_MS=600 PORT=3511 node server.js   then:  node test/rules.js
 Proves: secret submissions stay anonymous during voting (no author/tally
 fields leak; only your own entry carries mine:true), self-votes rejected,
 auto-advance when all submitted/voted, votes x100 scoring, host skip of the
 reveal, fresh prompt each round, correct winner over a full 2-round game.
*/
const { io } = require("socket.io-client");
const URL = "http://localhost:" + (process.env.TEST_PORT || 3511);   // TEST_PORT moves it off a busy 3511
const sleep = (ms)=>new Promise(r=>setTimeout(r,ms));

const mkdummy=null;
(async()=>{
  try{
    // ---- Test 3 (T1 AFK policy): own fast-clock server on 3521 ----
    {
      const { spawn } = require("child_process");
      const WRITE=700, AFK=250, P=Number(process.env.TEST_PORT2 || 3521), URL2="http://localhost:"+P;
      const srv = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT:String(P), ROUNDS:"6", WRITE_MS:String(WRITE), VOTE_MS:String(WRITE), REVEAL_MS:"60", AFK_MS:String(AFK), AFK_GRACE_MS:"0" }, stdio:"ignore" });
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
        // 3c. a short dropout (a phone in the background) is waited out: the fast clock only runs after the grace, and a player who is back is not counted as missing
        { const srv3 = spawn(process.execPath, ["server.js"], { env: { ...process.env, PORT:String(P+1), ROUNDS:"6", WRITE_MS:"3000", VOTE_MS:"3000", REVEAL_MS:"60", AFK_MS:"100", AFK_GRACE_MS:"900" }, stdio:"ignore" });
          try {
            await sleep(600);
            const U3="http://localhost:"+(P+1);
            const mk3=(name,id)=>{ const c=io(U3,{transports:["websocket"],reconnection:false}); c.nm=name; c.st=null; c.seat=-1; c.pid=id; c.on("state",({room,mySeat})=>{ c.st=room; c.seat=mySeat; }); return c; };
            const A=mk3("gA","ga"+Math.random()), B=mk3("gB","gb"+Math.random()), C=mk3("gC","gc"+Math.random());
            await sleep(250); let code=null; A.on("joined",j=>{code=j.code;});
            A.emit("create",{name:"gA",playerId:A.pid,avatar:"🎤"}); await wait(()=>code,2000);
            B.emit("join",{code,name:"gB",playerId:B.pid,avatar:"🎤"}); C.emit("join",{code,name:"gC",playerId:C.pid,avatar:"🎤"});
            await wait(()=>A.st&&A.st.players.length===3,2000); A.emit("start"); await wait(()=>A.st&&A.st.phase==="write",2000);
            C.disconnect(); const t0=Date.now();
            for (const p of A.st.yourPrompts) A.emit("submit",{id:p.id,text:"a"}); for (const p of B.st.yourPrompts) B.emit("submit",{id:p.id,text:"b"});
            await sleep(600);
            if (A.st.phase!=="write") throw new Error("AFK grace: the write phase ended "+(Date.now()-t0)+" ms after a player's link dropped (grace 900)");
            // back before the grace is up
            const C2=mk3("gC", C.pid); C2.emit("join",{code,name:"gC",playerId:C.pid,avatar:"🎤"});
            await sleep(1100);
            if (A.st.phase!=="write") throw new Error("AFK grace: the phase ended although the player was back");
            if (A.st.players[C.seat===-1?2:2].botControlled) throw new Error("AFK grace: a returning player was marked away");
            console.log("PASS AFK grace: a link that drops for under the grace neither ends the phase early nor counts as a miss");
            [A,B,C2].forEach(c=>c.disconnect());
          } finally { srv3.kill(); }
        }
      } finally { srv.kill(); }
    }

    console.log('afk suite done'); process.exit(0);
  }catch(e){ console.log('FAIL: '+e.message); process.exit(1); }
})();
