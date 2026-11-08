// Applies the saved theme before first paint to avoid a flash. (External file: the CSP forbids inline scripts.)
try {
  var t = localStorage.getItem('whatif.theme');
  if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
} catch (e) {}
