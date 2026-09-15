import assert from 'node:assert/strict';
import test from 'node:test';

import { isEarlierJournalFile, isEmptyJournalContent } from '../journalCleanup.js';

test('empty journals contain only the Logseq list marker and whitespace', () => {
    assert.equal(isEmptyJournalContent('- '), true);
    assert.equal(isEmptyJournalContent('\n  -  \n'), true);
    assert.equal(isEmptyJournalContent(''), false);
    assert.equal(isEmptyJournalContent('- note'), false);
});

test('automatic cleanup selects only earlier journals and retains the new journal', () => {
    const current = { path: 'journals/2026_09_15.md', stat: { ctime: 200 } };

    assert.equal(isEarlierJournalFile({ path: 'journals/2026_09_14.md', stat: { ctime: 100 } }, current, 'journals'), true);
    assert.equal(isEarlierJournalFile({ path: current.path, stat: { ctime: 200 } }, current, 'journals'), false);
    assert.equal(isEarlierJournalFile({ path: 'journals/2026_09_16.md', stat: { ctime: 300 } }, current, 'journals'), false);
    assert.equal(isEarlierJournalFile({ path: 'journals-archive/old.md', stat: { ctime: 100 } }, current, 'journals'), false);
});
