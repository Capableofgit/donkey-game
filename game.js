/* Donkey Game — shared core for all modes.
   A page sets window.DG_MODE = 'daily' | 'unlimited' | 'tower', then loads this file.
   Only one mode ever runs per page load, so modes never share runtime state. */
(function(){
  "use strict";

  var MODE = (window.DG_MODE === 'unlimited' || window.DG_MODE === 'tower') ? window.DG_MODE : 'daily';

  // ---------- constants ----------
  var DAY_MS = 86400000;
  var EPOCH  = Date.UTC(2026, 5, 19);                       // No. 0 = 19 Jun 2026 (Israel date)
  var SCALE  = [261.63,293.66,329.63,349.23,392.00,440.00,493.88,523.25];
  var TOWER_MAX = 5;                                        // levels 1..5  =>  3x3 .. 7x7

  // ---------- tiny storage helpers ----------
  function lsGet(k,d){ try{ var v=localStorage.getItem(k); return v==null?d:JSON.parse(v); }catch(e){ return d; } }
  function lsSet(k,v){ try{ localStorage.setItem(k,JSON.stringify(v)); }catch(e){} }

  // ---------- Israel date / puzzle number ----------
  function israelParts(){
    var dtf = new Intl.DateTimeFormat('en-CA',{ timeZone:'Asia/Jerusalem', hour12:false,
      year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit' });
    var p={}; dtf.formatToParts(new Date()).forEach(function(x){ if(x.type!=='literal') p[x.type]=parseInt(x.value,10); });
    if(p.hour===24) p.hour=0;
    return p;
  }
  function puzzleNumber(){
    var qp=new URLSearchParams(location.search);
    if(qp.has('day')){ var d=parseInt(qp.get('day'),10); if(isFinite(d)) return d; }
    var p=israelParts(); var today=Date.UTC(p.year,p.month-1,p.day);
    return Math.round((today-EPOCH)/DAY_MS);
  }

  // ---------- seeded RNG (pure integer math => identical on every device) ----------
  function xmur3(str){ var h=1779033703^str.length; for(var i=0;i<str.length;i++){ h=Math.imul(h^str.charCodeAt(i),3432918353); h=(h<<13)|(h>>>19); }
    return function(){ h=Math.imul(h^(h>>>16),2246822507); h=Math.imul(h^(h>>>13),3266489909); h^=h>>>16; return h>>>0; }; }
  function mulberry32(a){ return function(){ a|=0; a=(a+0x6D2B79F5)|0; var t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
  function oneBomb(rng,n){ var s={}; s[Math.floor(rng()*n)]=true; return s; }  // single bomb (matches original daily exactly)
  function pickBombs(n,count,rng){                          // deterministic set of bomb indices (multi-bomb, Tower)
    var idx=[]; for(var i=0;i<n;i++) idx.push(i);
    for(var i=n-1;i>0;i--){ var j=Math.floor(rng()*(i+1)); var t=idx[i]; idx[i]=idx[j]; idx[j]=t; }
    var s={}; for(var k=0;k<count;k++) s[idx[k]]=true; return s;
  }

  // ---------- sound (mute-aware, generated, no files) ----------
  var muted = lsGet('donkey:muted', false);
  var AudioFX = (function(){
    var ctx;
    function ac(){ if(muted) return null;
      if(ctx===undefined){ try{ ctx=new (window.AudioContext||window.webkitAudioContext)(); }catch(e){ ctx=null; } }
      if(ctx && ctx.state==='suspended') ctx.resume(); return ctx; }
    function tone(freq,delay,dur,type,peak){ var c=ac(); if(!c) return;
      var t0=c.currentTime+delay, o=c.createOscillator(), g=c.createGain();
      o.type=type; o.frequency.setValueAtTime(freq,t0);
      g.gain.setValueAtTime(0.0001,t0); g.gain.exponentialRampToValueAtTime(peak,t0+0.02); g.gain.exponentialRampToValueAtTime(0.0001,t0+dur);
      o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0+dur+0.03); }
    return {
      reveal:function(found,total){                         // pitch climbs across a board's safe tiles
        var frac = total>1 ? (found-1)/(total-1) : 1;
        var i = Math.max(0, Math.min(7, Math.round(frac*7)));
        tone(SCALE[i],0,0.30,'sine',0.12);
        if(found>=total) tone(SCALE[7]*2,0.04,0.55,'sine',0.05);   // soft clear shimmer
      },
      fail:function(){ var c=ac(); if(!c) return;
        var t0=c.currentTime, o=c.createOscillator(), g=c.createGain();
        o.type='triangle'; o.frequency.setValueAtTime(311.13,t0); o.frequency.exponentialRampToValueAtTime(110,t0+0.5);
        g.gain.setValueAtTime(0.0001,t0); g.gain.exponentialRampToValueAtTime(0.13,t0+0.04); g.gain.exponentialRampToValueAtTime(0.0001,t0+0.6);
        o.connect(g); g.connect(c.destination); o.start(t0); o.stop(t0+0.62); }
    };
  })();

  // ---------- module state / DOM refs ----------
  var grid, statusEl, oddsEl, resultEl, resultTitle, resultText, resultExtra, subtitleEl;
  var tiles=[], board=null, st=null, towerLevel=1, dailyPuzzleAtLoad=0;

  // ---------- board spec for the current mode/level ----------
  function makeSpec(){
    if(MODE==='daily'){
      var p=puzzleNumber();
      return { n:9, cols:3, safeTotal:8, bombs:oneBomb(mulberry32(xmur3('donkey-game::v1::'+p)()),9) };
    }
    if(MODE==='unlimited'){
      return { n:9, cols:3, safeTotal:8, bombs:oneBomb(Math.random,9) };
    }
    // tower
    var P=puzzleNumber(), L=towerLevel, cols=L+2, n=cols*cols;
    return { n:n, cols:cols, level:L, safeTotal:n-L, bombs:pickBombs(n,L,mulberry32(xmur3('donkey-tower::v1::'+P+'::L'+L)())) };
  }

  function buildBoard(spec){
    board=spec; st={ revealed:new Array(spec.n).fill(false), found:0, over:false, result:null, hitBomb:-1 };
    grid.dataset.cols=spec.cols; grid.style.setProperty('--cols',spec.cols);
    grid.innerHTML=''; tiles=[];
    for(var i=0;i<spec.n;i++){
      var btn=document.createElement('button'); btn.className='tile'; btn.setAttribute('aria-label','Block '+(i+1));
      btn.innerHTML='<span class="badge-num">'+(i+1)+'</span><span class="tag"></span>'+
        '<div class="inner"><div class="face front">'+(i+1)+'<span class="tap">reveal</span></div>'+
        '<div class="face back"><img alt=""></div></div>';
      (function(idx){ btn.addEventListener('click',function(){ onClick(idx); }); })(i);
      grid.appendChild(btn); tiles.push(btn);
    }
    resultEl.classList.remove('show','win','lose');
    render();
  }

  function onClick(i){
    if(st.over || st.revealed[i]) return;
    st.revealed[i]=true;
    if(board.bombs[i]){ st.over=true; st.result='lose'; st.hitBomb=i; AudioFX.fail(); }
    else { st.found++; AudioFX.reveal(st.found, board.safeTotal);
      if(st.found>=board.safeTotal){ st.over=true; st.result='win'; } }
    render();
    if(st.over) boardOver();
  }

  function render(){
    for(var i=0;i<board.n;i++){
      var btn=tiles[i], back=btn.querySelector('.back'), img=back.querySelector('img'), tag=btn.querySelector('.tag');
      if(st.revealed[i]){
        btn.classList.add('flipped'); btn.disabled=true;
        back.className='face back'; tag.className='tag'; tag.textContent='';
        if(board.bombs[i]){
          img.src='UpsideDownDonkey.png';
          if(st.result==='win'){ back.classList.add('avoid'); tag.classList.add('avoid'); tag.textContent='avoided'; img.alt='Upside-down donkey (avoided)'; }
          else { back.classList.add('bomb'); img.alt='Upside-down donkey'; if(i===st.hitBomb){ tag.classList.add('bomb'); tag.textContent='you lose'; } }
        } else { back.classList.add('safe'); img.src='RightSideUpDonkey.png'; img.alt='Right-side-up donkey'; }
      } else { btn.classList.remove('flipped'); btn.disabled=st.over; }
    }
    var foundTxt='Donkeys found: <b>'+st.found+'</b> / '+board.safeTotal;
    if(MODE==='tower'){
      var bc=board.level;
      statusEl.innerHTML='<div class="found">Level <b>'+board.level+'</b> · '+board.cols+'×'+board.cols+' · '+bc+' bomb'+(bc>1?'s':'')+' · '+foundTxt+'</div>';
    } else statusEl.innerHTML='<div class="found">'+foundTxt+'</div>';
    updateOdds();
  }

  function updateOdds(){
    if(st.over){ oddsEl.style.display='none'; return; }
    var hidden=0; for(var i=0;i<board.n;i++) if(!st.revealed[i]) hidden++;
    var pct = hidden>0 ? Math.round(100*(board.safeTotal-st.found)/hidden) : 0;
    oddsEl.style.display='block';
    oddsEl.style.color=oddsColor(pct);
    oddsEl.innerHTML='Next reveal: <b>'+pct+'% safe</b>';
  }
  function oddsColor(pct){ var t=pct/100;
    return 'rgb('+Math.round(224+(106-224)*t)+','+Math.round(96+(170-96)*t)+','+Math.round(106+(100-106)*t)+')'; }

  function boardOver(){
    for(var i=0;i<board.n;i++){ if(board.bombs[i]) st.revealed[i]=true; }   // reveal all bombs for clarity
    render();
    if(MODE==='tower') towerOver();
    else singleOver();
  }

  function recordCloud(p){ if(window.DGCloud && window.DGCloud.recordResult){ try{ window.DGCloud.recordResult(p); }catch(e){} } }

  function singleOver(){
    recordCloud({ mode:MODE, won:(st.result==='win'), day:(MODE==='daily'?puzzleNumber():null) });
    if(st.result==='win'){ panel('win','🎉 WINNER WINNER CHICKEN HOVAV!',"Congratulations, you're going to have a good week ahead of you.", extraForMode()); launchConfetti(); }
    else panel('lose','💥 Upside-down donkey!','You lost. Get out.', extraForMode());
    wireExtra();
  }

  function towerOver(){
    if(st.result==='lose'){
      recordCloud({ mode:'tower', won:false, level:board.level, champion:false });
      panel('lose','💥 Upside-down donkey!','You reached level '+board.level+' of '+TOWER_MAX+'. Get out.','<button class="btn" id="towerBtn">↻ Try again</button>');
      document.getElementById('towerBtn').addEventListener('click',function(){ towerLevel=1; buildBoard(makeSpec()); });
    } else if(board.level>=TOWER_MAX){
      recordCloud({ mode:'tower', won:true, level:TOWER_MAX, champion:true });
      panel('win','🏆 TOWER CHAMPION!','You cleared all '+TOWER_MAX+' levels. Incredible.','<button class="btn" id="towerBtn">↻ Play again</button>');
      launchConfetti();
      document.getElementById('towerBtn').addEventListener('click',function(){ towerLevel=1; buildBoard(makeSpec()); });
    } else {
      panel('win','✅ Level '+board.level+' cleared!','Next: level '+(board.level+1)+' — a '+(board.level+3)+'×'+(board.level+3)+' board with '+(board.level+1)+' bombs.','<button class="btn" id="towerBtn">Next level →</button>');
      document.getElementById('towerBtn').addEventListener('click',function(){ towerLevel=board.level+1; buildBoard(makeSpec()); });
    }
  }

  function panel(cls,title,text,extraHTML){
    resultEl.classList.add('show'); resultEl.classList.remove('win','lose'); if(cls) resultEl.classList.add(cls);
    resultTitle.textContent=title; resultText.textContent=text; resultExtra.innerHTML=extraHTML||'';
  }
  function extraForMode(){
    if(MODE==='unlimited') return '<button class="btn" id="againBtn">↻ Play again</button>';
    if(MODE==='daily') return '<div class="countdown">Next board in <b id="countdown">--:--:--</b></div>';
    return '';
  }
  function wireExtra(){ var a=document.getElementById('againBtn'); if(a) a.addEventListener('click',function(){ location.reload(); }); }

  // ---------- confetti rain (win) ----------
  function launchConfetti(){
    if(document.getElementById('confetti-canvas')) return;
    var canvas=document.createElement('canvas'); canvas.id='confetti-canvas';
    canvas.style.cssText='position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
    document.body.appendChild(canvas);
    var ctx=canvas.getContext('2d'), dpr=Math.min(window.devicePixelRatio||1,2), W,H;
    function resize(){ W=canvas.width=Math.floor(innerWidth*dpr); H=canvas.height=Math.floor(innerHeight*dpr); }
    resize(); window.addEventListener('resize',resize);
    var colors=['#6aaa64','#e0606a','#6aa0e0','#f2c14e','#f29ec4','#9b7ede','#ffffff'], pieces=[];
    function rand(a,b){ return a+Math.random()*(b-a); }
    function addPiece(){ pieces.push({ x:rand(0,W), y:rand(-H*0.25,H), w:rand(6,12)*dpr, h:rand(8,16)*dpr,
      color:colors[(Math.random()*colors.length)|0], vy:rand(2,5)*dpr, vx:rand(-1,1)*dpr,
      angle:rand(0,Math.PI*2), spin:rand(-0.2,0.2), sway:rand(0.5,1.5), phase:rand(0,Math.PI*2) }); }
    var TARGET=280, DURATION=5000, t0=performance.now();
    function frame(now){
      var elapsed=now-t0; ctx.clearRect(0,0,W,H);
      if(elapsed<DURATION){ while(pieces.length<TARGET) addPiece(); }
      for(var i=pieces.length-1;i>=0;i--){ var p=pieces[i];
        p.y+=p.vy; p.x+=p.vx+Math.sin(now/600+p.phase)*p.sway*dpr; p.angle+=p.spin;
        if(p.y>H+20*dpr){ if(elapsed<DURATION){ p.y=rand(-H*0.25,0); p.x=rand(0,W); } else { pieces.splice(i,1); continue; } }
        ctx.save(); ctx.translate(p.x,p.y); ctx.rotate(p.angle); ctx.fillStyle=p.color; ctx.fillRect(-p.w/2,-p.h/2,p.w,p.h); ctx.restore();
      }
      if(pieces.length>0) requestAnimationFrame(frame); else { window.removeEventListener('resize',resize); canvas.remove(); }
    }
    requestAnimationFrame(frame);
  }

  // ---------- daily countdown to next Israel midnight ----------
  function dailyTick(){
    if(puzzleNumber()!==dailyPuzzleAtLoad && !new URLSearchParams(location.search).has('day')){ location.reload(); return; }
    var c=document.getElementById('countdown'); if(!c) return;
    var p=israelParts(); var rem=86400-(p.hour*3600+p.minute*60+p.second); if(rem<0) rem=0;
    var h=Math.floor(rem/3600), m=Math.floor((rem%3600)/60), s=rem%60, pad=function(x){ return (x<10?'0':'')+x; };
    c.textContent=pad(h)+':'+pad(m)+':'+pad(s);
  }

  // ---------- UI scaffold ----------
  function tabLink(mode,label,href){ return '<a class="tab'+(MODE===mode?' active':'')+'" href="'+href+'">'+label+'</a>'; }

  function build(){
    document.body.innerHTML =
      '<nav class="tabs">'+tabLink('daily','DAILY','index.html')+tabLink('unlimited','UNLIMITED','unlimited.html')+tabLink('tower','TOWER','tower.html')+'</nav>'+
      '<header><h1 class="title"><span class="emoji">🫏</span> Donkey Game</h1><div class="puzzle-no" id="subtitle"></div></header>'+
      '<div class="utility" id="utility"><button class="mute" id="muteBtn" type="button" aria-label="Toggle sound"></button></div>'+
      '<div class="panel">'+
        '<div class="status" id="status"></div>'+
        '<div class="grid" id="grid"></div>'+
        '<div class="odds" id="odds"></div>'+
        '<div class="result" id="result"><h2 id="resultTitle"></h2><p id="resultText"></p><div id="resultExtra"></div></div>'+
      '</div>'+
      '<footer>Vibecoded by Leo</footer>';

    grid=document.getElementById('grid'); statusEl=document.getElementById('status'); oddsEl=document.getElementById('odds');
    resultEl=document.getElementById('result'); resultTitle=document.getElementById('resultTitle'); resultText=document.getElementById('resultText');
    resultExtra=document.getElementById('resultExtra'); subtitleEl=document.getElementById('subtitle');

    if(MODE==='daily'){ dailyPuzzleAtLoad=puzzleNumber(); subtitleEl.textContent='No. '+dailyPuzzleAtLoad+' · a new board every day'; setInterval(dailyTick,1000); dailyTick(); }
    else if(MODE==='unlimited'){ subtitleEl.textContent='Unlimited · new board every refresh'; }
    else { subtitleEl.textContent='Tower · No. '+puzzleNumber()+' · climb as high as you can'; }

    updateMuteBtn();
    document.getElementById('muteBtn').addEventListener('click',function(){ muted=!muted; lsSet('donkey:muted',muted); updateMuteBtn(); });

    towerLevel=1;
    buildBoard(makeSpec());
  }
  function updateMuteBtn(){ var b=document.getElementById('muteBtn'); b.textContent=muted?'🔇':'🔊'; b.classList.toggle('off',muted); }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',build); else build();
})();
