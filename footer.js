/* Appends a small random line under the footer, re-picked on every page load. */
(function(){
  "use strict";
  var lines = [
    "Credit to Tomishere for the donkey.",
    "Wishlist Tingbase on Steam now!",
    "ROOOOOOOOOAAAAAAAAAAAAAARRRRRRRRRRRRRRRR",
    "אני לא ידעתי אמר הזחל שלי בהיריון ויש לה בעל",
    '"לא משנה מה יש בקנקן, אלא מה שיש בתוכו" - Socrates',
    "Kar98 tananana~",
    "TomTaylor3D specializes in 3D car renders and animations",
    "Hovav, ring ding ding ding ding ding ding ding",
    "Mama love me long time long time",
    "מזל טוב!!!",
    "Oooo mamacita!",
    "don't you NOOOOOOOOOTICE HOOOOOOOOOOOW",
    "Hovav Neeman",
    "Naor Hyames",
    "Aaron Missim",
    "Tommy Share",
    "תעשה ריפרש",
    "שתוק שתוק",
    "יאללה שלח את החמורים לפני שאני ארגיש",
    "ניב מכור לסמים",
    "ליאו מכור להימורים",
    "תום לא מכור לכלום",
    "Evil Eizik",
    "I will NOT be playing Human Fall Flat",
    "Hey, just wondering if you got your photos printed? bogos binted? What? 👽",
    "Zinky zoogle, zeekybooble beeble meep Forp Bogos Binted? Photos printed. Vorp? 🙍‍♂️"
  ];
  function add(){
    var f = document.querySelector('footer');
    if(!f){ return setTimeout(add, 50); }                 // footer is built by game.js/lobby.js — wait if needed
    if(f.querySelector('.footer-sub')) return;            // already added
    var d = document.createElement('div');
    d.className = 'footer-sub';
    d.setAttribute('dir', 'auto');                        // render Hebrew lines right-to-left automatically
    d.textContent = lines[Math.floor(Math.random()*lines.length)];
    f.appendChild(d);
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', add); else add();
})();
