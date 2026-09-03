import assert from 'node:assert/strict';
import test from 'node:test';

import { addListMarkers, hardBreaksToSoft, softBreaksToHard } from '../textTransforms.js';

test('addListMarkers prefixes every selected line and preserves indentation', () => {
    assert.equal(addListMarkers('alpha\n  beta\n\ngamma'), '- alpha\n  - beta\n- \n- gamma');
});

test('addListMarkers does not create an item after a trailing line ending', () => {
    assert.equal(addListMarkers('alpha\r\nbeta\r\n'), '- alpha\r\n- beta\r\n');
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

test('hard and soft transforms round-trip canonical hard breaks', () => {
    const soft = 'alpha\nbeta\r\ngamma';
    assert.equal(hardBreaksToSoft(softBreaksToHard(soft)), soft);
});
