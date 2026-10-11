(function () {
  if (window.parent && window.parent !== window) {
    document.addEventListener('click', (event) => {
      const link = event.target && event.target.closest ? event.target.closest('a[href]') : null;
      if (!link || link.target === '_blank') return;
      let url;
      try {
        url = new URL(link.href, location.href);
      } catch (err) {
        return;
      }
      if (url.origin !== location.origin) return;
      if (url.pathname !== '/' && !url.pathname.endsWith('/index.html')) return;
      event.preventDefault();
      event.stopPropagation();
      window.parent.postMessage({ reel: 'close-browse' }, location.origin);
    }, true);
  }
  const nav = document.querySelector('.site-nav');
  const layer = document.getElementById('settings-layer');
  const homeLink = document.querySelector('[data-nav="home"]');
  const settingsLink = document.getElementById('nav-settings');

  function mark(key) {
    if (!nav) return;
    nav.querySelectorAll('[data-nav]').forEach((el) => {
      el.classList.toggle('on', el.getAttribute('data-nav') === key);
    });
  }

  function pageKey() {
    const path = location.pathname;
    if (path.indexOf('scenarios') !== -1) return 'scenarios';
    if (path.indexOf('archive') !== -1) return 'archive';
    if (path.indexOf('help') !== -1) return 'help';
    if (path.indexOf('about') !== -1) return 'about';
    if (path === '/' || path.endsWith('index.html')) return 'home';
    return '';
  }

  mark(pageKey());

  function setTab(name) {
    document.querySelectorAll('[data-settings-tab]').forEach((btn) => {
      btn.classList.toggle('on', btn.getAttribute('data-settings-tab') === name);
    });
    const rec = document.getElementById('settings-rec');
    const look = document.getElementById('settings-look');
    if (rec) rec.hidden = name !== 'rec';
    if (look) look.hidden = name !== 'look';
  }

  function placePreview(intoSettings) {
    const frame = document.querySelector('.stage-frame');
    const slot = document.getElementById('settings-stage');
    const home = document.getElementById('stage-home');
    if (!frame || !slot || !home) return;
    const target = intoSettings ? slot : home;
    if (frame.parentElement !== target) target.appendChild(frame);
  }

  function openSettings() {
    if (!layer) return;
    placePreview(true);
    layer.hidden = false;
    document.body.classList.add('settings-open');
    mark('settings');
    if (location.search.indexOf('settings=1') === -1) {
      history.replaceState(null, '', '/?settings=1');
    }
  }

  function closeSettings() {
    if (!layer) return;
    placePreview(false);
    layer.hidden = true;
    document.body.classList.remove('settings-open');
    mark('home');
    if (location.search.indexOf('settings=1') !== -1) history.replaceState(null, '', '/');
  }

  if (settingsLink && layer) {
    settingsLink.addEventListener('click', (event) => {
      event.preventDefault();
      if (!layer.hidden) closeSettings();
      else openSettings();
    });
  }

  if (homeLink && layer) {
    homeLink.addEventListener('click', (event) => {
      const path = location.pathname;
      if (path === '/' || path.endsWith('index.html')) {
        event.preventDefault();
        closeSettings();
      }
    });
  }

  document.querySelectorAll('[data-settings-tab]').forEach((btn) => {
    btn.addEventListener('click', () => setTab(btn.getAttribute('data-settings-tab')));
  });

  if (layer && new URLSearchParams(location.search).get('settings') === '1') openSettings();

  window.__reelShell = {
    openSettings: openSettings,
    closeSettings: closeSettings,
  };

  function syncScale() {
    const current = document.documentElement.getAttribute('data-ui') || 'md';
    document.querySelectorAll('[data-ui-pick]').forEach((btn) => {
      btn.classList.toggle('on', btn.getAttribute('data-ui-pick') === current);
    });
  }

  syncScale();
  document.querySelectorAll('[data-ui-pick]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const value = btn.getAttribute('data-ui-pick');
      if (!value || value === 'md') document.documentElement.removeAttribute('data-ui');
      else document.documentElement.setAttribute('data-ui', value);
      try {
        localStorage.setItem('reel.uiScale', value || 'md');
      } catch (err) {}
      syncScale();
    });
  });

})();
