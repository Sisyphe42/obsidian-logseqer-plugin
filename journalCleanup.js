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
 * Limit automatic cleanup to valid journal files dated before today.
 * The active file is retained so an empty journal being edited is never trashed.
 *
 * @param {{ path: string }} file
 * @param {string} journalFolder
 * @param {string | null} journalDate ISO local date parsed from the configured journal format
 * @param {string} todayDate ISO local date
 * @param {string | null} activeFilePath
 * @returns {boolean}
 */
export function isEarlierJournalFile(file, journalFolder, journalDate, todayDate, activeFilePath = null) {
    return file.path.startsWith(`${journalFolder}/`)
        && file.path !== activeFilePath
        && journalDate !== null
        && journalDate < todayDate;
}

/**
 * Automatic cleanup may be attempted at most once per local calendar day.
 *
 * @param {string | undefined} lastCleanupDate
 * @param {string} todayDate
 * @returns {boolean}
 */
export function shouldRunDailyCleanup(lastCleanupDate, todayDate) {
    return lastCleanupDate !== todayDate;
}
