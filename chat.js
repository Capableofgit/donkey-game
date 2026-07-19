/* Donkey Game — global chat (bottom-right).
   Additive: reuses the Firebase app initialised by cloud.js. If Firebase/network is
   missing, the widget simply never appears and the game plays on. All players share
   one room at /chat; messages are capped and self-authored (see security rules). */
(function(){
  "use strict";

  if(typeof firebase==='undefined' || !firebase.apps || !firebase.apps.length) return;  // cloud.js didn't init — no chat
  var db, auth;
  try{ db=firebase.database(); auth=firebase.auth(); }catch(e){ return; }

  var MAX=60, LIMIT=300;
  var uid=null, myName='', open=false, unread=0, inited=false, msgs=[];
  var fab, badge, panel, log, input, sendBtn;

  function esc(s){ return String(s==null?'':s).replace(/[&<>"]/g,function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  function banned(){ return !!(window.DGBan && DGBan.isBanned(myName)); }
  function hhmm(ts){ var d=new Date(ts||Date.now()); function p(n){ return (n<10?'0':'')+n; } return p(d.getHours())+':'+p(d.getMinutes()); }
  function ready(fn){ if(document.readyState!=='loading') fn(); else document.addEventListener('DOMContentLoaded',fn); }

  ready(build);

  function build(){
    fab=document.createElement('button');
    fab.type='button'; fab.className='chat-fab'; fab.setAttribute('aria-label','Chat');
    fab.innerHTML='💬<span class="chat-badge">0</span>';
    badge=fab.querySelector('.chat-badge');
    fab.addEventListener('click',toggle);

    panel=document.createElement('div'); panel.className='chat-panel';
    panel.innerHTML=
      '<div class="chat-head"><span class="chat-dot"></span><span class="chat-title">Donkey Chat</span>'+
        '<button class="chat-close" type="button" aria-label="Close">✕</button></div>'+
      '<div class="chat-log" id="chatLog"></div>'+
      '<div class="chat-foot">'+
        '<textarea class="chat-input" id="chatInput" rows="1" maxlength="'+LIMIT+'" placeholder="Message everyone…"></textarea>'+
        '<button class="chat-send" id="chatSend" type="button" aria-label="Send">➤</button>'+
      '</div>';
    document.body.appendChild(panel);
    document.body.appendChild(fab);

    log=panel.querySelector('#chatLog');
    input=panel.querySelector('#chatInput');
    sendBtn=panel.querySelector('#chatSend');
    panel.querySelector('.chat-close').addEventListener('click',toggle);
    sendBtn.addEventListener('click',send);
    input.addEventListener('keydown',function(e){ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); } });
    input.addEventListener('input',function(){ sendBtn.disabled=!input.value.trim(); autoGrow(); });
    sendBtn.disabled=true;

    subscribe();
    render();
  }

  function autoGrow(){ input.style.height='auto'; input.style.height=Math.min(90,input.rows>0?input.scrollHeight:0)+'px'; }

  function subscribe(){
    auth.onAuthStateChanged(function(u){
      if(!u) return; uid=u.uid;
      db.ref('users/'+uid+'/name').on('value',function(s){ myName=s.val()||''; render(); });
    });
    db.ref('chat').limitToLast(MAX).on('value',function(s){
      var v=s.val()||{}, arr=[];
      for(var k in v){ var m=v[k]; if(m && m.text){ arr.push(m); } }
      arr.sort(function(a,b){ return (a.at||0)-(b.at||0); });
      var grew=arr.length>msgs.length;
      var newest=arr.length?arr[arr.length-1]:null;
      msgs=arr;
      render();
      if(inited && grew && newest && newest.uid!==uid && !open){ unread++; renderBadge(); }
      if(open) scrollDown();
      inited=true;
    }, function(){});
  }

  function toggle(){
    open=!open;
    panel.classList.toggle('open',open);
    if(open){ unread=0; renderBadge(); scrollDown(); if(!banned()) setTimeout(function(){ input.focus(); },60); }
  }

  function send(){
    if(banned() || !uid) return;
    var text=(input.value||'').trim().slice(0,LIMIT);
    if(!text) return;
    var name=myName || 'Anonymous';
    db.ref('chat').push({ uid:uid, name:name, text:text, at:firebase.database.ServerValue.TIMESTAMP });
    input.value=''; sendBtn.disabled=true; autoGrow(); input.focus();
  }

  function renderBadge(){
    if(!fab) return;
    fab.classList.toggle('has-unread',unread>0);
    badge.textContent=unread>9?'9+':String(unread);
  }

  function render(){
    if(!log) return;
    renderBadge();
    if(!msgs.length){ log.innerHTML='<div class="chat-empty">No messages yet.<br>Say hi to the other players! 👋</div>'; return; }
    log.innerHTML=msgs.map(function(m){
      var mine=(m.uid===uid);
      return '<div class="chat-msg'+(mine?' mine':'')+'">'+
        '<div class="chat-meta">'+esc(m.name||'Anonymous')+' · '+hhmm(m.at)+'</div>'+
        '<div class="chat-bubble">'+esc(m.text)+'</div></div>';
    }).join('');
    if(open) scrollDown();
  }

  function scrollDown(){ if(log) requestAnimationFrame(function(){ log.scrollTop=log.scrollHeight; }); }
})();
