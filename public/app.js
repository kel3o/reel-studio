async function loadScripts() {
  const res = await fetch('/api/scripts');
  const scripts = await res.json();
  const list = document.getElementById('script-list');
  list.innerHTML = '';
  for (const s of scripts) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    if (s.source === 'manual') {
      const tag = document.createElement('span');
      tag.className = 'script-tag';
      tag.textContent = 'دستی';
      btn.appendChild(tag);
    }
    btn.appendChild(document.createTextNode(`${s.title} (${s.paragraphCount} پاراگراف)`));
    btn.addEventListener('click', () => loadScript(s.path));
    li.appendChild(btn);
    list.appendChild(li);
  }
}

function setupManualForm() {
  const openBtn = document.getElementById('manual-open');
  const form = document.getElementById('manual-form');
  const titleInput = document.getElementById('manual-title');
  const textInput = document.getElementById('manual-text');
  const errorEl = document.getElementById('manual-error');
  const saveBtn = document.getElementById('manual-save');

  openBtn.addEventListener('click', () => {
    form.hidden = false;
    openBtn.hidden = true;
    errorEl.textContent = '';
    titleInput.focus();
  });

  document.getElementById('manual-cancel').addEventListener('click', () => {
    form.hidden = true;
    openBtn.hidden = false;
    errorEl.textContent = '';
  });

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    const text = textInput.value.trim();
    errorEl.textContent = '';
    if (!title) {
      errorEl.textContent = 'یه عنوان بذار';
      return;
    }
    if (!text) {
      errorEl.textContent = 'متنی ننوشتی';
      return;
    }
    saveBtn.disabled = true;
    try {
      const res = await fetch('/api/manual-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ title, text }),
      });
      const data = await res.json();
      if (!res.ok) {
        errorEl.textContent = data.error || 'ذخیره نشد';
        return;
      }
      titleInput.value = '';
      textInput.value = '';
      form.hidden = true;
      openBtn.hidden = false;
      await loadScripts();
      await loadScript(data.path);
    } catch (err) {
      errorEl.textContent = 'ذخیره نشد';
    } finally {
      saveBtn.disabled = false;
    }
  });
}

async function loadScript(scriptPath) {
  const res = await fetch('/api/script?path=' + encodeURIComponent(scriptPath));
  const data = await res.json();
  document.getElementById('script-title').textContent = data.title || '';
  if (window.startCaptureSession) {
    window.startCaptureSession(data.slug, data.paragraphs, data.title);
  }
}

setupManualForm();
loadScripts();
