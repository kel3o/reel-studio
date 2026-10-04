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
    if (s.source === 'manual') {
      const tag = document.createElement('span');
      tag.className = 'script-tag';
      tag.textContent = 'دستی';
      btn.appendChild(tag);
    }
    btn.appendChild(document.createTextNode(`${s.title} (${s.paragraphCount} پاراگراف)`));
    btn.addEventListener('click', () => loadScript(s.path));
    li.appendChild(btn);
    if (s.source === 'manual') {
      const edit = document.createElement('button');
      edit.type = 'button';
      edit.className = 'script-edit';
      edit.textContent = 'ویرایش';
      edit.addEventListener('click', (e) => {
        e.stopPropagation();
        openManualEdit(s.path, s.file);
      });
      li.appendChild(edit);
    }
    list.appendChild(li);
  }
}

function setupThemeToggle() {
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
    } catch (e) {
      // ignore
    }
    sync();
  });
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function markupToHtml(text) {
  const source = String(text || '').replace(/\r\n/g, '\n');
  if (!source) return '';
  let html = '';
  let i = 0;
  while (i < source.length) {
    if (source.startsWith('**', i)) {
      const colorMatch = source.slice(i).match(/^\*\*\[([1-6])\]/);
      let color = 1;
      let contentStart = i + 2;
      if (colorMatch) {
        color = Number(colorMatch[1]);
        contentStart = i + colorMatch[0].length;
      }
      const close = source.indexOf('**', contentStart);
      if (close === -1) {
        html += escapeHtml(source.slice(i)).replace(/\n/g, '<br>');
        break;
      }
      const inner = source.slice(contentStart, close);
      html +=
        '<span class="em-preview em-preview-' +
        color +
        '">' +
        escapeHtml(inner).replace(/\n/g, '<br>') +
        '</span>';
      i = close + 2;
      continue;
    }
    const next = source.indexOf('**', i);
    const chunk = next === -1 ? source.slice(i) : source.slice(i, next);
    html += escapeHtml(chunk).replace(/\n/g, '<br>');
    i = next === -1 ? source.length : next;
  }
  return html;
}

function editorToMarkup(root) {
  function of(node) {
    if (node.nodeType === Node.TEXT_NODE) return node.nodeValue || '';
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const tag = node.tagName;
    if (tag === 'BR') return '\n';
    const em = String(node.className || '').match(/\bem-preview-([1-6])\b/);
    if (em) {
      let inner = Array.from(node.childNodes).map(of).join('');
      inner = inner.replace(/\*\*/g, '');
      const lead = (inner.match(/^\s*/) || [''])[0];
      const trail = (inner.match(/\s*$/) || [''])[0];
      const core = inner.slice(lead.length, inner.length - trail.length);
      if (!core) return lead + trail;
      const open = em[1] === '1' ? '**' : '**[' + em[1] + ']';
      return lead + open + core + '**' + trail;
    }
    if (tag === 'DIV' || tag === 'P') {
      const inner = Array.from(node.childNodes).map(of).join('');
      if (!inner) return '\n';
      return inner.endsWith('\n') ? inner : inner + '\n';
    }
    return Array.from(node.childNodes).map(of).join('');
  }
  return of(root)
    .replace(/\r\n/g, '\n')
    .replace(/\n+$/g, '')
    .trimEnd();
}

