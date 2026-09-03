import assert from 'node:assert/strict';
import test from 'node:test';

import { applySelectionAction, isSelectionActionAvailable } from '../selectionActions.js';

class FakeEditor {
    constructor(content, selectionStart, selectionEnd) {
        this.content = content;
        this.selectionStart = selectionStart;
        this.selectionEnd = selectionEnd;
        this.lastOrigin = null;
    }

    getSelection() {
        return this.content.slice(this.selectionStart, this.selectionEnd);
    }

    getCursor() {
        return this.offsetToPos(this.selectionStart);
    }

    getRange(from, to) {
        return this.content.slice(this.posToOffset(from), this.posToOffset(to));
    }

    posToOffset(pos) {
        const lines = this.content.split('\n');
        let offset = 0;
        for (let line = 0; line < pos.line; line++) offset += lines[line].length + 1;
        return offset + pos.ch;
    }

    offsetToPos(offset) {
        const prefix = this.content.slice(0, offset);
        const lines = prefix.split('\n');
        return { line: lines.length - 1, ch: lines.at(-1).length };
    }

    replaceSelection(text, origin) {
        this.content = this.content.slice(0, this.selectionStart) + text + this.content.slice(this.selectionEnd);
        this.selectionEnd = this.selectionStart + text.length;
        this.lastOrigin = origin;
    }

    setSelection(anchor, head) {
        this.selectionStart = this.posToOffset(anchor);
        this.selectionEnd = this.posToOffset(head);
    }
}

test('action modes independently route commands and context menus', () => {
    assert.equal(isSelectionActionAvailable(true, 'both', 'command'), true);
    assert.equal(isSelectionActionAvailable(true, 'both', 'context-menu'), true);
    assert.equal(isSelectionActionAvailable(true, 'command', 'context-menu'), false);
    assert.equal(isSelectionActionAvailable(true, 'context-menu', 'command'), false);
    assert.equal(isSelectionActionAvailable(false, 'both', 'command'), false);
});

test('editor action replaces once and keeps transformed text selected', () => {
    const editor = new FakeEditor('before\nalpha\nbeta\nafter', 7, 17);
    const result = applySelectionAction(editor, 'add-list-markers');

    assert.deepEqual(result, { text: '- alpha\n- beta', changes: 2 });
    assert.equal(editor.content, 'before\n- alpha\n- beta\nafter');
    assert.equal(editor.getSelection(), '- alpha\n- beta');
    assert.equal(editor.lastOrigin, 'logseqer-selection-transform');
});

test('editor action respects fenced-code context outside the selection', () => {
    const content = '```js\nalpha\nbeta\n```';
    const editor = new FakeEditor(content, 6, 16);
    const result = applySelectionAction(editor, 'add-list-markers');

    assert.equal(result.changes, 0);
    assert.equal(editor.content, content);
    assert.equal(editor.lastOrigin, null);
});
