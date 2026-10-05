async function loadScripts() {
  const res = await fetch('/api/scripts');
  const scripts = await res.json();
  const list = document.getElementById('script-list');
  list.innerHTML = '';
  for (const s of scripts) {
    const li = document.createElement('li');
    li.className = 'script-item';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'script-open';

    const title = document.createElement('span');
    title.className = 'script-open-title';
    title.textContent = s.title || s.file || 'بدون عنوان';
    btn.appendChild(title);

    const meta = document.createElement('span');
    meta.className = 'script-open-meta';
    const count = faDigits(s.paragraphCount || 0) + ' پاراگراف';
    meta.textContent = s.source === 'manual' ? 'دستی · ' + count : count;
    btn.appendChild(meta);

    btn.addEventListener('click', () => loadScript(s.path));
    li.appendChild(btn);

    if (s.source === 'manual') {
      const edit = document.createElement('a');
      edit.className = 'script-edit';
      edit.href =
        '/script.html?' +
        (s.file ? 'file=' + encodeURIComponent(s.file) : 'path=' + encodeURIComponent(s.path));
      edit.textContent = 'ویرایش';
      edit.title = 'ویرایش متن سناریو';
      edit.addEventListener('click', (e) => e.stopPropagation());
      li.appendChild(edit);
    }

    list.appendChild(li);
  }
}

function faDigits(value) {
  return String(value).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

function setupThemeToggle() {
  const btn = document.getElementById('theme-toggle');
  if (!btn) return;
  function sync() {
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    btn.classList.toggle('on', light);
    btn.setAttribute('aria-checked', light ? 'true' : 'false');
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
    } catch (e) {
      // ignore
    }
    sync();
  });
}

async function loadScript(scriptPath) {
  const res = await fetch('/api/script?path=' + encodeURIComponent(scriptPath));
  const data = await res.json();
  const titleEl = document.getElementById('script-title');
  if (!res.ok || !data || !Array.isArray(data.paragraphs) || !data.paragraphs.length) {
    if (titleEl) {
      titleEl.hidden = false;
      titleEl.textContent = (data && data.error) || 'پاراگرافی توی این سناریو نیست';
    }
    return;
  }
  if (titleEl) {
    titleEl.hidden = true;
    titleEl.textContent = data.title || '';
  }
  if (window.startCaptureSession) {
    window.startCaptureSession(data.slug, data.paragraphs, data.title);
  }
}

setupThemeToggle();
loadScripts().then(() => {
  const openPath = new URLSearchParams(location.search).get('script');
  if (openPath) {
    loadScript(openPath);
    history.replaceState(null, '', '/');
  }
});