function setupManualForm() {
  const openBtn = document.getElementById('manual-open');
  const form = document.getElementById('manual-form');
  const titleInput = document.getElementById('manual-title');
  const textEditor = document.getElementById('manual-text');
  const pathInput = document.getElementById('manual-path');
  const errorEl = document.getElementById('manual-error');
  const saveBtn = document.getElementById('manual-save');
  const emphasizeBtn = document.getElementById('manual-emphasize');
  const colorBox = document.getElementById('em-colors');
  const colorToggle = document.getElementById('em-color-toggle');
  let emColor = 1;

  function setEditorText(text) {
    textEditor.innerHTML = markupToHtml(text);
    textEditor.classList.toggle('is-empty', !String(text || '').trim());
  }

  function getEditorText() {
    return editorToMarkup(textEditor).trim();
  }

  function resetForm() {
    titleInput.value = '';
    setEditorText('');
    pathInput.value = '';
    errorEl.textContent = '';
    saveBtn.textContent = 'ذخیره و باز کن';
    if (colorBox) colorBox.hidden = true;
    if (colorToggle) colorToggle.classList.remove('on');
  }

  function showForm() {
    form.hidden = false;
    openBtn.hidden = true;
    errorEl.textContent = '';
  }

  function hideForm() {
    form.hidden = true;
    openBtn.hidden = false;
    resetForm();
  }

  window.openManualEdit = async function (scriptPath, fileName) {
    resetForm();
    showForm();
    titleInput.value = 'در حال خوندن';
    setEditorText('');
    try {
      const query = fileName
        ? 'file=' + encodeURIComponent(fileName)
        : 'path=' + encodeURIComponent(scriptPath);
      const res = await fetch('/api/manual-script?' + query);
      const raw = await res.text();
      let data;
      try {
        data = JSON.parse(raw);
      } catch (err) {
        titleInput.value = '';
        errorEl.textContent = 'سرور قدیمی است. یک بار برنامه را ببند و دوباره باز کن';
        return;
      }
      if (!res.ok) {
        errorEl.textContent = data.error || 'باز نشد';
        titleInput.value = '';
        return;
      }
      pathInput.value = data.path || scriptPath;
      titleInput.value = data.title || '';
      setEditorText(data.text || '');
      saveBtn.textContent = 'ذخیره تغییرات';
      textEditor.focus();
      if (!(data.text || '').trim()) {
        errorEl.textContent = 'متن این سناریو خالی خونده شد';
      }
    } catch (err) {
      titleInput.value = '';
      errorEl.textContent = 'باز نشد';
    }
  };

  openBtn.addEventListener('click', () => {
    resetForm();
    showForm();
    titleInput.focus();
  });

  document.getElementById('manual-cancel').addEventListener('click', () => {
    hideForm();
  });

  textEditor.addEventListener('input', () => {
    textEditor.classList.toggle('is-empty', !getEditorText());
  });

  if (colorToggle && colorBox) {
    colorToggle.addEventListener('click', () => {
      colorBox.hidden = !colorBox.hidden;
      colorToggle.classList.toggle('on', !colorBox.hidden);
    });
  }

  if (colorBox) {
    colorBox.addEventListener('click', (e) => {
      const btn = e.target.closest('.em-color');
      if (!btn) return;
      emColor = Number(btn.getAttribute('data-color')) || 1;
      colorBox.querySelectorAll('.em-color').forEach((el) => el.classList.toggle('on', el === btn));
    });
  }

  if (emphasizeBtn) {
    emphasizeBtn.addEventListener('click', () => {
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0 || sel.isCollapsed) {
        errorEl.textContent = 'اول یه تکه از متن رو انتخاب کن';
        return;
      }
      const range = sel.getRangeAt(0);
      if (!textEditor.contains(range.commonAncestorContainer)) {
        errorEl.textContent = 'اول یه تکه از متن رو انتخاب کن';
        return;
      }
      errorEl.textContent = '';
      const span = document.createElement('span');
      span.className = 'em-preview em-preview-' + emColor;
      try {
        span.appendChild(range.extractContents());
        range.insertNode(span);
      } catch (err) {
        errorEl.textContent = 'این تکه رو نتونستم رنگی کنم';
        return;
      }
      sel.removeAllRanges();
      const after = document.createRange();
      after.setStartAfter(span);
      after.collapse(true);
      sel.addRange(after);
      textEditor.focus();
      textEditor.classList.toggle('is-empty', !getEditorText());
    });
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const title = titleInput.value.trim();
    const text = getEditorText();
    const editPath = pathInput.value.trim();
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
      const body = { title, text };
      if (editPath) body.path = editPath;
      const res = await fetch('/api/manual-script', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        errorEl.textContent = data.error || 'ذخیره نشد';
        return;
      }
      hideForm();
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

setupThemeToggle();
setupManualForm();
loadScripts();
