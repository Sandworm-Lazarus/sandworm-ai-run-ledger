'use strict';
// Static checks complement runtime tests; they are not a security certification.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const dist = path.join(root, 'dist');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const html = read('dist/index.html');
const files = fs.readdirSync(dist).filter(name => name.endsWith('.js'));
assert(files.length >= 2, 'Expected separate application and engine scripts');
for (const name of files) {
  const content = read('dist/' + name);
  new vm.Script(content, { filename: name });
  assert(!/\b(?:fetch|XMLHttpRequest|WebSocket|EventSource|sendBeacon|localStorage|sessionStorage|indexedDB|serviceWorker)\s*(?:\(|\.|\[)/.test(content), name + ': unexpected network or persistence API');
  assert(!/\b(?:innerHTML|outerHTML|insertAdjacentHTML|eval)\s*(?:=|\()/.test(content), name + ': unsafe HTML or dynamic execution');
}
for (const directive of ["connect-src 'none'", "form-action 'none'", "script-src 'self'"]) assert(html.includes(directive), 'Missing CSP directive');
assert(!/\son\w+\s*=/i.test(html), 'Unexpected inline event handler');
assert(!/\sstyle\s*=/i.test(html), 'Unexpected inline style');
for (const match of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
  assert(!match[2].trim(), 'Unexpected inline script');
  assert(/\bsrc="[\w.-]+\.js"/.test(match[1]), 'Unexpected script source');
}
const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(m => m[1]);
assert.equal(new Set(ids).size, ids.length, 'Duplicate DOM ID');
function localAsset(value) {
  assert(!/[:?#]|(^|\/)\.\.(\/|$)|^\//.test(value), 'Unexpected asset path');
  assert(fs.statSync(path.join(dist, value)).isFile(), 'Missing local asset');
}
for (const match of html.matchAll(/(?:src|href)="([^"]+)"/g)) {
  const value = match[1];
  if (value === '#') continue;
  if (value.startsWith('#')) { assert(ids.includes(value.slice(1)), 'Broken in-page link'); continue; }
  if (value.startsWith('https://github.com/Sandworm-Lazarus/') || value === 'https://sandworm-lazarus.pages.dev/') continue;
  localAsset(value);
}
for (const name of fs.readdirSync(dist).filter(n => n.endsWith('.css'))) {
  const css = read('dist/' + name);
  assert(!/@import/i.test(css), 'Unexpected CSS import');
  for (const match of css.matchAll(/url\(\s*['"]?([^'"\s)]+)['"]?\s*\)/gi)) {
    const value = match[1];
    if (value.startsWith('data:font/woff2;base64,')) {
      const data = Buffer.from(value.slice('data:font/woff2;base64,'.length), 'base64');
      assert.equal(data.subarray(0, 4).toString(), 'wOF2', 'Invalid embedded font');
    } else localAsset(value);
  }
}
for (const family of ['Anuphan', 'Chakra-Petch', 'JetBrains-Mono']) assert(read('dist/fonts/' + family + '-OFL.txt').includes('SIL OPEN FONT LICENSE'), 'Missing font notice');
for (const file of ['README.md','README.th.md','LICENSE','THIRD_PARTY_NOTICES.md','docs/THREAT_MODEL.md']) assert(read(file).trim(), 'Missing documentation');
assert(!Object.keys(JSON.parse(read('package.json')).dependencies || {}).length, 'Unexpected runtime dependency');
console.log('PASS: scripts, CSP, local assets, font notices, DOM IDs, documentation.');
