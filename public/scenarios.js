(function () {
  const listEl = document.getElementById('scenarios-list');
  const statusEl = document.getElementById('scenarios-status');
  const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
  const emptyText = 'هنوز سناریویی نیست. از داشبورد «افزودن سناریو» رو بزن.';

  function faNum(n) {
    return String(n).replace(/[0-9]/g, (d) => FA_DIGITS[+d]);
  }

  function formatDate(ms) {
    try {
      return new Date(ms).toLocaleDateString('fa-IR');
    } catch (e) {
      return '';
    }
  }

  function editHref(item) {
    if (item.file) return '/script.html?file=' + encodeURIComponent(item.file);
    return '/script.html?path=' + encodeURIComponent(item.path);
  }

  function render(items) {
    listEl.replaceChildren();
    if (!items.length) {
      statusEl.textContent = emptyText;
      return;
    }
    statusEl.textContent = '';
    items.forEach((item) => {
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
      if (item.source === 'manual') {
        const edit = document.createElement('a');
        edit.className = 'btn btn-accent';
        edit.href = editHref(item);
        edit.textContent = 'ویرایش';
        actions.appendChild(edit);
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-danger';
        remove.textContent = 'حذف';
        remove.addEventListener('click', () => removeItem(item, card));
        actions.appendChild(remove);
      }

      card.appendChild(open);
      if (actions.childElementCount) card.appendChild(actions);
      listEl.appendChild(card);
    });
  }

  async function removeItem(item, card) {
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
      card.remove();
      if (!listEl.children.length) statusEl.textContent = emptyText;
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
      render(data);
    } catch (err) {
      statusEl.textContent = 'فهرست سناریوها باز نشد';
    }
  }

  load();
})();
