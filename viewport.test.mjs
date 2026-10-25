import test from 'node:test';
import assert from 'node:assert/strict';
import { keyboardOpen, nextBaseline, isEditable, KEYBOARD_MIN_PX } from './app/viewport.js';

test('keyboard is open only on touch screens, while typing, after a real shrink', () => {
  assert.equal(keyboardOpen({ height: 400, baseline: 760, editing: true, coarse: true }), true);
  assert.equal(keyboardOpen({ height: 400, baseline: 760, editing: false, coarse: true }), false, 'no text field focused');
  assert.equal(keyboardOpen({ height: 400, baseline: 760, editing: true, coarse: false }), false, 'a desktop window resize is not a keyboard');
  assert.equal(keyboardOpen({ height: 760 - KEYBOARD_MIN_PX + 1, baseline: 760, editing: true, coarse: true }), false, 'browser toolbar changes stay below the threshold');
  assert.equal(keyboardOpen({ height: NaN, baseline: 760, editing: true, coarse: true }), false);
  assert.equal(keyboardOpen({ height: 400, baseline: 0, editing: true, coarse: true }), false, 'no baseline yet');
});

test('baseline remembers the full height without the keyboard', () => {
  assert.equal(nextBaseline(0, 760, false, false, 760), 760);
  assert.equal(nextBaseline(760, 400, true, false, 760), 760, 'keyboard shrink keeps the baseline');
  assert.equal(nextBaseline(760, 800, true, false, 800), 800, 'a hiding toolbar grows it');
  assert.equal(nextBaseline(760, 700, false, false, 700), 700, 'without typing the current height is the baseline');
  assert.equal(nextBaseline(760, 300, true, true, 390), 390, 'rotation while typing falls back to the layout height');
  assert.equal(nextBaseline(760, 390, false, true, 390), 390);
});

test('only text fields count as typing', () => {
  assert.equal(isEditable({ tagName: 'INPUT', type: 'text' }), true);
  assert.equal(isEditable({ tagName: 'input' }), true, 'type defaults to text');
  assert.equal(isEditable({ tagName: 'INPUT', type: 'checkbox' }), false);
  assert.equal(isEditable({ tagName: 'INPUT', type: 'text', disabled: true }), false);
  assert.equal(isEditable({ tagName: 'INPUT', type: 'text', readOnly: true }), false);
  assert.equal(isEditable({ tagName: 'TEXTAREA' }), true);
  assert.equal(isEditable({ tagName: 'DIV', isContentEditable: true }), true);
  assert.equal(isEditable({ tagName: 'BUTTON' }), false);
  assert.equal(isEditable(null), false);
});
