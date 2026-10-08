(function () {
  if (window.parent && window.parent !== window) return;

  if (!document.getElementById('rec-float')) {
    const box = document.createElement('div');
    box.id = 'rec-float';
    box.className = 'rec-float';
    box.innerHTML =
      '<canvas id="rec-float-preview" class="rec-float-preview" width="160" height="214"></canvas>' +
      '<div class="rec-float-actions">' +
      '<button id="rec-float-start" type="button">شروع ضبط</button>' +
      '<button id="rec-float-stop" type="button" hidden>توقف</button>' +
      '<button id="rec-float-pause" type="button" hidden>توقف کوتاه</button>' +
      '<button id="rec-float-resume" type="button" hidden>شروع مجدد</button>' +
      '</div>';
    document.body.appendChild(box);
  }

  const box = document.getElementById('rec-float');
  if (!box) return;

  try {
    const saved = JSON.parse(localStorage.getItem('reel.floatPos') || '');
    if (saved && Number.isFinite(saved.left) && Number.isFinite(saved.top)) {
      box.style.left = saved.left + 'px';
      box.style.top = saved.top + 'px';
      box.style.bottom = 'auto';
    }
  } catch (err) {}

  const grip = document.getElementById('rec-float-preview');
  if (grip) {
    grip.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const rect = box.getBoundingClientRect();
      const ox = event.clientX - rect.left;
      const oy = event.clientY - rect.top;
      box.classList.add('is-dragging');
      function move(ev) {
        const maxX = Math.max(0, window.innerWidth - box.offsetWidth);
        const maxY = Math.max(0, window.innerHeight - box.offsetHeight);
        const left = Math.min(maxX, Math.max(0, ev.clientX - ox));
        const top = Math.min(maxY, Math.max(0, ev.clientY - oy));
        box.style.left = left + 'px';
        box.style.top = top + 'px';
        box.style.bottom = 'auto';
      }
      function up() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        box.classList.remove('is-dragging');
        try {
          localStorage.setItem(
            'reel.floatPos',
            JSON.stringify({ left: parseFloat(box.style.left), top: parseFloat(box.style.top) })
          );
        } catch (err) {}
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });
  }

  if (document.getElementById('tp-record')) return;
  const start = document.getElementById('rec-float-start');
  if (start) {
    start.addEventListener('click', () => {
      location.href = '/?shortcut=1';
    });
  }
})();
