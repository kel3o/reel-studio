'use strict';

const fs = require('fs');
const assert = require('assert');
const { parseScript } = require('../lib/parse-script');

const filePath = process.argv[2];
if (!filePath) {
  console.error('usage: node tools/test-parse.js <path to script.md>');
  process.exit(1);
}

const content = fs.readFileSync(filePath, 'utf8');
const { title, paragraphs } = parseScript(content);

const wordCount = paragraphs.reduce(
  (sum, p) => sum + p.text.split(/\s+/).filter(Boolean).length,
  0
);

console.log('title:', title);
console.log('paragraphs:', paragraphs.length);
console.log('words:', wordCount);

assert.strictEqual(paragraphs.length, 15, `expected 15 paragraphs, got ${paragraphs.length}`);
assert.strictEqual(wordCount, 327, `expected 327 words, got ${wordCount}`);

for (const p of paragraphs) {
  assert.ok(!p.text.includes('##'), `paragraph contains ##: ${p.text}`);
  assert.ok(!p.text.includes('**'), `paragraph contains **: ${p.text}`);
}

assert.ok(
  paragraphs[paragraphs.length - 1].text.startsWith('ایجنت برای این نیست'),
  `last paragraph does not start with expected text: ${paragraphs[paragraphs.length - 1].text}`
);

console.log('OK: phase 1 self test passed');
