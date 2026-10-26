/* Shared site script. Load in <head> (not deferred) so Christmas items are
   hidden before the page paints.

   Christmas season: 1 October to 21 December inclusive, Sydney time, every
   year. Outside it, anything marked data-xmas is hidden. Preview either
   state with ?xmas=on or ?xmas=off on any page. */
(function(){
  function inXmasSeason(){
    var q = /[?&]xmas=(on|off)/.exec(location.search);
    if (q) return q[1] === 'on';
    var m, d;
    try {
      var parts = new Intl.DateTimeFormat('en-AU', { timeZone:'Australia/Sydney', month:'numeric', day:'numeric' }).formatToParts(new Date());
      parts.forEach(function(p){ if (p.type === 'month') m = +p.value; if (p.type === 'day') d = +p.value; });
    } catch (e) {}
    if (!m) { var now = new Date(); m = now.getMonth() + 1; d = now.getDate(); }
    return m === 10 || m === 11 || (m === 12 && d <= 21);
  }
  if (!inXmasSeason()) document.documentElement.classList.add('xmas-off');

  // Functions dropdown: the arrow button opens it (tap on mobile, keyboard
  // anywhere). Hover opens it on desktop via CSS.
  document.addEventListener('click', function(e){
    var btn = e.target.closest && e.target.closest('.sub-toggle');
    document.querySelectorAll('.has-sub.open').forEach(function(li){
      if (!btn || li !== btn.parentNode) { li.classList.remove('open'); li.querySelector('.sub-toggle').setAttribute('aria-expanded', 'false'); }
    });
    if (btn) {
      var li = btn.parentNode, open = li.classList.toggle('open');
      btn.setAttribute('aria-expanded', open);
    }
  });
  document.addEventListener('keydown', function(e){
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.has-sub.open').forEach(function(li){ li.classList.remove('open'); li.querySelector('.sub-toggle').setAttribute('aria-expanded', 'false'); });
  });
})();
