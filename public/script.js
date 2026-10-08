(function () {
  const titleInput = document.getElementById('manual-title');
  const textEditor = document.getElementById('manual-text');
  const pathInput = document.getElementById('manual-path');
  const errorEl = document.getElementById('manual-error');
  const saveBtn = document.getElementById('manual-save');
  const emphasizeBtn = document.getElementById('manual-emphasize');
  const colorBox = document.getElementById('em-colors');
  const colorToggle = document.getElementById('em-color-toggle');
  const pageTitle = document.getElementById('script-page-title');
  const form = document.getElementById('manual-form');
  let emColor = 1;
  const HISTORY_MAX = 80;
  let undoStack = [];
  let redoStack = [];
  let historyLocked = false;
  let preSnapshot = '';
  let coalesceTimer = 0;
  let coalescing = false;

  function editorSnapshot() {
    return JSON.stringify({
      title: titleInput.value,
      html: textEditor.innerHTML,
      empty: textEditor.classList.contains('is-empty'),
    });
  }

  function rememberEditorBaseline() {
    clearTimeout(coalesceTimer);
    coalesceTimer = 0;
    coalescing = false;
    preSnapshot = editorSnapshot();
  }

  function noteEditorHistory(coalesce) {
    if (historyLocked) return;
    if (!preSnapshot) preSnapshot = editorSnapshot();
    if (!(coalesce && coalescing)) {
      undoStack.push(preSnapshot);
      if (undoStack.length > HISTORY_MAX) undoStack.shift();
      redoStack = [];
    }
    if (coalesce) {
      coalescing = true;
      clearTimeout(coalesceTimer);
      coalesceTimer = setTimeout(() => {
        preSnapshot = editorSnapshot();
        coalesceTimer = 0;
        coalescing = false;
      }, 500);
    } else {
      clearTimeout(coalesceTimer);
      coalesceTimer = 0;
      coalescing = false;
      // Caller mutates after this; baseline refreshes when they call rememberEditorBaseline.
    }
  }

  function applyEditorSnapshot(raw) {
    const data = JSON.parse(raw);
    historyLocked = true;
    titleInput.value = data.title || '';
    textEditor.innerHTML = data.html || '';
    textEditor.classList.toggle('is-empty', !!data.empty || !getEditorText());
    historyLocked = false;
  }

  function undoEditor() {
    if (!undoStack.length) return;
    clearTimeout(coalesceTimer);
    coalesceTimer = 0;
    const current = editorSnapshot();
    redoStack.push(current);
    const prev = undoStack.pop();
    applyEditorSnapshot(prev);
    preSnapshot = prev;
  }

  function redoEditor() {
    if (!redoStack.length) return;
    clearTimeout(coalesceTimer);
    coalesceTimer = 0;
    const current = editorSnapshot();
    undoStack.push(current);
    const next = redoStack.pop();
    applyEditorSnapshot(next);
    preSnapshot = next;
  }

  function faDigits(value) {
    const persian = '۰۱۲۳۴۵۶۷۸۹';
    return String(value == null ? '' : value).replace(/[0-9\u0660-\u0669]/g, (ch) => {
      const n = ch >= '0' && ch <= '9' ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 0x0660;
      return persian[n] || ch;
    });
  }

  function hideColorTags(value) {
    return String(value || '').replace(/\[([1-6])\]/g, '');
  }

  function cleanEditorTextNodes() {
    const walker = document.createTreeWalker(textEditor, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((node) => {
      const next = faDigits(hideColorTags(node.nodeValue));
      if (next !== node.nodeValue) node.nodeValue = next;
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
        const inner = hideColorTags(source.slice(contentStart, close));
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
      const chunk = hideColorTags(next === -1 ? source.slice(i) : source.slice(i, next));
      html += escapeHtml(chunk).replace(/\n/g, '<br>');
      i = next === -1 ? source.length : next;
    }
    return html;
  }

  function editorToMarkup(root) {
    function of(node) {
      if (node.nodeType === Node.TEXT_NODE) return faDigits(hideColorTags(node.nodeValue || ''));
      if (node.nodeType !== Node.ELEMENT_NODE) return '';
      const tag = node.tagName;
      if (tag === 'BR') return '\n';
      const em = String(node.className || '').match(/\bem-preview-([1-6])\b/);
      if (em) {
        let inner = Array.from(node.childNodes).map(of).join('');
        inner = hideColorTags(inner.replace(/\*\*/g, ''));
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

  function setEditorText(text) {
    textEditor.innerHTML = markupToHtml(text);
    cleanEditorTextNodes();
    textEditor.classList.toggle('is-empty', !String(text || '').trim());
  }

  function getEditorText() {
    return editorToMarkup(textEditor).trim();
  }

  async function loadExisting() {
    const params = new URLSearchParams(location.search);
    const fileName = params.get('file') || '';
    const scriptPath = params.get('path') || '';
    if (!fileName && !scriptPath) {
      titleInput.focus();
      return;
    }
    if (pageTitle) pageTitle.textContent = 'ویرایش سناریو';
    saveBtn.textContent = 'ذخیره تغییرات';
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
      textEditor.focus();
      if (!(data.text || '').trim()) {
        errorEl.textContent = 'متن این سناریو خالی خونده شد';
      }
    } catch (err) {
      titleInput.value = '';
      errorEl.textContent = 'باز نشد';
    }
  }

  textEditor.addEventListener('beforeinput', () => {
    if (!historyLocked) noteEditorHistory(true);
  });

  textEditor.addEventListener('input', () => {
    cleanEditorTextNodes();
    textEditor.classList.toggle('is-empty', !getEditorText());
  });

  titleInput.addEventListener('beforeinput', () => {
    if (!historyLocked) noteEditorHistory(true);
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
      const picked = Number(btn.getAttribute('data-color'));
      emColor = Number.isFinite(picked) ? picked : 1;
      colorBox.querySelectorAll('.em-color').forEach((el) => el.classList.toggle('on', el === btn));
    });
  }

  function unwrapEmNodes(root) {
    Array.from(root.querySelectorAll('.em-preview')).forEach((el) => {
      const parent = el.parentNode;
      if (!parent) return;
      while (el.firstChild) parent.insertBefore(el.firstChild, el);
      parent.removeChild(el);
    });
  }

  function dropEmptyEmphasis(root) {
    Array.from(root.querySelectorAll('.em-preview')).forEach((el) => {
      if (el.querySelector('br')) return;
      if (!String(el.textContent || '').length) el.remove();
    });
  }

  function liftMarkerOutOfEmphasis(marker) {
    while (marker.parentElement && marker.parentElement !== textEditor && textEditor.contains(marker)) {
      const parent = marker.parentElement;
      if (!parent.closest('.em-preview')) break;
      const after = parent.cloneNode(false);
      while (marker.nextSibling) after.appendChild(marker.nextSibling);
      parent.parentNode.insertBefore(marker, parent.nextSibling);
      if (after.childNodes.length) parent.parentNode.insertBefore(after, marker.nextSibling);
      if (!parent.childNodes.length) parent.remove();
    }
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
      noteEditorHistory(false);
      let anchor = null;
      try {
        const frag = range.extractContents();
        const holder = document.createElement('div');
        holder.appendChild(frag);
        unwrapEmNodes(holder);
        const marker = document.createTextNode('');
        range.insertNode(marker);
        liftMarkerOutOfEmphasis(marker);
        if (emColor === 0) {
          const restored = document.createDocumentFragment();
          while (holder.firstChild) restored.appendChild(holder.firstChild);
          anchor = restored.lastChild;
          if (anchor) marker.parentNode.insertBefore(restored, marker);
        } else {
          const span = document.createElement('span');
          span.className = 'em-preview em-preview-' + emColor;
          while (holder.firstChild) span.appendChild(holder.firstChild);
          marker.parentNode.insertBefore(span, marker);
          anchor = span;
        }
        marker.remove();
        dropEmptyEmphasis(textEditor);
      } catch (err) {
        errorEl.textContent = emColor === 0 ? 'این تکه رو نتونستم بی‌رنگ کنم' : 'این تکه رو نتونستم رنگی کنم';
        return;
      }
      rememberEditorBaseline();
      sel.removeAllRanges();
      if (anchor) {
        const after = document.createRange();
        after.setStartAfter(anchor);
        after.collapse(true);
        sel.addRange(after);
      }
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
      location.href = '/scenarios.html';
    } catch (err) {
      errorEl.textContent = 'ذخیره نشد';
    } finally {
      saveBtn.disabled = false;
    }
  });

  document.addEventListener('keydown', (event) => {
    const mod = event.ctrlKey || event.metaKey;
    if (!mod) return;
    if (event.key === 's' || event.key === 'S') {
      event.preventDefault();
      if (!saveBtn.disabled) form.requestSubmit();
      return;
    }
    if (event.key === 'z' || event.key === 'Z') {
      event.preventDefault();
      if (event.shiftKey) redoEditor();
      else undoEditor();
      return;
    }
    if (event.key === 'y' || event.key === 'Y') {
      event.preventDefault();
      redoEditor();
    }
  });

  setEditorText('');
  rememberEditorBaseline();
  loadExisting().then(() => {
    undoStack = [];
    redoStack = [];
    rememberEditorBaseline();
  });
})();
