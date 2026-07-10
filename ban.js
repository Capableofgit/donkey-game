/* Central username ban list for the Donkey Game.
   Loaded on every page before cloud.js / lobby.js. Because the game uses anonymous
   identities (no real accounts), this is a client-side username ban: banned names
   can't be set, and anyone already using one is locked out. */
(function(){
  "use strict";

  var BANNED = ['tomishere'];                                  // normalized form: lowercase, letters/digits only

  function norm(s){ return String(s==null?'':s).toLowerCase().replace(/[^a-z0-9]/g,''); }
  function isBanned(name){
    var n = norm(name); if(!n) return false;
    return BANNED.some(function(b){ return n.indexOf(b) !== -1; });
  }

  function block(){
    if(document.getElementById('dg-ban')) return;
    var o = document.createElement('div');
    o.id = 'dg-ban';
    o.style.cssText = 'position:fixed;inset:0;z-index:100000;background:#0e0e0f;color:#f5f5f7;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:24px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;';
    o.innerHTML =
      '<div style="font-size:3rem;margin-bottom:12px">🚫🫏</div>'+
      '<h1 style="margin:0 0 8px;font-size:1.6rem;font-weight:800">You’re banned</h1>'+
      '<p style="color:#9197a0;max-width:340px;line-height:1.5;margin:0">Tomishere is not allowed to play the Donkey Game.</p>';
    if(document.body) document.body.appendChild(o);
    else document.addEventListener('DOMContentLoaded', function(){ document.body.appendChild(o); });
  }

  window.DGBan = { isBanned: isBanned, block: block };
})();
