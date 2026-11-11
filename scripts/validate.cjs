'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const tests = fs.readdirSync(path.join(root, 'tests')).filter(f => f.endsWith('.test.cjs')).sort().map(f => 'tests/' + f);
const run = spawnSync(process.execPath, ['--test', '--test-reporter=tap', ...tests], { cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
process.stdout.write(run.stdout || '');
if (run.status !== 0) { process.stderr.write(run.stderr || 'Tests failed.\n'); process.exit(1); }
const verify = spawnSync(process.execPath, ['scripts/verify.cjs'], { cwd: root, encoding: 'utf8' });
process.stdout.write(verify.stdout || '');
if (verify.status !== 0) { process.stderr.write(verify.stderr || 'Static checks failed.\n'); process.exit(1); }
const files = [];
function walk(dir) {
  if (!fs.existsSync(path.join(root, dir))) return;
  for (const entry of fs.readdirSync(path.join(root, dir), { withFileTypes: true }).sort((a,b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
    const name = dir + '/' + entry.name;
    if (entry.isDirectory()) walk(name);
    else if (entry.isFile()) files.push({ path: name, sha256: crypto.createHash('sha256').update(fs.readFileSync(path.join(root, name))).digest('hex') });
  }
}
for (const dir of ['dist', 'tests', 'examples', 'scripts']) walk(dir);
const digest = crypto.createHash('sha256').update(JSON.stringify(files)).digest('hex');
const record = { schema_version: 1, project: JSON.parse(fs.readFileSync(path.join(root, 'package.json'))).name, checked_at: new Date().toISOString(), runtime: process.version, result: 'pass', tests: Number((run.stdout.match(/^# tests (\d+)$/m)||[])[1]), passed: Number((run.stdout.match(/^# pass (\d+)$/m)||[])[1]), failed: 0, source_manifest_sha256: digest, files, note: 'Local execution only. SHA-256 detects changed bytes, not authenticity or a security certification. Hosted CI status is separate.' };
fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
fs.writeFileSync(path.join(root, 'reports/validation.json'), JSON.stringify(record, null, 2) + '\n');
console.log('Saved reports/validation.json; source manifest SHA-256: ' + digest);
