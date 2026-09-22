async function loadScripts() {
  const res = await fetch('/api/scripts');
  const scripts = await res.json();
  const list = document.getElementById('script-list');
  list.innerHTML = '';
  for (const s of scripts) {
    const li = document.createElement('li');
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = `${s.title} (${s.paragraphCount} پاراگراف)`;
    btn.addEventListener('click', () => loadScript(s.path));
    li.appendChild(btn);
    list.appendChild(li);
  }
}

async function loadScript(scriptPath) {
  const res = await fetch('/api/script?path=' + encodeURIComponent(scriptPath));
  const data = await res.json();
  document.getElementById('script-title').textContent = data.title || '';
  if (window.startCaptureSession) {
    window.startCaptureSession(data.slug, data.paragraphs);
  }
}

loadScripts();
