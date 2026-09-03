import assert from 'node:assert/strict';
import test from 'node:test';

import {
    addListMarkers,
    getMarkdownContext,
    hardBreaksToSoft,
    softBreaksToHard,
    transformSelection,
} from '../textTransforms.js';

test('addListMarkers prefixes every selected line and preserves indentation', () => {
    assert.equal(addListMarkers('alpha\n  beta\n\ngamma'), '- alpha\n  - beta\n\n- gamma');
});

test('addListMarkers does not create an item after a trailing line ending', () => {
    assert.equal(addListMarkers('alpha\r\nbeta\r\n'), '- alpha\r\n- beta\r\n');
});

test('addListMarkers is idempotent for existing bullet items', () => {
    assert.equal(addListMarkers('- alpha\n  * beta\n+ gamma'), '- alpha\n  * beta\n+ gamma');
});

test('addListMarkers protects fenced code, tables, and multiline HTML', () => {
    const input = '```md\ncode\n```\n\n| a | b |\n|---|---|\n\n<div>\nfirst\nsecond\n</div>';
    assert.equal(addListMarkers(input), input);
});

test('a selection beginning inside a fenced block inherits document context', () => {
    const context = getMarkdownContext('before\n```js\n');
    assert.deepEqual(context.initialFence, { character: '`', length: 3 });
    assert.equal(addListMarkers('const a = 1;\nconst b = 2;', context), 'const a = 1;\nconst b = 2;');
});

test('hardBreaksToSoft recognizes both CommonMark hard-break forms', () => {
    assert.equal(hardBreaksToSoft('alpha  \nbeta\\\r\ngamma'), 'alpha\nbeta\r\ngamma');
});

test('line-break transforms preserve an escaped trailing backslash', () => {
    const soft = 'alpha\\\\\nbeta';
    assert.equal(hardBreaksToSoft(soft), soft);
    assert.equal(softBreaksToHard(soft), 'alpha\\\\  \nbeta');
});

test('softBreaksToHard uses two spaces and preserves line endings', () => {
    assert.equal(softBreaksToHard('alpha\nbeta\r\ngamma'), 'alpha  \nbeta  \r\ngamma');
});

test('softBreaksToHard leaves existing hard breaks unchanged', () => {
    assert.equal(softBreaksToHard('alpha  \nbeta\\\ngamma'), 'alpha  \nbeta\\\ngamma');
});

test('line-break transforms only change breaks inside plain paragraphs', () => {
    const input = 'alpha\nbeta\n\ngamma\ndelta\n\n- one\n- two\n\n| a | b |\n|---|---|';
    const expected = 'alpha  \nbeta\n\ngamma  \ndelta\n\n- one\n- two\n\n| a | b |\n|---|---|';
    assert.equal(softBreaksToHard(input), expected);
});

test('transformSelection reports the number of changed lines or breaks', () => {
    assert.deepEqual(transformSelection('add-list-markers', 'alpha\n\nbeta'), {
        text: '- alpha\n\n- beta',
        changes: 2,
    });
    assert.deepEqual(transformSelection('soft-breaks-to-hard', 'alpha\nbeta\ngamma'), {
        text: 'alpha  \nbeta  \ngamma',
        changes: 2,
    });
});

test('hard and soft transforms round-trip canonical hard breaks', () => {
    const soft = 'alpha\nbeta\r\ngamma';
    assert.equal(hardBreaksToSoft(softBreaksToHard(soft)), soft);
});
