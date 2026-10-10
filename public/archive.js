(function () {
  const listEl = document.getElementById('archive-list');
  const statusEl = document.getElementById('archive-status');
  const tabButtons = document.querySelectorAll('[data-list-tab]');
  const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const emptyText = {
    list: 'هنوز ویدیویی ضبط نشده. اول یه سناریو رو تا آخر قبول کن، یا یه ضبط بدون سناریو بگیر.',
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

  function formatDuration(seconds) {
    if (!(seconds > 0)) return '';
    const total = Math.round(seconds);
    const m = Math.floor(total / 60);
    const s = total % 60;
    return faNum(m) + ':' + faNum(String(s).padStart(2, '0'));
  }

  function formatDate(ms) {
    try {
      return faNum(new Date(ms).toLocaleDateString('fa-IR'));
    } catch (e) {
      return '';
    }
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

      const info = document.createElement('div');
      const title = document.createElement('h2');
      title.textContent = item.title || item.slug;
      const meta = document.createElement('p');
      const bits = [];
      const date = formatDate(item.updatedAt);
      if (date) bits.push(date);
      if (item.duration) bits.push(formatDuration(item.duration));
      if (item.free) bits.push('بدون سناریو');
      else bits.push(faNum(item.acceptedCount) + ' از ' + faNum(item.paragraphCount) + ' پاراگراف');
      meta.textContent = bits.join('، ');
      info.appendChild(title);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'archive-actions';
      if (item.hasRender) {
        const fileLink = document.createElement('a');
        fileLink.className = 'btn';
        fileLink.href = '/api/render?slug=' + encodeURIComponent(item.slug);
        fileLink.textContent = 'دیدن فایل';
        const openFolder = document.createElement('button');
        openFolder.type = 'button';
        openFolder.className = 'btn';
        openFolder.textContent = 'نمایش پوشه';
        openFolder.addEventListener('click', () => {
          fetch('/api/open-export?slug=' + encodeURIComponent(item.slug), { method: 'POST' }).catch(() => {
            statusEl.textContent = 'پوشه باز نشد';
          });
        });
        actions.appendChild(fileLink);
        actions.appendChild(openFolder);
      }
      const edit = document.createElement('a');
      edit.className = 'btn btn-accent';
      edit.href = '/edit.html?slug=' + encodeURIComponent(item.slug);
      edit.textContent = 'ویرایشگر';
      actions.appendChild(edit);
      const shelf = document.createElement('button');
      shelf.type = 'button';
      shelf.className = item.archived ? 'btn' : 'btn btn-success';
      shelf.textContent = item.archived ? 'برگردان به لیست' : 'اتمام و آرشیو';
      shelf.addEventListener('click', () => setArchived(item, !item.archived));
      actions.appendChild(shelf);
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-danger';
      remove.textContent = 'حذف';
      remove.addEventListener('click', () => removeItem(item));
      actions.appendChild(remove);

      card.appendChild(info);
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
        body: JSON.stringify({ type: 'recording', id: item.slug, archived }),
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
    const ok = window.confirm(item.free ? 'این ضبط پاک بشه؟' : 'این ضبط پاک بشه؟ سناریو می‌مونه.');
    if (!ok) return;
    statusEl.textContent = '';
    try {
      const res = await fetch('/api/recording?slug=' + encodeURIComponent(item.slug), { method: 'DELETE' });
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
    statusEl.textContent = 'داره فهرست ضبط‌ها را می‌خواند';
    try {
      const res = await fetch('/api/archive');
      const data = await res.json();
      if (!res.ok || !Array.isArray(data)) {
        statusEl.textContent = (data && data.error) || 'فهرست ضبط‌ها باز نشد';
        return;
      }
      items = data;
      setTab(tab);
    } catch (err) {
      statusEl.textContent = 'فهرست ضبط‌ها باز نشد';
    }
  }

  tabButtons.forEach((btn) => {
    btn.addEventListener('click', () => setTab(btn.getAttribute('data-list-tab')));
  });
  load();
})();
