/* Donkey Game — private admin panel.
   Sign in with the email/password admin account; only the admin UID gets in.
   Manage players: ban/unban (by username), reset stats, delete. */
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
  var ADMIN_UID = "lVNektpa4GZES8hQw0B6RrKZGTl2";

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function norm(s){ return String(s==null?'':s).toLowerCase().replace(/[^a-z0-9]/g,''); }
  function avatarHTML(u,size){
    var st='width:'+size+'px;height:'+size+'px;';
    if(u && u.avatar) return '<img class="av" style="'+st+'" src="'+u.avatar+'" alt="">';
    var i=(u && u.name ? u.name.charAt(0) : '?').toUpperCase();
    return '<span class="av" style="'+st+'font-size:'+Math.round(size*0.5)+'px;">'+esc(i)+'</span>';
  }

  if(typeof firebase==='undefined'){ document.body.innerHTML='<p style="color:#fff;text-align:center;margin-top:40px">Admin panel needs an internet connection.</p>'; return; }
  try{ if(!firebase.apps || !firebase.apps.length) firebase.initializeApp(CONFIG); }catch(e){}
  var auth=firebase.auth(), db=firebase.database();

  var app, users={}, bans={}, started=false;

  function build(){
    document.body.innerHTML =
      '<header><h1 class="title"><span class="emoji">🫏</span><span class="ttext">Admin</span></h1><div class="puzzle-no">Donkey Game control panel</div></header>'+
      '<div id="app"></div>'+
      '<footer>Vibecoded by Leo</footer>';
    app=document.getElementById('app');
  }

  function loginScreen(err){
    app.innerHTML='<div class="create-card"><h2 style="margin:0 0 10px">🔐 Admin login</h2>'+
      (err?'<p style="color:#e7727b;margin:0 0 12px">'+esc(err)+'</p>':'')+
      '<input id="email" class="field" type="email" placeholder="Admin email" autocomplete="username">'+
      '<input id="pass" class="field" type="password" placeholder="Password" autocomplete="current-password">'+
      '<button class="btn" id="loginBtn">Sign in</button></div>';
    document.getElementById('loginBtn').addEventListener('click',doLogin);
    document.getElementById('pass').addEventListener('keydown',function(e){ if(e.key==='Enter') doLogin(); });
    document.getElementById('email').focus();
  }
  function doLogin(){
    var email=(document.getElementById('email').value||'').trim(), pass=document.getElementById('pass').value||'';
    if(!email||!pass) return;
    auth.signInWithEmailAndPassword(email,pass).catch(function(e){ loginScreen((e&&e.message)||'Sign-in failed.'); });
  }
  function deniedScreen(){
    app.innerHTML='<div class="create-card"><h2 style="margin:0 0 8px">🚫 Access denied</h2>'+
      '<p style="margin:0 0 14px;color:var(--muted)">This account isn’t the admin.</p>'+
      '<button class="btn" id="out">Sign out</button></div>';
    document.getElementById('out').addEventListener('click',function(){ auth.signOut(); });
  }

  function startPanel(){
    if(started) return; started=true;
    db.ref('users').on('value',function(s){ users=s.val()||{}; render(); });
    db.ref('bans').on('value',function(s){ bans=s.val()||{}; render(); });
  }
  function stopPanel(){ if(started){ db.ref('users').off(); db.ref('bans').off(); started=false; } }

  function render(){
    if(!app) return;
    var ids=Object.keys(users).sort(function(a,b){ return ((users[a].name||'~').toLowerCase()).localeCompare((users[b].name||'~').toLowerCase()); });
    var rows=ids.map(function(id){
      var u=users[id]||{}, banned=!!(u.name && bans[norm(u.name)]);
      var st=u.stats||{}, d=st.daily||{}, un=st.unlimited||{}, tw=st.tower||{};
      return '<div class="adm-row'+(banned?' banned':'')+'">'+ avatarHTML(u,34) +
        '<div class="adm-info"><div class="adm-name">'+esc(u.name||'(no name)')+(banned?' <span class="adm-tag">BANNED</span>':'')+'</div>'+
        '<div class="adm-sub">Daily '+(d.maxStreak||0)+' · Unl '+(un.bestStreak||0)+' · Tower '+(tw.bestLevel||0)+'/5 · '+esc(id.slice(0,6))+'…</div></div>'+
        '<div class="adm-act">'+
          (banned ? '<button class="btn sm" data-unban="'+esc(norm(u.name))+'">Unban</button>'
                  : '<button class="btn sm danger" data-ban="'+esc(id)+'">Ban</button>')+
          '<button class="btn sm" data-reset="'+esc(id)+'">Reset</button>'+
          '<button class="btn sm danger" data-del="'+esc(id)+'">Delete</button>'+
        '</div></div>';
    }).join('');

    var banKeys=Object.keys(bans);
    var banRows=banKeys.map(function(k){
      var name=(bans[k]&&bans[k].name)||k;
      return '<div class="adm-row"><div class="adm-info"><div class="adm-name">'+esc(name)+'</div><div class="adm-sub">'+esc(k)+'</div></div>'+
        '<div class="adm-act"><button class="btn sm" data-unban="'+esc(k)+'">Unban</button></div></div>';
    }).join('');

    app.innerHTML=
      '<div class="adm-bar"><span class="adm-you">Signed in as admin</span><button class="btn sm" id="signout">Sign out</button></div>'+
      '<h3 class="adm-h">Players ('+ids.length+')</h3>'+
      (rows || '<p class="adm-empty">No players yet.</p>')+
      '<h3 class="adm-h">Banned names ('+banKeys.length+')</h3>'+
      (banRows || '<p class="adm-empty">Nobody is banned.</p>');
    wire();
  }

  function wire(){
    document.getElementById('signout').addEventListener('click',function(){ auth.signOut(); });
    each('[data-ban]', function(b){ var id=b.getAttribute('data-ban'), u=users[id]||{};
      if(!u.name){ alert('This player has no username to ban.'); return; }
      if(confirm('Ban "'+u.name+'"? They won’t be able to play under that name.'))
        db.ref('bans/'+norm(u.name)).set({ name:u.name, at:firebase.database.ServerValue.TIMESTAMP });
    });
    each('[data-unban]', function(b){ db.ref('bans/'+b.getAttribute('data-unban')).remove(); });
    each('[data-reset]', function(b){ var id=b.getAttribute('data-reset'), u=users[id]||{};
      if(confirm('Reset all stats for "'+(u.name||id)+'"?')) db.ref('users/'+id+'/stats').remove();
    });
    each('[data-del]', function(b){ var id=b.getAttribute('data-del'), u=users[id]||{};
      if(confirm('DELETE "'+(u.name||id)+'" completely? This removes their profile and stats.')) db.ref('users/'+id).remove();
    });
  }
  function each(sel, handler){ Array.prototype.forEach.call(app.querySelectorAll(sel), function(el){ el.addEventListener('click', function(){ handler(el); }); }); }

  auth.onAuthStateChanged(function(user){
    if(!app) build();
    if(user && user.uid===ADMIN_UID){ startPanel(); return; }
    stopPanel();
    loginScreen();     // no user, or a non-admin session: show the admin sign-in form
  });

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',build); else build();
})();
