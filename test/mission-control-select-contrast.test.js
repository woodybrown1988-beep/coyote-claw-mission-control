'use strict';
// Select-popup contrast (operator report 2026-08-10): native <select> option lists render
// on the UA's LIGHT background while our controls inherit light text — white-on-white,
// and the hover highlight erased the row entirely. The fix is two-layered and these pins
// keep both layers present:
//  1. color-scheme:dark on every styled select → the UA renders its native popup dark;
//  2. explicit dark option/option:checked colours as the fallback for engines that style
//     options directly.
// Covers BOTH select families: .lc-domain (capture drawer + create forms, shell css) and
// .r-routesel (route/assignment/import selects, lifeCss).
const assert = require('node:assert/strict');
const test = require('node:test');
const SHARED = require('../mission-control/ui/shared.js');

test('capture-drawer selects (.lc-domain): dark color-scheme + readable options in the shell css', () => {
  const shell = SHARED.renderShell({ active: 'life-today', title: 't', sub: '', stamp: '', body: '', badges: {}, foot: [] });
  assert.match(shell, /\.lc-domain\{[^}]*color-scheme:dark[^}]*\}/, 'the control asks the UA for a dark native popup');
  assert.match(shell, /\.lc-domain option\{background:#14181d;color:#e9eef4\}/, 'options carry explicit dark-on-light-text contrast');
  assert.match(shell, /\.lc-domain option:checked\{background:#26374a;color:#fff\}/, 'the highlighted option stays readable');
});

test('route/assignment selects (.r-routesel): dark color-scheme + readable options in lifeCss', () => {
  const css = SHARED.rcc.lifeCss();
  assert.match(css, /\.rcc \.r-routesel\{[^}]*color-scheme:dark[^}]*\}/, 'the control asks the UA for a dark native popup');
  assert.match(css, /\.rcc \.r-routesel option\{background:#14181d;color:var\(--rtext\)\}/, 'options carry explicit contrast');
  assert.match(css, /\.rcc \.r-routesel option:checked\{background:#26374a;color:#fff\}/, 'the highlighted option stays readable');
});
