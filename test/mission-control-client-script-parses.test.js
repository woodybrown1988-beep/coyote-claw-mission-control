'use strict';
// THE CLIENT SCRIPT MUST PARSE. This is the cheapest, highest-value test in the repo.
//
// It exists because of a real outage: a confirm() string written with `\n` in shared.js was
// COOKED by the template literal into a genuine newline inside a single-quoted JS string. The
// emitted script then failed to parse — and because every interactive control in Mission
// Control is a data-lc-* delegate in that one script, ALL TWENTY handlers died at once, across
// every page. Rename, cancel, complete, capture, proposals: nothing worked, and nothing said
// why. The page rendered perfectly.
//
// Existing tests could not catch it: they assert against the SOURCE file, where the escape
// looks right. Only the emitted output is the truth. `new Function(js)` parses without
// executing, which is exactly the check a browser does first.
const assert = require('node:assert/strict');
const test = require('node:test');
const S = require('../mission-control/ui/shared.js');

function emittedScript(route, workspace) {
  const html = String(S.renderShell({ title: 't', sub: '', body: '<div></div>', workspace, route, key: 'k' }));
  const m = html.match(/<script>([\s\S]*?)<\/script>/);
  assert.ok(m, `no inline script emitted for ${route}`);
  return m[1];
}

test('the emitted client script PARSES — every data-lc-* control depends on it', () => {
  for (const [route, workspace] of [['/life/task', 'life'], ['/life/today', 'life'], ['/coyote/overview', 'coyote'], ['/claw/agents', 'claw']]) {
    const js = emittedScript(route, workspace);
    assert.doesNotThrow(() => new Function(js), `the client script emitted for ${route} does not parse`);
  }
});

test('and it still carries every handler — a script that parses but lost its wiring is no better', () => {
  const js = emittedScript('/life/task', 'life');
  for (const h of ['cmd', 'rename', 'cancel', 'complete', 'wait', 'mailedit', 'due', 'draftcopy', 'draftedit',
    'fab', 'focus', 'route', 'quiet', 'replied']) {
    assert.ok(js.includes(`data-lc-${h}`), `data-lc-${h} handler is missing from the emitted script`);
  }
});

test('NEGATIVE CONTROL: the parse check goes RED on exactly the bug that caused the outage', () => {
  // A real newline inside a single-quoted string — what `\n` in the template source becomes.
  const cooked = "var a=confirm('line one\nline two');";
  assert.throws(() => new Function(cooked), /Invalid or unexpected token/,
    'this is the shape that took every button out; the check must reject it');
  // The correctly-escaped version, which is what the source must emit, parses fine.
  assert.doesNotThrow(() => new Function("var a=confirm('line one\\nline two');"));
});

test('no raw newline survives inside any quoted string in the emitted script', () => {
  // A second, independent read on the same failure: scan for an odd number of unescaped
  // quotes on a line, which is what a cooked newline leaves behind.
  const js = emittedScript('/life/task', 'life');
  const offenders = [];
  js.split('\n').forEach((line, i) => {
    const singles = (line.match(/(?<!\\)'/g) || []).length;
    if (singles % 2 === 1 && !line.trim().startsWith('//')) offenders.push(`${i + 1}: ${line.trim().slice(0, 80)}`);
  });
  assert.deepEqual(offenders, [], `unbalanced quotes suggest a cooked newline:\n${offenders.join('\n')}`);
});
