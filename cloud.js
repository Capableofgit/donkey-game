/* Donkey Game — cloud layer (Firebase).
   Optional/additive: if the SDK or network is unavailable, the game still works fully.
   Handles anonymous identity, username, per-mode stats, a mode-aware leaderboard, and profiles. */
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

  var MODE = (window.DG_MODE === 'unlimited' || window.DG_MODE === 'tower') ? window.DG_MODE : 'daily';

  // The game is account-gated: you can't play until you've claimed a username.
  // That means Firebase is required — if it's missing, we show a blocking "can't connect" gate.
  var FB_OK = (typeof firebase !== 'undefined');
  var auth = null, db = null;
  if (FB_OK) {
    try { firebase.initializeApp(CONFIG); auth = firebase.auth(); db = firebase.database(); }
    catch (e) { FB_OK = false; }
  }

  var uid = null, meData = null, usersCache = {}, setupDone = false, lossSeen = {}, pickSeen = {}, lossInit = false, maxPlayers = 0;
  var meLoaded = false, gated = true, gateEl = null, gateState = '';

  // Which stat each mode's leaderboard ranks by.
  var METRIC = {
    daily:     { key:'daily',     label:'Wins',        get:function(s){ return (s && s.wins)       || 0; } },
    unlimited: { key:'unlimited', label:'Best streak', get:function(s){ return (s && s.bestStreak) || 0; } },
    tower:     { key:'tower',     label:'Best level',  get:function(s){ return (s && s.bestLevel)  || 0; } }
  };

  // ---------- small helpers ----------
  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function ready(fn){ if(document.readyState!=='loading') fn(); else document.addEventListener('DOMContentLoaded',fn); }
  function modeTitle(){ return MODE==='daily'?'Daily':MODE==='unlimited'?'Unlimited':'Tower'; }
  function modeName(m){ return m==='unlimited'?'Unlimited':m==='tower'?'Tower':'Daily'; }
  function showToast(text,kind){
    var wrap=document.getElementById('toast-wrap');
    if(!wrap){ wrap=document.createElement('div'); wrap.id='toast-wrap'; document.body.appendChild(wrap); }
    var t=document.createElement('div'); t.className='toast'+(kind?(' '+kind):''); t.textContent=text; wrap.appendChild(t);
    requestAnimationFrame(function(){ t.classList.add('show'); });
    setTimeout(function(){ t.classList.remove('show'); setTimeout(function(){ if(t.parentNode) t.parentNode.removeChild(t); },300); }, 4200);
  }
  function avatarHTML(u,size,cls){
    var st='width:'+size+'px;height:'+size+'px;', c='av'+(cls?(' '+cls):'');
    if(u && u.avatar) return '<img class="'+c+'" style="'+st+'" src="'+u.avatar+'" alt="">';
    var initial=(u && u.name ? u.name.charAt(0) : '?').toUpperCase();
    return '<span class="'+c+'" style="'+st+'font-size:'+Math.round(size*0.5)+'px;">'+esc(initial)+'</span>';
  }

  // ---------- account gate (game is unplayable until a username exists) ----------
  function ensureGate(){ if(gateEl) return gateEl; gateEl=document.createElement('div'); gateEl.className='gate'; gateEl.id='dg-gate'; document.body.appendChild(gateEl); return gateEl; }
  function lockPlay(on){ var p=document.querySelector('.panel'); if(p){ if(on) p.setAttribute('inert',''); else p.removeAttribute('inert'); } }
  function isFull(){ return maxPlayers>0 && namedCount()>=maxPlayers; }
  function renderGateBody(state){
    var g=ensureGate();
    if(state==='offline'){
      g.innerHTML='<div class="gate-card"><div class="gate-emoji">📡</div><h2 class="gate-h">Can’t connect</h2>'+
        '<p class="gate-sub">Donkey Game needs an internet connection so you can sign in and play. Check your connection and refresh.</p></div>';
      return;
    }
    if(state==='connecting'){
      g.innerHTML='<div class="gate-card"><div class="gate-emoji">🫏</div><h2 class="gate-h">Loading…</h2><p class="gate-sub">Connecting you to Donkey Game.</p></div>';
      return;
    }
    if(state==='full'){
      g.innerHTML='<div class="gate-card"><div class="gate-emoji">🔒</div><h2 class="gate-h">Donkey Game is full</h2>'+
        '<p class="gate-sub">All '+maxPlayers+' player slots are taken. Ask the admin to raise the limit or free up a spot, then refresh.</p></div>';
      return;
    }
    g.innerHTML='<div class="gate-card"><div class="gate-emoji">🫏</div>'+
      '<h2 class="gate-h">Create your player</h2>'+
      '<p class="gate-sub">Pick a username to start playing — that’s your account. You can’t play until you do.</p>'+
      '<input id="gateInput" class="field" maxlength="16" placeholder="e.g. Leo" autocomplete="off">'+
      '<div id="gateErr" class="gate-err"></div>'+
      '<button class="btn" id="gateSave" type="button">Enter the game</button></div>';
    var inp=g.querySelector('#gateInput'), btn=g.querySelector('#gateSave');
    if(inp){ inp.value=''; inp.addEventListener('keydown',function(e){ if(e.key==='Enter') gateSave(); }); setTimeout(function(){ inp.focus(); },40); }
    if(btn) btn.addEventListener('click',gateSave);
  }
  function gateSave(){
    var inp=document.getElementById('gateInput'), err=document.getElementById('gateErr'); if(!inp) return;
    var v=(inp.value||'').trim().slice(0,16); if(!v) return;
    if(window.DGBan && DGBan.isBanned(v)){ if(err) err.textContent='🚫 That username is banned.'; return; }
    if(isFull()){ if(err) err.textContent='🔒 Donkey Game is full ('+maxPlayers+' players). Ask the admin for a spot.'; return; }
    if(!uid || !db){ if(err) err.textContent='Still connecting… try again in a second.'; return; }
    db.ref('users/'+uid).update({ name:v, updated:firebase.database.ServerValue.TIMESTAMP });   // meData listener lifts the gate
  }
  function applyGate(){
    ensureGate();
    if(!gated){ gateEl.classList.remove('show'); lockPlay(false); gateState=''; return; }
    var state = !FB_OK ? 'offline' : (!uid || !meLoaded) ? 'connecting' : (isFull() ? 'full' : 'create');
    if(state!==gateState){ gateState=state; renderGateBody(state); }     // avoid clobbering the input on unrelated updates
    gateEl.classList.add('show'); lockPlay(true);
  }

  // ---------- UI elements (injected after the game builds its DOM) ----------
  var idChip, lbEl, modal;
  ready(function(){
    applyGate();                                                        // block play immediately, before auth resolves
    if(!FB_OK) return;                                                  // no SDK: stay on the "can't connect" gate
    var util=document.getElementById('utility');
    idChip=document.createElement('button'); idChip.className='idchip'; idChip.type='button'; idChip.innerHTML='<span>…</span>';
    idChip.addEventListener('click',function(){ if(uid) openProfile(uid); });
    if(util) util.insertBefore(idChip, util.firstChild); else document.body.appendChild(idChip);

    lbEl=document.createElement('div'); lbEl.className='lb';
    var footer=document.querySelector('footer');
    if(footer) document.body.insertBefore(lbEl, footer); else document.body.appendChild(lbEl);

    modal=document.createElement('div'); modal.className='modal'; modal.id='dgModal';
    modal.addEventListener('click',function(e){ if(e.target===modal) closeModal(); });
    document.body.appendChild(modal);

    renderIdentity(); renderLeaderboard();
  });

  // ---------- auth (reuse the persisted anonymous user; only sign in if none) ----------
  if(FB_OK) auth.onAuthStateChanged(function(user){
    if(!user){ auth.signInAnonymously().catch(function(){}); return; }
    uid=user.uid;
    applyGate();
    if(setupDone) return; setupDone=true;
    db.ref('users/'+uid).on('value',function(snap){
      meData=snap.val()||{}; meLoaded=true;
      if(window.DGBan && DGBan.isBanned(meData.name)){ DGBan.block(); return; }
      renderIdentity();
      gated = !(meData && meData.name);                            // no username => game stays locked
      applyGate();
    });
    db.ref('users').on('value',function(snap){
      usersCache=snap.val()||{};
      renderLeaderboard();
      applyGate();                                                // refresh full/create state as players come and go
      if(modal && modal.dataset.openUid) openProfile(modal.dataset.openUid);
      for(var lid in usersCache){                                  // site-wide "picked a square" notifications
        var lu=usersCache[lid];
        var pat=lu && lu.lastPick && lu.lastPick.at;
        if(pat && pickSeen[lid]!==pat){
          if(lossInit && lid!==uid) showToast('👆 '+(lu.name||'Someone')+' picked a square!', 'pick');
          pickSeen[lid]=pat;
        }
      }
      lossInit=true;
    });
    db.ref('bans').on('value',function(snap){                     // admin-managed ban list
      if(window.DGBan) DGBan.setDbBans(snap.val()||{});
      if(meData && window.DGBan && DGBan.isBanned(meData.name)){ DGBan.block(); return; }
      renderLeaderboard();
    }, function(){});                                             // ignore read errors (e.g. before the rules allow it)
    db.ref('config/maxPlayers').on('value',function(snap){        // admin-set cap on total players (0 = unlimited)
      maxPlayers = snap.val() || 0;
      applyGate();
    }, function(){});
  });

  // How many players currently hold a username (what the cap counts).
  function namedCount(){ var n=0; for(var k in usersCache){ if(usersCache[k] && usersCache[k].name) n++; } return n; }

  // ---------- record a finished game (called by game.js) ----------
  window.DGCloud = {
    recordResult: function(p){
      if(!uid || !db) return;
      var ref=db.ref('users/'+uid+'/stats/'+p.mode);
      if(p.mode==='daily'){
        ref.transaction(function(s){
          s=s||{games:0,wins:0,curStreak:0,maxStreak:0,lastDay:null,lastWonDay:null};
          if(s.lastDay!==p.day){ s.games++; s.lastDay=p.day; }    // count each distinct day once
          if(p.won && s.lastWonDay!==p.day){                      // a day counts as won if you win it at all
            s.curStreak=(s.lastWonDay===p.day-1)?(s.curStreak+1):1;   // consecutive-day check
            s.lastWonDay=p.day; s.wins++;
            if(s.curStreak>s.maxStreak) s.maxStreak=s.curStreak;
          }
          return s;                                               // losses/retries don't reset the streak
        });
      } else if(p.mode==='unlimited'){
        ref.transaction(function(s){
          s=s||{games:0,clears:0,curStreak:0,bestStreak:0};
          s.games++;
          if(p.won){ s.clears++; s.curStreak++; if(s.curStreak>s.bestStreak) s.bestStreak=s.curStreak; } else s.curStreak=0;
          return s;
        });
      } else if(p.mode==='tower'){
        ref.transaction(function(s){
          s=s||{games:0,bestLevel:0,champions:0};
          s.games++;
          if(p.level>(s.bestLevel||0)) s.bestLevel=p.level;
          if(p.champion) s.champions=(s.champions||0)+1;
          return s;
        });
      }
      db.ref('users/'+uid+'/updated').set(firebase.database.ServerValue.TIMESTAMP);
    },
    pick: function(mode){                                       // broadcast a safe reveal (never which square)
      if(!uid || !db) return;
      db.ref('users/'+uid+'/lastPick').set({ mode:mode, at:firebase.database.ServerValue.TIMESTAMP });
    }
  };

  // ---------- identity chip ----------
  function renderIdentity(){ if(!idChip) return;
    idChip.innerHTML = avatarHTML(meData,22) + '<span>'+ esc(meData && meData.name ? meData.name : 'Set name') +'</span>';
  }

  function promptUsername(){
    openModalHTML(
      '<h2>👋 Pick a username</h2><p class="modal-sub">It shows on the leaderboard and your profile.</p>'+
      '<input id="unameInput" class="field" maxlength="16" placeholder="e.g. Leo" autocomplete="off">'+
      '<div id="unameErr" style="color:#e7727b;font-size:.82rem;margin:-8px 0 12px;min-height:1.1em"></div>'+
      '<button class="btn" id="unameSave">Let’s play</button>'
    );
    var inp=document.getElementById('unameInput'); if(inp){ inp.value=(meData&&meData.name)||''; inp.focus(); }
    function save(){ var v=(inp.value||'').trim().slice(0,16); if(!v) return;
      if(window.DGBan && DGBan.isBanned(v)){ document.getElementById('unameErr').textContent='🚫 That username is banned.'; return; }
      var iHaveName = !!(meData && meData.name);                                   // existing players may always rename
      if(!iHaveName && maxPlayers>0 && namedCount()>=maxPlayers){
        document.getElementById('unameErr').textContent='🔒 Donkey Game is full ('+maxPlayers+' players). Ask the admin for a spot.'; return;
      }
      db.ref('users/'+uid).update({ name:v, updated:firebase.database.ServerValue.TIMESTAMP }); closeModal(); }
    document.getElementById('unameSave').addEventListener('click',save);
    if(inp) inp.addEventListener('keydown',function(e){ if(e.key==='Enter') save(); });
  }

  // ---------- leaderboard (mode-aware) ----------
  var MEDAL=['🏆','🥈','🥉'], MEDALCLS=['gold','silver','bronze'];
  function lbRows(){
    var m=METRIC[MODE], rows=[];
    for(var id in usersCache){ var u=usersCache[id]; if(!u || !u.name) continue;
      if(window.DGBan && DGBan.isBanned(u.name)) continue;
      rows.push({ id:id, name:u.name, avatar:u.avatar, val:m.get(u.stats && u.stats[m.key]) }); }
    rows.sort(function(a,b){ return (b.val-a.val) || a.name.localeCompare(b.name); });
    return rows;
  }
  function rankOf(id){ var r=lbRows(); for(var i=0;i<r.length;i++){ if(r[i].id===id) return i; } return -1; }

  function renderLeaderboard(){
    if(!lbEl) return;
    var m=METRIC[MODE], rows=lbRows();
    var html='<h3 class="lb-title">🏆 Leaderboard <span>· '+m.label+' · '+modeTitle()+'</span></h3>';
    if(!rows.length){ html+='<div class="lb-empty">No players yet — be the first!</div>'; }
    else {
      html+='<div class="lb-list">';
      rows.forEach(function(r,i){
        var medal = i<3 ? MEDAL[i]+' ' : '';
        var glow  = i<3 ? ' '+MEDALCLS[i] : '';
        html+='<div class="lb-row'+(r.id===uid?' me':'')+'" data-uid="'+r.id+'">'+
          '<span class="lb-rank">'+(i+1)+'</span>'+ avatarHTML(r,26) +
          '<span class="lb-name'+glow+'">'+medal+esc(r.name)+'</span>'+
          '<span class="lb-val">'+r.val+'</span></div>';
      });
      html+='</div>';
    }
    lbEl.innerHTML=html;
    Array.prototype.forEach.call(lbEl.querySelectorAll('.lb-row'),function(row){
      row.addEventListener('click',function(){ openProfile(row.dataset.uid); });
    });
  }

  // ---------- profile ----------
  function openProfile(id){
    var u = usersCache[id] || (id===uid ? meData : null); if(!u) return;
    var s=u.stats||{}, d=s.daily||{}, un=s.unlimited||{}, tw=s.tower||{}, isMe=(id===uid);
    var rank=rankOf(id), medal=(rank>=0&&rank<3)?MEDAL[rank]+' ':'', glowCls=(rank>=0&&rank<3)?' '+MEDALCLS[rank]:'';
    var html='<button class="modal-x" id="modalX" aria-label="Close">✕</button>'+
      '<div class="prof-head">'+ avatarHTML(u,84,'prof-av') +
        '<div class="prof-name'+glowCls+'">'+medal+esc(u.name||'Player')+(isMe?' <span class="you">(you)</span>':'')+'</div></div>'+
      (isMe ? '<div class="prof-actions"><label class="btn sm">Change photo<input type="file" id="avFile" accept="image/*" hidden></label><button class="btn sm" id="editName">Edit name</button></div>' : '')+
      '<div class="prof-stats">'+
        statBlock('Daily',[['Max streak',d.maxStreak||0],['Current streak',d.curStreak||0],['Wins',d.wins||0],['Played',d.games||0]])+
        statBlock('Unlimited',[['Best streak',un.bestStreak||0],['Clears',un.clears||0],['Played',un.games||0]])+
      '</div>';
    openModalHTML(html);
    modal.dataset.openUid=id;
    document.getElementById('modalX').addEventListener('click',closeModal);
    if(isMe){
      var f=document.getElementById('avFile'); if(f) f.addEventListener('change',onAvatar);
      var en=document.getElementById('editName'); if(en) en.addEventListener('click',promptUsername);
    }
  }
  function statBlock(title,rows){
    var h='<div class="sb"><div class="sb-t">'+title+'</div>';
    rows.forEach(function(r){ h+='<div class="sb-r"><span>'+r[0]+'</span><b>'+r[1]+'</b></div>'; });
    return h+'</div>';
  }

  function onAvatar(e){
    var file=e.target.files && e.target.files[0]; if(!file) return;
    var rd=new FileReader();
    rd.onload=function(){
      var img=new Image();
      img.onload=function(){
        var size=96, c=document.createElement('canvas'); c.width=c.height=size; var ctx=c.getContext('2d');
        var side=Math.min(img.width,img.height), sx=(img.width-side)/2, sy=(img.height-side)/2;
        ctx.drawImage(img,sx,sy,side,side,0,0,size,size);
        var data=c.toDataURL('image/jpeg',0.82);
        db.ref('users/'+uid).update({ avatar:data, updated:firebase.database.ServerValue.TIMESTAMP });
      };
      img.src=rd.result;
    };
    rd.readAsDataURL(file);
  }

  // ---------- modal helpers ----------
  function openModalHTML(html){ if(!modal) return; modal.innerHTML='<div class="modal-card">'+html+'</div>'; modal.dataset.openUid=''; modal.classList.add('show'); }
  function closeModal(){ if(!modal) return; modal.classList.remove('show'); modal.innerHTML=''; modal.dataset.openUid=''; }
})();
