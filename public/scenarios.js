(function () {
  const listEl = document.getElementById('scenarios-list');
  const statusEl = document.getElementById('scenarios-status');
  const tabButtons = document.querySelectorAll('[data-list-tab]');
  const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const emptyText = {
    list: 'هنوز سناریویی نیست. از داشبورد «ضبط از روی سناریو» و بعد «افزودن سناریو جدید» رو بزن.',
    archive: 'هنوز چیزی آرشیو نشده.',
  };
  let items = [];
  let tab = new URLSearchParams(location.search).get('tab') === 'archive' ? 'archive' : 'list';

  function faNum(n) {
    return String(n).replace(/[0-9\u0660-\u0669]/g, (ch) => {
      const d = ch >= '0' && ch <= '9' ? ch.charCodeAt(0) - 48 : ch.charCodeAt(0) - 0x0660;
      return FA_DIGITS[d] || ch;
    });
  }

  function formatDate(ms) {
    try {
      return faNum(new Date(ms).toLocaleDateString('fa-IR'));
    } catch (e) {
      return '';
    }
  }

  function editHref(item) {
    if (item.file) return '/script.html?file=' + encodeURIComponent(item.file);
    return '/script.html?path=' + encodeURIComponent(item.path);
  }

  function setTab(next) {
    tab = next === 'archive' ? 'archive' : 'list';
    tabButtons.forEach((btn) => btn.classList.toggle('on', btn.getAttribute('data-list-tab') === tab));
    const url = new URL(location.href);
    if (tab === 'archive') url.searchParams.set('tab', 'archive');
    else url.searchParams.delete('tab');
    history.replaceState(null, '', url.pathname + url.search);
    render();
  }

  function render() {
    listEl.replaceChildren();
    const shown = items.filter((item) => !!item.archived === (tab === 'archive'));
    if (!shown.length) {
      statusEl.textContent = emptyText[tab];
      return;
    }
    statusEl.textContent = '';
    shown.forEach((item) => {
      const card = document.createElement('article');
      card.className = 'archive-card';

      const open = document.createElement('a');
      open.className = 'scenario-open';
      open.href = '/?script=' + encodeURIComponent(item.path);

      const title = document.createElement('h2');
      title.textContent = item.title || item.file || 'بدون عنوان';
      const meta = document.createElement('p');
      const bits = [];
      const date = formatDate(item.mtime);
      if (date) bits.push(date);
      bits.push(faNum(item.paragraphCount || 0) + ' پاراگراف');
      meta.textContent = bits.join('، ');
      open.appendChild(title);
      open.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'archive-actions';
      const record = document.createElement('a');
      record.className = 'btn btn-record';
      record.href = '/?script=' + encodeURIComponent(item.path);
      record.textContent = 'ضبط';
      actions.appendChild(record);
      if (item.source === 'manual') {
        const edit = document.createElement('a');
        edit.className = 'btn';
        edit.href = editHref(item);
        edit.textContent = 'ویرایش';
        actions.appendChild(edit);
      }
      const shelf = document.createElement('button');
      shelf.type = 'button';
      shelf.className = item.archived ? 'btn' : 'btn btn-success';
      shelf.textContent = item.archived ? 'برگردان به لیست' : 'اتمام و آرشیو';
      shelf.addEventListener('click', () => setArchived(item, !item.archived));
      actions.appendChild(shelf);
      if (item.source === 'manual') {
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-danger';
        remove.textContent = 'حذف';
        remove.addEventListener('click', () => removeItem(item));
        actions.appendChild(remove);
      }

      card.appendChild(open);
      card.appendChild(actions);
      listEl.appendChild(card);
    });
  }

  async function setArchived(item, archived) {
    statusEl.textContent = '';
    try {
      const res = await fetch('/api/archive-state', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify({ type: 'scenario', id: item.path, archived }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        statusEl.textContent = data.error || 'جابه‌جا نشد';
        return;
      }
      item.archived = archived;
      render();
    } catch (err) {
      statusEl.textContent = 'جابه‌جا نشد';
    }
  }

  async function removeItem(item) {
    const ok = window.confirm('این سناریو پاک بشه؟');
    if (!ok) return;
    const query = item.file
      ? 'file=' + encodeURIComponent(item.file)
      : 'path=' + encodeURIComponent(item.path);
    statusEl.textContent = '';
    try {
      const res = await fetch('/api/manual-script?' + query, { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        statusEl.textContent = data.error || 'پاک نشد';
        return;
      }
      items = items.filter((other) => other !== item);
      render();
    } catch (err) {
      statusEl.textContent = 'پاک نشد';
    }
  }

  async function load() {
    statusEl.textContent = 'داره فهرست سناریوها را می‌خواند';
    try {
      const res = await fetch('/api/scripts');
      const data = await res.json();
      if (!res.ok || !Array.isArray(data)) {
        statusEl.textContent = (data && data.error) || 'فهرست سناریوها باز نشد';
        return;
      }
      items = data;
      setTab(tab);
    } catch (err) {
      statusEl.textContent = 'فهرست سناریوها باز نشد';
    }
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => setTab(btn.getAttribute('data-list-tab')));
  });
  load();
})();
