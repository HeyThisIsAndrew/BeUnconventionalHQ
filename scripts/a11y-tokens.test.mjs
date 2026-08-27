/*
  THE DECORATIVE RED MUST NEVER BE TEXT.

  The palette has two reds and they are not interchangeable:

    --color-accent       #cc0000   3.21:1 on #111   borders, glows, outlines
    --color-accent-text  #ef4444   5.02:1 on #111   anything you read

  CLAUDE.md states it outright: #cc0000 "is a border and glow colour only,
  never a text or icon colour". WCAG AA wants 4.5:1 for body text, and 3.21
  is not it.

  This is pinned as a test because AUTOMATED TOOLS CANNOT SEE IT. Lighthouse
  and axe measure colour AT REST, not on hover or focus, which is exactly
  where the violation was: `.mini-event-row:hover .mini-event-name` used the
  decorative red and the site still scored 100/100 accessibility. Only reading
  the CSS finds it.

  Contrast figures recomputed here rather than quoted, so the thresholds
  cannot drift away from the tokens they describe.
*/
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync, statSync } from 'node:fs';
import assert from 'node:assert/strict';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

let passed = 0;
let failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed += 1; }
  catch (e) { console.log(`  ✗ ${name}\n    ${e.message}`); failed += 1; }
}

/** WCAG relative luminance and contrast ratio. */
const lum = (hex) => {
  const c = [1, 3, 5].map((i) => parseInt(hex.substr(i, 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
};
const ratio = (a, b) => {
  const [x, y] = [lum(a), lum(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

/** Every .astro / .css / .tsx file under src/, recursively. */
function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(astro|css|tsx|ts)$/.test(name)) out.push(p);
  }
  return out;
}

console.log('Accessible colour tokens:');

test('the two reds still mean what the rule says they mean', () => {
  /* The reds live in the THEME file; --color-surface is in global-base. */
  const theme = readFileSync(join(ROOT, 'src/styles/theme-red.css'), 'utf8');
  const base = readFileSync(join(ROOT, 'src/styles/global-base.css'), 'utf8');
  const tok = (name, from = theme) =>
    (from.match(new RegExp(`${name}:\\s*(#[0-9a-fA-F]{6})`)) ?? [])[1];
  const accent = tok('--color-accent');
  const accentText = tok('--color-accent-text');
  const surface = tok('--color-surface', base) ?? '#111111';
  assert.ok(accent && accentText, 'both red tokens must exist');

  const decorative = ratio(accent, surface);
  const readable = ratio(accentText, surface);
  assert.ok(
    decorative < 4.5,
    `--color-accent is now ${decorative.toFixed(2)}:1 and would PASS as text. ` +
      'If that is deliberate, this whole guard can go; if it drifted, it is a bug.',
  );
  assert.ok(
    readable >= 4.5,
    `--color-accent-text is ${readable.toFixed(2)}:1 and fails WCAG AA. It is the ` +
      'token everything legible depends on.',
  );
});

test('--color-accent is never used as a text or icon colour', () => {
  /*
    Matches `color: var(--color-accent)` and its fallback form, but NOT
    `background-color`, `border-color`, `outline-color`, `caret-color`, or
    `--color-accent-text`. Decoration is what the token is for.
  */
  const offenders = [];
  for (const file of walk(join(ROOT, 'src'))) {
    const text = readFileSync(file, 'utf8');
    text.split('\n').forEach((line, i) => {
      // A `color:` declaration not preceded by background-/border-/outline-/caret-
      if (!/(^|[;{\s])color:\s*var\(--color-accent[,)]/.test(line)) return;
      offenders.push(`${file.replace(ROOT + '/', '')}:${i + 1}  ${line.trim().slice(0, 78)}`);
    });
  }
  assert.deepEqual(
    offenders,
    [],
    'These paint TEXT with the decorative red (3.21:1, fails WCAG AA).\n' +
      '      Use --color-accent-text (#ef4444, 5.02:1) instead:\n\n        ' +
      offenders.join('\n        ') + '\n',
  );
});

console.log(`\n${failed === 0 ? '✅' : '❌'} ${passed} passed, ${failed} failed.\n`);
process.exit(failed === 0 ? 0 : 1);
