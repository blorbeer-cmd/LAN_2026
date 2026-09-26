import { test } from 'node:test';
import assert from 'node:assert/strict';
import { actionMenuHtml } from './actionMenu.js';

const edit = '<button type="button" class="btn btn-sm" data-edit>Bearbeiten</button>';
const end = '<button type="button" class="btn btn-sm" data-end>Beenden</button>';
const remove = '<button type="button" class="btn btn-sm btn-danger" data-remove>Löschen</button>';

test('an action menu only bundles more entries than it may show inline', () => {
  assert.equal(actionMenuHtml([], 'Aktionen für X'), '');
  assert.equal(actionMenuHtml(['', null], 'Aktionen für X'), '', 'empty entries are no actions');

  // A lone action is the button itself, not a menu with one entry.
  assert.equal(actionMenuHtml([edit, ''], 'Aktionen für X'), edit);
  assert.match(actionMenuHtml([edit, remove], 'Aktionen für X'), /^<details class="action-menu">/);

  // A caller may keep a pair inline; the next entry bundles all of them.
  assert.equal(actionMenuHtml([edit, end], 'Aktionen für X', { inlineMax: 2 }), `${edit}${end}`);
  const menu = actionMenuHtml([edit, end, remove], 'Aktionen für "X"', { inlineMax: 2, key: 'k1' });
  assert.match(menu, /^<details class="action-menu" data-action-menu="k1">/);
  assert.match(menu, /aria-label="Aktionen für &quot;X&quot;">Aktion /);
  assert.ok(menu.includes(`<div class="action-menu-panel">${edit}${end}${remove}</div>`));
});
