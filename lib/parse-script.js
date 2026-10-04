'use strict';

const PAUSE_MARK = '⏸';

function extractTitle(content) {
  const lines = content.split(/\r?\n/);
  for (const line of lines) {
    const m = line.trim().match(/^#\s+(.+)$/);
    if (m) return m[1].trim();
  }
  return null;
}

function extractSpokenSection(content) {
  const lines = content.split(/\r?\n/);
  let start = -1;
  for (let i = 0; i < lines.length; i++) {
    if (/^##\s*متن\s*$/.test(lines[i].trim())) {
      start = i + 1;
      break;
    }
  }
  if (start === -1) return '';

  let end = lines.length;
  for (let i = start; i < lines.length; i++) {
    if (/^##\s/.test(lines[i].trim())) {
      end = i;
      break;
    }
  }
  return lines.slice(start, end).join('\n');
}

function extractEditableBody(content) {
  const spoken = extractSpokenSection(content).replace(/\r\n/g, '\n').trim();
  if (spoken) return spoken;
  const lines = String(content || '').replace(/\r\n/g, '\n').split('\n');
  if (lines[0] && /^#\s+/.test(lines[0].trim())) lines.shift();
  while (lines.length && !lines[0].trim()) lines.shift();
  if (lines[0] && /^##\s*متن\s*$/.test(lines[0].trim())) lines.shift();
  while (lines.length && !lines[0].trim()) lines.shift();
  return lines.join('\n').trim();
}

function parseParagraph(raw) {
  const tokens = raw.split(/\s+/).filter(Boolean);
  const display = [];
  const emphasis = [];
  const emphasisColors = {};
  const pauses = [];
  let emphasisOpen = false;
  let activeColor = 1;
  let wordIndex = 0;

  for (let token of tokens) {
    if (token === PAUSE_MARK) {
      // Kept in the displayed text (the performer needs to see where to
      // pause), but it is not a spoken word: it does not advance wordIndex
      // and is excluded from emphasis/pause position indices, which index
      // spoken words only, the same words phase 6 captions will use.
      pauses.push(wordIndex);
      display.push(PAUSE_MARK);
      continue;
    }
    // A leading ** while emphasis is already open is usually the closer that
    // landed on the next word after a trailing space (e.g. **[2]foo **bar).
    if (emphasisOpen && token.startsWith('**')) {
      emphasisOpen = false;
      token = token.slice(2);
      if (!token) continue;
    }
    const hasLeading = token.startsWith('**');
    const hasTrailing = token.endsWith('**') && token.length > 2;
    let clean = token.split('**').join('');
    if (!clean) continue;

    if (hasLeading) {
      emphasisOpen = true;
      const colorMatch = clean.match(/^\[([1-6])\]([\s\S]*)$/);
      if (colorMatch) {
        activeColor = Number(colorMatch[1]);
        clean = colorMatch[2];
      } else {
        activeColor = 1;
      }
      if (!clean) {
        if (hasTrailing) emphasisOpen = false;
        continue;
      }
    }
    if (emphasisOpen) {
      emphasis.push(wordIndex);
      emphasisColors[wordIndex] = activeColor;
    }
    if (hasTrailing) emphasisOpen = false;

    display.push(clean);
    wordIndex++;
  }

  return { text: display.join(' '), emphasis, emphasisColors, pauses };
}

function parseScript(content) {
  const title = extractTitle(content);
  const section = extractSpokenSection(content);

  const blocks = section
    .split(/\n\s*\n/)
    .map((block) => block.split(/\r?\n/).join(' ').trim())
    .filter((block) => block.length > 0 && !/^-{3,}$/.test(block));

  const paragraphs = blocks.map(parseParagraph);
  return { title, paragraphs };
}

module.exports = {
  parseScript,
  extractSpokenSection,
  extractEditableBody,
  extractTitle,
  parseParagraph,
};
