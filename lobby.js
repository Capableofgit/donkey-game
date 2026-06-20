/* Donkey Game — Lobby (real-time multiplayer over Firebase Realtime Database).
   Create/join a room via invite link; players appear on the right; take turns on a shared
   3x3 board. Each player's nameplate flashes green when they reveal a donkey and locks red
   when they hit the upside-down donkey. Results are derived from the room seed on every
   client, so a player can't lie about what happened. */
(function(){
  "use strict";

  var CONFIG = {
    apiKey: "AIzaSyBSYgErhG365SipYNnE8q8QgkVTG5bqbL0",
    authDomain: "donkey-game-a957c.firebaseapp.com",
    databaseURL: "https://donkey-game-a957c-default-rtdb.europe-west1.firebasedatabase.app",
    projectId: "donkey-game-a957c",
    storageBucket: "donkey-game-a957c.firebasestorage.app",
    messagingSenderId: "809597135312",
    appId: "1:809597135312:web:0ad7095c574a1c71a7b1d5"
  };

  // ---------- helpers ----------
  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function xmur3(str){ var h=1779033703^str.length; for(var i=0;i<str.length;i++){ h=Math.imul(h^str.charCodeAt(i),3432918353); h=(h<<13)|(h>>>19); }
    return function(){ h=Math.imul(h^(h>>>16),2246822507); h=Math.imul(h^(h>>>13),3266489909); h^=h>>>16; return h>>>0; }; }
  function mulberry32(a){ return function(){ a|=0; a=(a+0x6D2B79F5)|0; var t=Math.imul(a^(a>>>15),1|a); t=(t+Math.imul(t^(t>>>7),61|t))^t; return ((t^(t>>>14))>>>0)/4294967296; }; }
  function bombFor(seed){ var rng=mulberry32(xmur3('lobby::'+seed)()); return Math.floor(rng()*9); }   // single bomb, 9 tiles
  function newCode(){ var a='ABCDEFGHJKLMNPQRSTUVWXYZ23456789', s=''; for(var i=0;i<5;i++) s+=a.charAt(Math.floor(Math.random()*a.length)); return s; }
  function avatar(p,size){ var st='width:'+size+'px;height:'+size+'px;';
    if(p && p.avatar) return '<img class="av" style="'+st+'" src="'+p.avatar+'" alt="">';
    var i=(p && p.name ? p.name.charAt(0) : '?').toUpperCase();
    return '<span class="av" style="'+st+'font-size:'+Math.round(size*0.5)+'px;">'+esc(i)+'</span>'; }
  function tab(mode,label,href){ return '<a class="tab'+(mode==='lobby'?' active':'')+'" href="'+href+'">'+label+'</a>'; }
  var HEBREW = ['שמאלה למעלה','למעלה באמצע','ימינה למעלה','שמאלה באמצע','באמצע באמצע','ימינה באמצע','שמאלה למטה','למטה באמצע','הטמל הנימי'];

  // ---------- state ----------
  var auth, db, uid=null, myName=null, myAvatar=null;
  var roomId=(new URLSearchParams(location.search)).get('room');
  var room=null, listening=false, prevCount=0, app, flashUid=null, flashTimer=null;

  // ---------- scaffold ----------
  function build(){
    document.body.innerHTML =
      '<nav class="tabs">'+tab('daily','DAILY','index.html')+tab('unlimited','UNLIMITED','unlimited.html')+tab('tower','TOWER','tower.html')+tab('lobby','LOBBY','lobby.html')+'</nav>'+
      '<header><h1 class="title"><span class="emoji">🫏</span> Donkey Game</h1><div class="puzzle-no">Lobby · play together, live</div></header>'+
      '<div id="app"></div>'+
      '<footer>Vibecoded by Leo</footer>';
    app=document.getElementById('app');
  }

  function boot(){
    build();
    if(typeof firebase==='undefined'){ app.innerHTML=msg('The lobby needs an internet connection.'); return; }
    try{ if(!firebase.apps || !firebase.apps.length) firebase.initializeApp(CONFIG); auth=firebase.auth(); db=firebase.database(); }
    catch(e){ app.innerHTML=msg('Could not connect to the lobby service.'); return; }
    app.innerHTML=msg('Connecting…');
    auth.onAuthStateChanged(function(user){
      if(!user){ auth.signInAnonymously().catch(function(){ app.innerHTML=msg('Sign-in failed. Refresh to retry.'); }); return; }
      uid=user.uid;
      db.ref('users/'+uid).once('value').then(function(s){
        var u=s.val()||{}; myName=u.name||null; myAvatar=u.avatar||null;
        route();
      });
    });
  }
  function msg(t){ return '<div class="create-card"><p style="margin:0">'+esc(t)+'</p></div>'; }

  function route(){
    if(!myName){ showNameForm(); return; }
    if(!roomId){ showCreate(); return; }
    joinAndListen();
  }

  // ---------- pick a name (first time) ----------
  function showNameForm(){
    app.innerHTML='<div class="create-card"><h2 style="margin:0 0 6px">👋 Pick a username</h2>'+
      '<p>It shows on the leaderboard and in lobbies.</p>'+
      '<input id="nm" class="field" maxlength="16" placeholder="e.g. Leo" autocomplete="off">'+
      '<button class="btn" id="nmSave">Continue</button></div>';
    var nm=document.getElementById('nm'); nm.focus();
    function save(){ var v=(nm.value||'').trim().slice(0,16); if(!v) return;
      db.ref('users/'+uid).update({ name:v, updated:firebase.database.ServerValue.TIMESTAMP });
      myName=v; route(); }
    document.getElementById('nmSave').addEventListener('click',save);
    nm.addEventListener('keydown',function(e){ if(e.key==='Enter') save(); });
  }

  // ---------- create a room ----------
  function showCreate(){
    app.innerHTML='<div class="create-card"><h2 style="margin:0 0 6px">Start a lobby</h2>'+
      '<p>Create a room, then share the invite link. Everyone plays the same board, live.</p>'+
      '<button class="btn" id="mk">➕ Create a lobby</button></div>';
    document.getElementById('mk').addEventListener('click',function(){
      var id=newCode();
      db.ref('lobbies/'+id).set({ host:uid, created:firebase.database.ServerValue.TIMESTAMP, status:'waiting', round:0 })
        .then(function(){ location.search='?room='+id; });
    });
  }

  // ---------- join + live updates ----------
  function joinAndListen(){
    db.ref('lobbies/'+roomId).once('value').then(function(s){
      if(!s.exists()){ app.innerHTML='<div class="create-card"><h2 style="margin:0 0 6px">Room not found</h2><p>That lobby doesn’t exist anymore.</p><a class="btn" href="lobby.html">Create a new one</a></div>'; return; }
      var pref=db.ref('lobbies/'+roomId+'/players/'+uid);
      pref.set({ name:myName, avatar:myAvatar||null, joined:firebase.database.ServerValue.TIMESTAMP });
      pref.onDisconnect().remove();
      if(!listening){ listening=true; db.ref('lobbies/'+roomId).on('value',onRoom); }
    });
  }

  function onRoom(snap){
    room=snap.val();
    if(!room){ app.innerHTML=msg('This lobby was closed.'); return; }
    var g=compute();
    // green flash when a new safe reveal arrives (from anyone) — state-driven so re-renders keep it
    if(g.count>prevCount && g.lastMove && g.lastMove.tile!==g.bomb){
      flashUid=g.lastMove.by;
      clearTimeout(flashTimer);
      flashTimer=setTimeout(function(){ flashUid=null; if(room) render(compute()); }, 1000);
    }
    prevCount=g.count;
    render(g);
  }

  // ---------- game state derived from the shared seed + moves ----------
  function compute(){
    var bomb=bombFor(room.seed);
    var keys=room.moves ? Object.keys(room.moves).sort() : [];
    var revealed={}, loser=null, bombHit=false, safe=0, last=null;
    keys.forEach(function(k){ var m=room.moves[k]; revealed[m.tile]=m.by; last=m;
      if(m.tile===bomb){ bombHit=true; loser=m.by; } else safe++; });
    var over=bombHit || safe>=8;
    var order=room.order||[];
    var turnUid=(room.status==='playing' && !over && order.length) ? order[keys.length % order.length] : null;
    return { bomb:bomb, revealed:revealed, loser:loser, bombHit:bombHit, safe:safe, over:over, turnUid:turnUid, count:keys.length, lastMove:last };
  }

  function orderedPlayerIds(){
    var players=room.players||{}, ids;
    if(room.order && room.order.length){ ids=room.order.filter(function(id){ return players[id]; }); }
    else { ids=Object.keys(players); }
    ids.sort(function(a,b){ return (players[a].joined||0)-(players[b].joined||0); });
    Object.keys(players).forEach(function(id){ if(ids.indexOf(id)<0) ids.push(id); });
    return ids;
  }

  // ---------- render ----------
  function render(g){
    var players=room.players||{}, pcount=Object.keys(players).length, isHost=(room.host===uid);
    var invite=location.origin+location.pathname+'?room='+roomId;

    var main='<div class="roombar"><span class="roomcode">Room '+esc(roomId)+'</span><button class="btn sm" id="copyLink">📋 Copy invite link</button></div>';

    if(room.status==='waiting'){
      main+='<div class="lobby-status">Waiting in the lobby — <b>'+pcount+'</b> player'+(pcount===1?'':'s')+' here.</div>';
      if(isHost) main+='<div style="text-align:center">'+(pcount>=2?'<button class="btn" id="startBtn">▶ Start game</button>':'<span style="color:var(--muted);font-size:.85rem">Share the link — need at least 2 players to start.</span>')+'</div>';
      else main+='<div class="lobby-status" style="color:var(--muted)">Waiting for the host to start…</div>';
    } else {
      main+='<div class="lobby-status">'+statusText(g)+'</div>'+ boardHTML(g);
      if(g.over && isHost) main+='<div style="text-align:center"><button class="btn" id="newRound">↻ New round</button></div>';
    }

    var side='<div class="players-h">Players ('+pcount+')</div>'+ orderedPlayerIds().map(function(id){
      var p=players[id], cls='plate', tag='';
      if(g.over && g.loser===id){ cls+=' red'; tag='<span class="ptag">lost 💥</span>'; }
      else if(g.turnUid===id){ cls+=' turn'; tag='<span class="ptag">turn</span>'; }
      if(id===flashUid) cls+=' green';
      return '<div class="'+cls+'" data-pid="'+id+'">'+avatar(p,28)+'<span class="pname">'+esc(p.name||'?')+(id===uid?' (you)':'')+'</span>'+tag+'</div>';
    }).join('');

    app.innerHTML='<div class="lobby"><div class="lobby-main">'+main+'</div><aside class="lobby-side">'+side+'</aside></div>';

    // wire
    var cp=document.getElementById('copyLink');
    if(cp) cp.addEventListener('click',function(){ navigator.clipboard && navigator.clipboard.writeText(invite); cp.textContent='✓ Link copied!'; setTimeout(function(){ cp.textContent='📋 Copy invite link'; },1500); });
    var sb=document.getElementById('startBtn'); if(sb) sb.addEventListener('click',startGame);
    var nr=document.getElementById('newRound'); if(nr) nr.addEventListener('click',startGame);
    Array.prototype.forEach.call(app.querySelectorAll('button.tile'),function(b){ b.addEventListener('click',function(){ onTile(parseInt(b.dataset.i,10)); }); });
  }

  function statusText(g){
    if(g.over){
      if(g.bombHit){ var nm=(room.players[g.loser]&&room.players[g.loser].name)|| (g.loser===uid?'You':'A player'); return '💥 '+esc(nm)+' hit the upside-down donkey! Everyone else survived.'; }
      return '🎉 All 8 donkeys found — everyone survived!';
    }
    if(g.turnUid===uid) return 'Your turn — pick a block.';
    var present=room.players && room.players[g.turnUid];
    var nm=present ? esc(room.players[g.turnUid].name||'Someone') : 'That player left';
    return present ? (nm+'’s turn…') : (nm+' — anyone can go.');
  }

  function boardHTML(g){
    var h='<div class="grid" data-cols="3" style="--cols:3">';
    var present=room.players && room.players[g.turnUid];
    var myTurn=(g.turnUid===uid) || (g.turnUid && !present);   // my turn, or current player left
    for(var i=0;i<9;i++){
      var by=g.revealed[i];
      if(by!==undefined){
        var isBomb=(i===g.bomb);
        h+='<div class="tile flipped"><div class="inner"><div class="face front">'+(i+1)+'</div>'+
           '<div class="face back '+(isBomb?'bomb':'safe')+'"><img src="'+(isBomb?'UpsideDownDonkey.png':'RightSideUpDonkey.png')+'" alt=""></div></div></div>';
      } else {
        var dis=(g.over || !myTurn) ? ' disabled' : '';
        h+='<button class="tile" data-i="'+i+'"'+dis+'><div class="inner"><div class="face front"><span class="lbl heb" dir="auto">'+HEBREW[i]+'</span>'+(g.over||!myTurn?'':'<span class="tap">reveal</span>')+'</div><div class="face back"></div></div></button>';
      }
    }
    return h+'</div>';
  }

  function onTile(i){
    var g=compute();
    if(g.over || (i in g.revealed) || room.status!=='playing') return;
    var present=room.players && room.players[g.turnUid];
    var canClick=(g.turnUid===uid) || (g.turnUid && !present);
    if(!canClick) return;
    db.ref('lobbies/'+roomId+'/moves').push({ tile:i, by:uid, t:firebase.database.ServerValue.TIMESTAMP });
  }

  function startGame(){
    if(room.host!==uid) return;
    var order=Object.keys(room.players||{}).sort(function(a,b){ return (room.players[a].joined||0)-(room.players[b].joined||0); });
    if(order.length<2) return;
    db.ref('lobbies/'+roomId).update({ status:'playing', seed:Math.floor(Math.random()*1e9), order:order, round:(room.round||0)+1, moves:null });
  }

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',boot); else boot();
})();
