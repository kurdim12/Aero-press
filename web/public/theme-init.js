// Applies the saved theme before first paint (kept external so the CSP can forbid inline scripts).
(function () {
  var pref = null;
  try {
    pref = localStorage.getItem('ap-theme');
  } catch (e) {}
  var dark = pref === 'dark' || (pref !== 'light' && window.matchMedia('(prefers-color-scheme: dark)').matches);
  if (pref === 'light' || pref === 'dark') document.documentElement.setAttribute('data-theme', pref);
  var meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', dark ? '#0C1412' : '#E8ECEA');
})();
