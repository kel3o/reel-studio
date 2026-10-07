let allScripts = [];

function normalizeSearch(value) {
  return String(value || '')
    .replace(/[\u064B-\u065F\u0670\u200C\u200F*]/g, '')
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

async function loadScripts() {
  const res = await fetch('/api/scripts');
  const scripts = await res.json();
  allScripts = Array.isArray(scripts) ? scripts.filter((s) => !s.archived) : [];
  allScripts.forEach((s) => {
    s.searchKey = normalizeSearch((s.title || '') + ' ' + (s.text || ''));
  });
  renderPickList();
}

function renderPickList() {
  const list = document.getElementById('scenario-pick-list');
  const empty = document.getElementById('scenario-pick-empty');
  const search = document.getElementById('scenario-search');
  if (!list) return;
  const query = normalizeSearch(search ? search.value : '');
  const scripts = query ? allScripts.filter((s) => s.searchKey.includes(query)) : allScripts;
  list.innerHTML = '';
  if (empty) {
    empty.hidden = scripts.length > 0;
    empty.textContent = allScripts.length ? 'چیزی پیدا نشد' : 'هنوز سناریویی نیست. یکی اضافه کن.';
  }
  for (const s of scripts) {
    const li = document.createElement('li');
    li.className = 'script-item';

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'script-open';
    btn.dataset.path = s.path;

    const title = document.createElement('span');
    title.className = 'script-open-title';
    title.textContent = s.title || s.file || 'بدون عنوان';
    btn.appendChild(title);

    const meta = document.createElement('span');
    meta.className = 'script-open-meta';
    const count = faDigits(s.paragraphCount || 0) + ' پاراگراف';
    meta.textContent = s.source === 'manual' ? 'دستی · ' + count : count;
    btn.appendChild(meta);

    btn.addEventListener('click', () => {
      closePicker();
      loadScript(s.path);
    });
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

function openPicker() {
  const layer = document.getElementById('scenario-picker');
  const search = document.getElementById('scenario-search');
  if (!layer) return;
  layer.hidden = false;
  document.body.classList.add('picker-open');
  if (search) {
    search.value = '';
    renderPickList();
    setTimeout(() => search.focus(), 0);
  }
  loadScripts().catch(() => {});
}

function closePicker() {
  const layer = document.getElementById('scenario-picker');
  if (!layer || layer.hidden) return;
  layer.hidden = true;
  document.body.classList.remove('picker-open');
}

function setupRecordButtons() {
  const free = document.getElementById('rec-free');
  const fromScript = document.getElementById('rec-script');
  const layer = document.getElementById('scenario-picker');
  const closeBtn = document.getElementById('scenario-picker-close');
  const search = document.getElementById('scenario-search');
  if (free) {
    free.addEventListener('click', () => {
      if (window.startFreeSession) window.startFreeSession();
    });
  }
  if (fromScript) fromScript.addEventListener('click', openPicker);
  if (closeBtn) closeBtn.addEventListener('click', closePicker);
  if (layer) {
    layer.addEventListener('click', (event) => {
      if (event.target === layer) closePicker();
    });
  }
  if (search) search.addEventListener('input', renderPickList);
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && layer && !layer.hidden) {
      event.preventDefault();
      event.stopPropagation();
      closePicker();
    }
  }, true);
}

setupThemeToggle();
setupRecordButtons();
loadScripts().then(() => {
  const openPath = new URLSearchParams(location.search).get('script');
  if (openPath) {
    loadScript(openPath);
    history.replaceState(null, '', '/');
  }
});
