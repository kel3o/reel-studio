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

function parseParagraph(raw) {
  const tokens = raw.split(/\s+/).filter(Boolean);
  const display = [];
  const emphasis = [];
  const pauses = [];
  let emphasisOpen = false;
  let wordIndex = 0;

  for (const token of tokens) {
    if (token === PAUSE_MARK) {
      // Kept in the displayed text (the performer needs to see where to
      // pause), but it is not a spoken word: it does not advance wordIndex
      // and is excluded from emphasis/pause position indices, which index
      // spoken words only, the same words phase 6 captions will use.
      pauses.push(wordIndex);
      display.push(PAUSE_MARK);
      continue;
    }
    const hasLeading = token.startsWith('**');
    const hasTrailing = token.endsWith('**') && token.length > 2;
    const clean = token.split('**').join('');
    if (!clean) continue;

    if (hasLeading) emphasisOpen = true;
    if (emphasisOpen) emphasis.push(wordIndex);
    if (hasTrailing) emphasisOpen = false;

    display.push(clean);
    wordIndex++;
  }

  return { text: display.join(' '), emphasis, pauses };
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

module.exports = { parseScript, extractSpokenSection, extractTitle, parseParagraph };
