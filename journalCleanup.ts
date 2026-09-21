type JournalDateToken = 'YYYY' | 'MM' | 'DD';

const JOURNAL_DATE_TOKENS: readonly JournalDateToken[] = ['YYYY', 'MM', 'DD'];

/** Treat the Logseq list marker inserted into a journal as empty content. */
export function isEmptyJournalContent(content: string): boolean {
    return content.trim() === '-';
}

/**
 * Parse the configured daily-note path. Automatic deletion intentionally
 * supports only unambiguous four-digit year, two-digit month, and two-digit
 * day formats.
 */
export function parseJournalDate(relativePath: string, journalFormat: string): string | null {
    const tokens: JournalDateToken[] = [];
    let pattern = '^';

    for (let index = 0; index < journalFormat.length;) {
        const token = JOURNAL_DATE_TOKENS.find(candidate => journalFormat.startsWith(candidate, index));
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

    const values: Record<JournalDateToken, number> = { YYYY: 0, MM: 0, DD: 0 };
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

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function getLocalDateKey(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

/** Limit automatic cleanup to valid journal files dated before today. */
export function isEarlierJournalFile(
    file: { path: string },
    journalFolder: string,
    journalDate: string | null,
    todayDate: string,
    activeFilePath: string | null = null,
): boolean {
    return file.path.startsWith(`${journalFolder}/`)
        && file.path !== activeFilePath
        && journalDate !== null
        && journalDate < todayDate;
}

/** Automatic cleanup may be attempted at most once per local calendar day. */
export function shouldRunDailyCleanup(lastCleanupDate: string | undefined, todayDate: string): boolean {
    return lastCleanupDate !== todayDate;
}
