(function () {
  const listEl = document.getElementById('archive-list');
  const statusEl = document.getElementById('archive-status');
  const FA_DIGITS = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];

  function faNum(n) {
    return String(n).replace(/[0-9]/g, (d) => FA_DIGITS[+d]);
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
      return new Date(ms).toLocaleDateString('fa-IR');
    } catch (e) {
      return '';
    }
  }

  function render(items) {
    listEl.replaceChildren();
    if (!items.length) {
      statusEl.textContent = 'هنوز ویدیویی ضبط نشده. اول یه سناریو رو تا آخر قبول کن.';
      return;
    }
    statusEl.textContent = '';
    items.forEach((item) => {
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
      bits.push(faNum(item.acceptedCount) + ' از ' + faNum(item.paragraphCount) + ' پاراگراف');
      meta.textContent = bits.join('، ');
      info.appendChild(title);
      info.appendChild(meta);

      const actions = document.createElement('div');
      actions.className = 'archive-actions';
      const edit = document.createElement('a');
      edit.className = 'btn btn-accent';
      edit.href = '/edit.html?slug=' + encodeURIComponent(item.slug);
      edit.textContent = 'ویرایش زیرنویس';
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'btn btn-danger';
      remove.textContent = 'حذف';
      remove.addEventListener('click', () => removeItem(item, card));
      actions.appendChild(edit);
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
      actions.appendChild(remove);

      card.appendChild(info);
      card.appendChild(actions);
      listEl.appendChild(card);
    });
  }

  async function removeItem(item, card) {
    const ok = window.confirm('این ضبط پاک بشه؟ سناریو می‌مونه.');
    if (!ok) return;
    statusEl.textContent = '';
    try {
      const res = await fetch('/api/recording?slug=' + encodeURIComponent(item.slug), { method: 'DELETE' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        statusEl.textContent = data.error || 'پاک نشد';
        return;
      }
      card.remove();
      if (!listEl.children.length) {
        statusEl.textContent = 'هنوز ویدیویی ضبط نشده. اول یه سناریو رو تا آخر قبول کن.';
      }
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
      render(data);
    } catch (err) {
      statusEl.textContent = 'فهرست ضبط‌ها باز نشد';
    }
  }

  load();
})();
