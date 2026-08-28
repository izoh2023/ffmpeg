const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const route = fs.readFileSync(path.join(root, 'api/logo_swap/route.ts'), 'utf8');
const cleanup = fs.readFileSync(path.join(root, 'api/cleanUp/route.ts'), 'utf8');
const detector = fs.readFileSync(path.join(root, 'detect_logo.py'), 'utf8');
const runCmd = fs.readFileSync(path.join(root, 'utils/runCmd.ts'), 'utf8');

assert.match(route, /"-c:a",\s*"aac"/, 'MP4 output must normalize audio to AAC');
assert.match(route, /"-b:a",\s*"192k"/);
assert.match(route, /clampDelogoRegion/);
assert.match(route, /frame_w - x - 1/);
assert.match(cleanup, /preserveErrors/);
assert.match(cleanup, /job\.status === "error"/);
assert.match(cleanup, /job\.json/);
assert.match(detector, /sample_times/);
assert.match(detector, /0\.5/);
assert.match(detector, /0\.75/);
assert.match(runCmd, /stderrTail/);
assert.match(runCmd, /Exit code \$\{code\}: \$\{stderrTail/);

console.log('logo-swap resilience contract is valid');
