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

  if (typeof firebase === 'undefined') { return; }                  // SDK didn't load — skip cloud, game still runs
  var auth, db;
  try { firebase.initializeApp(CONFIG); auth = firebase.auth(); db = firebase.database(); }
  catch (e) { return; }

  var uid = null, meData = null, usersCache = {}, setupDone = false;

  // Which stat each mode's leaderboard ranks by.
  var METRIC = {
    daily:     { key:'daily',     label:'Max streak',  get:function(s){ return (s && s.maxStreak)  || 0; } },
    unlimited: { key:'unlimited', label:'Best streak', get:function(s){ return (s && s.bestStreak) || 0; } },
    tower:     { key:'tower',     label:'Best level',  get:function(s){ return (s && s.bestLevel)  || 0; } }
  };

  // ---------- small helpers ----------
  function esc(s){ return String(s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function ready(fn){ if(document.readyState!=='loading') fn(); else document.addEventListener('DOMContentLoaded',fn); }
  function modeTitle(){ return MODE==='daily'?'Daily':MODE==='unlimited'?'Unlimited':'Tower'; }
  function avatarHTML(u,size,cls){
    var st='width:'+size+'px;height:'+size+'px;', c='av'+(cls?(' '+cls):'');
    if(u && u.avatar) return '<img class="'+c+'" style="'+st+'" src="'+u.avatar+'" alt="">';
    var initial=(u && u.name ? u.name.charAt(0) : '?').toUpperCase();
    return '<span class="'+c+'" style="'+st+'font-size:'+Math.round(size*0.5)+'px;">'+esc(initial)+'</span>';
  }

  // ---------- UI elements (injected after the game builds its DOM) ----------
  var idChip, lbEl, modal;
  ready(function(){
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
  auth.onAuthStateChanged(function(user){
    if(!user){ auth.signInAnonymously().catch(function(){}); return; }
    uid=user.uid;
    if(setupDone) return; setupDone=true;
    db.ref('users/'+uid).on('value',function(snap){
      meData=snap.val()||{};
      if(window.DGBan && DGBan.isBanned(meData.name)){ DGBan.block(); return; }
      renderIdentity();
      if(!meData.name && modal && !modal.classList.contains('show')) promptUsername();
    });
    db.ref('users').on('value',function(snap){
      usersCache=snap.val()||{};
      renderLeaderboard();
      if(modal && modal.dataset.openUid) openProfile(modal.dataset.openUid);
    });
  });

  // ---------- record a finished game (called by game.js) ----------
  window.DGCloud = {
    recordResult: function(p){
      if(!uid || !db) return;
      var ref=db.ref('users/'+uid+'/stats/'+p.mode);
      if(p.mode==='daily'){
        ref.transaction(function(s){
          s=s||{games:0,wins:0,curStreak:0,maxStreak:0,lastDay:null,lastWonDay:null};
          if(s.lastDay===p.day) return s;                 // only the first attempt of the day counts
          s.games++;
          if(p.won){ s.curStreak=(s.lastWonDay===p.day-1)?(s.curStreak+1):1; s.lastWonDay=p.day; s.wins++; if(s.curStreak>s.maxStreak) s.maxStreak=s.curStreak; }
          else { s.curStreak=0; }
          s.lastDay=p.day; return s;
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
        statBlock('Tower',[['Best level',(tw.bestLevel||0)+' / 5'],['Champion runs',tw.champions||0],['Played',tw.games||0]])+
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
