// @ts-check

/** @typedef {'YYYY' | 'MM' | 'DD'} JournalDateToken */

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
 * Parse the configured daily-note path without relying on Obsidian's untyped
 * moment export. Automatic deletion intentionally supports only unambiguous
 * four-digit year, two-digit month, and two-digit day formats.
 *
 * @param {string} relativePath Journal path below the configured journal folder, without .md
 * @param {string} journalFormat Obsidian daily-note format
 * @returns {string | null} ISO local date
 */
export function parseJournalDate(relativePath, journalFormat) {
    /** @type {JournalDateToken[]} */
    const tokens = [];
    let pattern = '^';

    for (let index = 0; index < journalFormat.length;) {
        /** @type {JournalDateToken | undefined} */
        const token = /** @type {JournalDateToken[]} */ (['YYYY', 'MM', 'DD'])
            .find(candidate => journalFormat.startsWith(candidate, index));
        if (token !== undefined) {
            if (tokens.includes(token)) return null;
            tokens.push(token);
            pattern += token === 'YYYY' ? '(\\d{4})' : '(\\d{2})';
            index += token.length;
            continue;
        }

        if (journalFormat[index] === '[') {
            const closingBracket = journalFormat.indexOf(']', index + 1);
            if (closingBracket === -1) return null;
            pattern += escapeRegExp(journalFormat.slice(index + 1, closingBracket));
            index = closingBracket + 1;
            continue;
        }

        const literal = journalFormat[index];
        if (/[A-Za-z]/.test(literal)) return null;
        pattern += escapeRegExp(literal);
        index++;
    }

    if (tokens.length !== 3) return null;
    const match = new RegExp(`${pattern}$`).exec(relativePath);
    if (match === null) return null;

    /** @type {Record<JournalDateToken, number>} */
    const values = { YYYY: 0, MM: 0, DD: 0 };
    tokens.forEach((token, index) => {
        values[token] = Number(match[index + 1]);
    });
    const year = values.YYYY;
    const month = values.MM;
    const day = values.DD;
    if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
    if (month < 1 || month > 12 || day < 1 || day > new Date(Date.UTC(year, month, 0)).getUTCDate()) return null;

    return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {Date} date
 * @returns {string}
 */
export function getLocalDateKey(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
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
