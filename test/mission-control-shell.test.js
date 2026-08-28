// THE SHELL'S TYPOGRAPHY MUST ACTUALLY LOAD (2026-08-27).
//
// The dashboard linked Space Grotesk, Inter and IBM Plex Mono from fonts.googleapis.com while the
// app's own CSP said style-src 'self' / font-src 'self'. The browser refused the stylesheet on
// every page load and every surface fell back to the OS default sans and mono — the design had
// never once been seen. Self-hosting fixed it.
//
// THE SECOND MISTAKE IS THE ONE THIS FILE EXISTS FOR: the first attempt put the @font-face rules
// where the font VARIABLES live, which is inside the :root{} block. They were present in the
// served HTML, so every "is the font declared?" check passed — and document.fonts.size was still
// 0, because @font-face is only valid at the TOP LEVEL of a stylesheet and the parser silently
// discarded all five. Presence is not the property that matters; POSITION is. These assertions
// check position, and that the referenced files exist on disk.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SHARED = require('../mission-control/ui/shared.js');
const FONT_DIR = path.join(__dirname, '..', 'mission-control', 'static', 'fonts');

// The shell exports css() directly — assert against the REAL stylesheet the browser receives,
// never against the JS source (the first version of this test measured brace depth across
// JavaScript and failed for the wrong reason).
const shellCss = () => SHARED.css();

test('the shell fetches NO fonts from a third party — the CSP would refuse them anyway', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'mission-control', 'ui', 'shared.js'), 'utf8');
  const linkish = src.match(/<link[^>]*fonts\.(googleapis|gstatic)\.com[^>]*>/g) || [];
  assert.deepEqual(linkish, [], 'no external font <link> may return — self-hosted or nothing');
  assert.ok(!/preconnect[^>]*gstatic/.test(src), 'and no preconnect to Google from an OWNER_ONLY dashboard');
});

test('every @font-face sits at the TOP LEVEL — nested ones are silently discarded', () => {
  const css = shellCss();
  const idx = [...css.matchAll(/@font-face/g)].map((m) => m.index);
  assert.ok(idx.length >= 3, `expected the three families, found ${idx.length} @font-face rules`);
  // Depth check: count unclosed braces before each rule. Anything > 0 means it is inside another
  // block (this is exactly how the first attempt failed, invisibly).
  for (const i of idx) {
    const before = css.slice(0, i);
    const depth = (before.match(/{/g) || []).length - (before.match(/}/g) || []).length;
    assert.equal(depth, 0, `@font-face at offset ${i} is nested ${depth} level(s) deep — the CSS parser will drop it`);
  }
});

test('every self-hosted face the CSS names exists on disk and is a real woff2', () => {
  const css = shellCss();
  const urls = [...css.matchAll(/url\('(\/static\/fonts\/[^']+)'\)/g)].map((m) => m[1]);
  assert.ok(urls.length >= 3, 'the shell should reference its own font files');
  for (const u of urls) {
    const file = path.join(FONT_DIR, path.basename(u));
    assert.ok(fs.existsSync(file), `${u} is referenced by the CSS but missing on disk`);
    const head = fs.readFileSync(file).subarray(0, 4).toString('latin1');
    assert.equal(head, 'wOF2', `${u} is not a woff2 file (magic was ${JSON.stringify(head)})`);
  }
});

test('the fallback stacks are deliberate — a failed face must not land on the browser default', () => {
  const css = shellCss();
  for (const v of ['--font-display', '--font-body', '--font-mono']) {
    const m = new RegExp(`${v}:([^;]+);`).exec(css);
    assert.ok(m, `${v} not found`);
    const stack = m[1].split(',').map((x) => x.trim());
    assert.ok(stack.length >= 3, `${v} falls back through only ${stack.length} option(s): ${m[1]}`);
  }
});

test('a bare .r-card is a padded box — and its companions still override', () => {
  // Operator, 2026-08-28: "the first word is right on the left border". `.rcc .r-card` carried
  // only the SURFACE (background, border, radius, shadow); every padded use got its inset from a
  // companion class instead, so a bare card computed to padding:0 and its text sat one pixel
  // inside its own border. Measured live: padding 0px, heading at x=257 against an edge at x=256.
  const css = SHARED.rcc.css();
  assert.match(css, /\.rcc \.r-card\{padding:/, 'a card has a box\'s padding');

  // The floor must not steal from the companions, and that depends ENTIRELY on source order:
  // all three selectors have equal specificity, so the later declaration wins. If .r-card were
  // ever moved below them, every panel and KPI would silently lose its inset.
  const card = css.indexOf('.rcc .r-card{');
  const kpi = css.indexOf('.rcc .r-kpi{');
  const panel = css.indexOf('.rcc .r-panel{');
  assert.ok(card >= 0 && kpi > card, '.r-kpi must be declared after .r-card to keep its 16px');
  assert.ok(panel > card, '.r-panel must be declared after .r-card to keep its 17px');
  assert.match(css, /\.rcc \.r-panel\{padding:17px/);
  assert.match(css, /\.rcc \.r-kpi\{padding:16px/);
});
