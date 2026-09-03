/**
 * Prefix each selected line with a Markdown list marker while preserving its
 * indentation and original line endings. A trailing line ending does not
 * create an extra list item outside the selection.
 *
 * @param {string} text
 * @returns {string}
 */
export function addListMarkers(text) {
    if (text.length === 0) return text;

    return text.replace(/(^|\r\n|\n|\r(?!\n))(?!$)([\t ]*)/g, '$1$2- ');
}

/**
 * Convert CommonMark hard line breaks to soft line breaks. CommonMark accepts
 * either two or more trailing spaces or a trailing backslash as a hard-break
 * marker.
 *
 * @param {string} text
 * @returns {string}
 */
export function hardBreaksToSoft(text) {
    return text.replace(/([^\r\n]*)(\r\n|\n|\r)/g, (_match, line, ending) => {
        if (/ {2,}$/.test(line)) return line.replace(/ {2,}$/, '') + ending;
        if (hasTrailingHardBreakBackslash(line)) return line.slice(0, -1) + ending;
        return line + ending;
    });
}

/**
 * Convert soft line breaks to the canonical two-trailing-space CommonMark hard
 * line break. Existing hard line breaks are left unchanged.
 *
 * @param {string} text
 * @returns {string}
 */
export function softBreaksToHard(text) {
    return text.replace(/([^\r\n]*)(\r\n|\n|\r)/g, (_match, line, ending) => {
        if (/ {2,}$/.test(line) || hasTrailingHardBreakBackslash(line)) return line + ending;
        return line.replace(/[\t ]+$/, '') + '  ' + ending;
    });
}

/**
 * A trailing backslash is a hard-break marker only when it is not itself
 * escaped, i.e. when the trailing run contains an odd number of backslashes.
 *
 * @param {string} line
 * @returns {boolean}
 */
function hasTrailingHardBreakBackslash(line) {
    const match = line.match(/(\\+)$/);
    return match !== null && match[1].length % 2 === 1;
}
