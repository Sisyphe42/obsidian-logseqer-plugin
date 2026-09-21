import assert from 'node:assert/strict';
import test from 'node:test';

import {
    getLocalDateKey,
    isEarlierJournalFile,
    isEmptyJournalContent,
    parseJournalDate,
    shouldRunDailyCleanup,
} from '../journalCleanup.js';

test('empty journals contain only the Logseq list marker and whitespace', () => {
    assert.equal(isEmptyJournalContent('- '), true);
    assert.equal(isEmptyJournalContent('\n  -  \n'), true);
    assert.equal(isEmptyJournalContent(''), false);
    assert.equal(isEmptyJournalContent('- note'), false);
});

test('journal dates are parsed from safe daily-note formats', () => {
    assert.equal(parseJournalDate('2026_09_21', 'YYYY_MM_DD'), '2026-09-21');
    assert.equal(parseJournalDate('archive/2026-09-21', '[archive]/YYYY-MM-DD'), '2026-09-21');
    assert.equal(parseJournalDate('2026_02_29', 'YYYY_MM_DD'), null);
    assert.equal(parseJournalDate('21_09_2026', 'DD_MM_YYYY'), '2026-09-21');
    assert.equal(parseJournalDate('Sep 21, 2026', 'MMM D, YYYY'), null);
});

test('local date keys do not depend on UTC conversion', () => {
    assert.equal(getLocalDateKey(new Date(2026, 8, 21, 0, 5)), '2026-09-21');
});

test('automatic cleanup selects only journals dated before today', () => {
    const today = '2026-09-21';

    assert.equal(isEarlierJournalFile({ path: 'journals/2026_09_20.md' }, 'journals', '2026-09-20', today), true);
    assert.equal(isEarlierJournalFile({ path: 'journals/2026_09_21.md' }, 'journals', today, today), false);
    assert.equal(isEarlierJournalFile({ path: 'journals/2026_09_22.md' }, 'journals', '2026-09-22', today), false);
    assert.equal(isEarlierJournalFile({ path: 'journals/not-a-date.md' }, 'journals', null, today), false);
    assert.equal(isEarlierJournalFile({ path: 'journals-archive/old.md' }, 'journals', '2026-09-20', today), false);
});

test('automatic cleanup retains the active older journal', () => {
    const activePath = 'journals/2026_09_20.md';

    assert.equal(isEarlierJournalFile({ path: activePath }, 'journals', '2026-09-20', '2026-09-21', activePath), false);
});

test('automatic cleanup runs at most once per local day', () => {
    assert.equal(shouldRunDailyCleanup(undefined, '2026-09-21'), true);
    assert.equal(shouldRunDailyCleanup('2026-09-20', '2026-09-21'), true);
    assert.equal(shouldRunDailyCleanup('2026-09-21', '2026-09-21'), false);
});
