(function () {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  function sync() {
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    btn.classList.toggle('on', light);
    btn.setAttribute('aria-label', light ? 'حالت تیره' : 'حالت روشن');
    btn.title = light ? 'حالت تیره' : 'حالت روشن';
  }
  sync();
  btn.addEventListener('click', () => {
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    if (light) document.documentElement.removeAttribute('data-theme');
    else document.documentElement.setAttribute('data-theme', 'light');
    try {
      localStorage.setItem('reel.theme', light ? 'dark' : 'light');
    } catch (e) {}
    sync();
  });
})();
