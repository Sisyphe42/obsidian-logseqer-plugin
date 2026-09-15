/**
 * Treat the Logseq list marker inserted into a journal as empty content.
 *
 * @param {string} content
 * @returns {boolean}
 */
export function isEmptyJournalContent(content) {
    return content.trim() === '-';
}

/**
 * Limit automatic cleanup to journals created no later than the new journal.
 * The new journal itself is always retained.
 *
 * @param {{ path: string, stat: { ctime: number } }} file
 * @param {{ path: string, stat: { ctime: number } }} currentJournal
 * @param {string} journalFolder
 * @returns {boolean}
 */
export function isEarlierJournalFile(file, currentJournal, journalFolder) {
    return file.path.startsWith(`${journalFolder}/`)
        && file.path !== currentJournal.path
        && file.stat.ctime <= currentJournal.stat.ctime;
}
