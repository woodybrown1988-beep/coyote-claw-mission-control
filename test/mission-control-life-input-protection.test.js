'use strict';
// LIFE OS INPUT PROTECTION (first-real-use defect 1, 2026-08-08): the shell's 30s soft
// refresh must NEVER eat typing. The refresh pauses while ANY input/textarea/select is
// focused or holds unsaved text/choices, and resumes once fields are blurred and
// empty/submitted. Belt-and-braces: in-form fields keep per-tab sessionStorage drafts so
// even a manual F5 or navigation mid-type restores the text (privacy call: drafts live in
// the browser tab only — never at rest in life.db or any server store).
//
// This file exists so a FUTURE SHELL CHANGE cannot silently regress the behaviour: the
// guard is behaviour-tested against stub documents, and the shell wiring (guarded re-arming
// reload + draft keeper + submit-clears-draft) is byte-pinned against the rendered shell.
const assert = require('node:assert/strict');
const test = require('node:test');
const SHARED = require('../mission-control/ui/shared.js');

// -- stub DOM: just the two members the guard reads ---------------------------------------
function field(over) {
  return Object.assign({
    tagName: 'INPUT', type: 'text', value: '', defaultValue: '',
    checked: false, defaultChecked: false, options: [], selectedIndex: -1,
  }, over);
}
function doc(fields, active) {
  return { activeElement: active || null, querySelectorAll: () => fields || [] };
}

test('formInUse: a FOCUSED input/textarea/select pauses the refresh, other focus does not', () => {
  assert.equal(SHARED.formInUse(doc([], field({}))), true, 'focused clean input still counts — mid-thought is mid-use');
  assert.equal(SHARED.formInUse(doc([], field({ tagName: 'TEXTAREA' }))), true);
  assert.equal(SHARED.formInUse(doc([], field({ tagName: 'SELECT' }))), true);
  assert.equal(SHARED.formInUse(doc([], { tagName: 'BODY' })), false, 'non-field focus does not pause');
  assert.equal(SHARED.formInUse(doc([], null)), false, 'nothing focused, nothing typed → refresh runs');
});

test('formInUse: UNSAVED TEXT pauses even without focus — the half-typed project name survives 60s+', () => {
  const halfTyped = field({ value: 'Renew the garden lease', defaultValue: '' });
  assert.equal(SHARED.formInUse(doc([halfTyped])), true, 'dirty unfocused input pauses');
  const restoredDraft = field({ value: 'from a restored draft', defaultValue: '' });
  assert.equal(SHARED.formInUse(doc([restoredDraft])), true, 'a restored draft holds the refresh too');
  assert.equal(SHARED.formInUse(doc([field({ tagName: 'TEXTAREA', value: 'update in progress', defaultValue: '' })])), true);
});

test('formInUse: server-rendered prefills are the BASELINE, not unsaved text (prefilled forms never wedge the refresh)', () => {
  const prefilled = field({ value: '4.20', defaultValue: '4.20' });
  assert.equal(SHARED.formInUse(doc([prefilled])), false, 'value === defaultValue is clean');
  const emptied = field({ value: '', defaultValue: '4.20' });
  assert.equal(SHARED.formInUse(doc([emptied])), true, 'explicitly emptying a prefill IS an unsaved edit');
});

test('formInUse: selects pause when changed from their server default (explicit or first option)', () => {
  const opts = [{ value: 'general', defaultSelected: true }, { value: 'health', defaultSelected: false }];
  assert.equal(SHARED.formInUse(doc([field({ tagName: 'SELECT', options: opts, selectedIndex: 0 })])), false);
  assert.equal(SHARED.formInUse(doc([field({ tagName: 'SELECT', options: opts, selectedIndex: 1 })])), true);
  const noDefault = [{ value: 'a', defaultSelected: false }, { value: 'b', defaultSelected: false }];
  assert.equal(SHARED.formInUse(doc([field({ tagName: 'SELECT', options: noDefault, selectedIndex: 0 })])), false, 'no explicit default → first option is the baseline');
  assert.equal(SHARED.formInUse(doc([field({ tagName: 'SELECT', options: noDefault, selectedIndex: 1 })])), true);
  assert.equal(SHARED.formInUse(doc([field({ tagName: 'SELECT', options: [], selectedIndex: -1 })])), false, 'an empty select never pauses');
});

test('formInUse: a ticked-but-unsubmitted checkbox is unsaved state (record-only in the drawer)', () => {
  assert.equal(SHARED.formInUse(doc([field({ type: 'checkbox', checked: true, defaultChecked: false })])), true);
  assert.equal(SHARED.formInUse(doc([field({ type: 'checkbox', checked: false, defaultChecked: false })])), false);
});

test('formInUse: hidden/submit/button inputs never pause, whatever their values', () => {
  for (const type of ['hidden', 'submit', 'button', 'reset', 'file', 'range', 'color']) {
    assert.equal(SHARED.formInUse(doc([field({ type, value: 'junk', defaultValue: '' })])), false, `type=${type} ignored`);
  }
});

// -- shell wiring: pin the bytes so a shell change cannot silently drop the protection ----
function shellHtml() {
  return SHARED.renderShell({ active: 'life-today', title: 't', sub: '', stamp: '', body: '', badges: {}, foot: [] });
}

test('shell wiring: the 30s reload is a RE-ARMING loop guarded by the overlay flag, the hold pin AND the form guard', () => {
  const html = shellHtml();
  assert.ok(html.includes('if(window.__lcOpen||window.__lcHoldRefresh||window.__lcFormBusy(document)){arm();return;}location.reload();'),
    'the reload happens only behind the overlay + hold-pin + form-in-use guard, and a paused tick re-arms (hold pin added with the import preview, 2026-08-08)');
  assert.ok(!html.includes('if(!window.__lcOpen) location.reload()'),
    'the old one-shot reload (overlay-only guard — the defect) must be gone');
  assert.ok(html.includes("document.querySelector('[data-chat-page]')"), 'chat still opts out of auto-refresh entirely');
});

test('shell wiring: the shipped guard is the EXPORTED guard, byte-identical (one source of truth)', () => {
  const html = shellHtml();
  assert.ok(html.includes(`window.__lcFormBusy=(${SHARED.formInUse.toString()})`),
    'client guard must be serialized from the tested formInUse — not a hand-copied twin');
});

test('shell wiring: the draft keeper persists per-page per-field, restores only clean fields, and every submit path clears', () => {
  const html = shellHtml();
  assert.ok(html.includes("'lcDraft:'+location.pathname+':'"), 'draft keys are per-page per-field');
  assert.ok(html.includes('sessionStorage.setItem'), 'drafts persist to sessionStorage (per-tab, never at rest server-side)');
  assert.ok(html.includes('sessionStorage.getItem'), 'drafts restore on load');
  assert.ok(!/localStorage/.test(html), 'sessionStorage ONLY — the privacy call: drafts die with the tab');
  assert.ok(html.includes("if(String(el.value||'')!==base(el))continue;"), 'restore never clobbers a field the owner already touched');
  const clears = html.split('window.__lcDraftClear(').length - 1;
  assert.ok(clears >= 3, `capture + create + note submit paths each clear their drafts (found ${clears} call sites)`);
});
