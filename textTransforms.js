/** @typedef {'add-list-markers' | 'hard-breaks-to-soft' | 'soft-breaks-to-hard'} SelectionActionId */
/** @typedef {{ character: '`' | '~', length: number } | null} FenceState */
/** @typedef {string | null} HtmlState */
/** @typedef {{ initialFence?: FenceState, initialHtmlTag?: HtmlState }} TransformContext */
/** @typedef {{ text: string, changes: number }} TransformResult */

/**
 * Apply one selection transform and report how many lines or line breaks were changed.
 *
 * @param {SelectionActionId} action
 * @param {string} text
 * @param {TransformContext} [context]
 * @returns {TransformResult}
 */
export function transformSelection(action, text, context = {}) {
    if (action === 'add-list-markers') return addListMarkersWithResult(text, context);
    if (action === 'hard-breaks-to-soft') return hardBreaksToSoftWithResult(text, context);
    return softBreaksToHardWithResult(text, context);
}

/**
 * Prefix non-empty, non-protected lines with a Markdown unordered-list marker.
 * Existing unordered-list items are left unchanged.
 *
 * @param {string} text
 * @param {TransformContext} [context]
 */
export function addListMarkers(text, context = {}) {
    return addListMarkersWithResult(text, context).text;
}

/**
 * Convert CommonMark hard breaks inside plain paragraphs to soft breaks.
 *
 * @param {string} text
 * @param {TransformContext} [context]
 */
export function hardBreaksToSoft(text, context = {}) {
    return hardBreaksToSoftWithResult(text, context).text;
}

/**
 * Convert soft breaks inside plain paragraphs to canonical hard breaks.
 *
 * @param {string} text
 * @param {TransformContext} [context]
 */
export function softBreaksToHard(text, context = {}) {
    return softBreaksToHardWithResult(text, context).text;
}

/**
 * Determine whether a text prefix ends inside a fenced code block.
 *
 * @param {string} text
 * @returns {FenceState}
 */
export function getFenceState(text) {
    return getMarkdownContext(text).initialFence;
}

/**
 * Determine protected block state at the end of a document prefix.
 *
 * @param {string} text
 * @returns {{ initialFence: FenceState, initialHtmlTag: HtmlState }}
 */
export function getMarkdownContext(text) {
    const lines = splitLines(text);
    let fenceState = null;
    let htmlState = null;

    for (const line of lines) {
        const fenceBefore = fenceState;
        const fence = readFence(line.content);
        fenceState = advanceFenceState(fenceState, line.content);
        if (fenceBefore === null && fence === null) htmlState = advanceHtmlState(htmlState, line.content);
    }

    return { initialFence: fenceState, initialHtmlTag: htmlState };
}

/**
 * @param {string} text
 * @param {TransformContext} context
 * @returns {TransformResult}
 */
function addListMarkersWithResult(text, context) {
    if (text.length === 0) return { text, changes: 0 };

    const lines = splitLines(text);
    const protectedLines = analyzeProtectedLines(lines, context.initialFence ?? null, context.initialHtmlTag ?? null);
    let changes = 0;

    const transformed = lines.map((line, index) => {
        if (isBlank(line.content) || protectedLines[index] || isUnorderedListItem(line.content)) {
            return line.content + line.ending;
        }

        changes++;
        return line.content.replace(/^([\t ]*)/, '$1- ') + line.ending;
    }).join('');

    return { text: transformed, changes };
}

/**
 * @param {string} text
 * @param {TransformContext} context
 * @returns {TransformResult}
 */
function hardBreaksToSoftWithResult(text, context) {
    return transformParagraphBreaks(text, context, (line) => {
        if (/ {2,}$/.test(line)) return { line: line.replace(/ {2,}$/, ''), changed: true };
        if (hasTrailingHardBreakBackslash(line)) return { line: line.slice(0, -1), changed: true };
        return { line, changed: false };
    });
}

/**
 * @param {string} text
 * @param {TransformContext} context
 * @returns {TransformResult}
 */
function softBreaksToHardWithResult(text, context) {
    return transformParagraphBreaks(text, context, (line) => {
        if (/ {2,}$/.test(line) || hasTrailingHardBreakBackslash(line)) return { line, changed: false };
        return { line: line.replace(/[\t ]+$/, '') + '  ', changed: true };
    });
}

/**
 * @param {string} text
 * @param {TransformContext} context
 * @param {(line: string) => { line: string, changed: boolean }} transform
 * @returns {TransformResult}
 */
function transformParagraphBreaks(text, context, transform) {
    const lines = splitLines(text);
    const protectedLines = analyzeProtectedLines(lines, context.initialFence ?? null, context.initialHtmlTag ?? null);
    let changes = 0;

    const transformed = lines.map((line, index) => {
        const nextLine = lines[index + 1];
        const canTransform = line.ending.length > 0
            && nextLine !== undefined
            && isPlainParagraphLine(line.content)
            && isPlainParagraphLine(nextLine.content)
            && !protectedLines[index]
            && !protectedLines[index + 1];

        if (!canTransform) return line.content + line.ending;

        const result = transform(line.content);
        if (result.changed) changes++;
        return result.line + line.ending;
    }).join('');

    return { text: transformed, changes };
}

/**
 * @param {Array<{ content: string, ending: string }>} lines
 * @param {FenceState} initialFence
 * @param {HtmlState} initialHtmlTag
 */
function analyzeProtectedLines(lines, initialFence, initialHtmlTag) {
    let fenceState = initialFence;
    let htmlState = initialHtmlTag;

    return lines.map((line) => {
        const fence = readFence(line.content);
        const fenceBefore = fenceState;
        const protectedLine = fenceState !== null
            || fence !== null
            || htmlState !== null
            || isTableLine(line.content)
            || isHtmlLine(line.content);

        fenceState = advanceFenceState(fenceState, line.content);
        if (fenceBefore === null && fence === null) htmlState = advanceHtmlState(htmlState, line.content);
        return protectedLine;
    });
}

/**
 * @param {FenceState} state
 * @param {string} line
 * @returns {FenceState}
 */
function advanceFenceState(state, line) {
    const fence = readFence(line);
    if (fence === null) return state;
    if (state === null) return fence;
    if (fence.character === state.character && fence.length >= state.length && isClosingFence(line)) return null;
    return state;
}

/**
 * @param {string} line
 * @returns {FenceState}
 */
function readFence(line) {
    const match = line.match(/^ {0,3}(`{3,}|~{3,})/);
    if (match === null) return null;
    return { character: /** @type {'`' | '~'} */ (match[1][0]), length: match[1].length };
}

/** @param {string} line */
function isClosingFence(line) {
    return /^ {0,3}(?:`{3,}|~{3,})[\t ]*$/.test(line);
}

/**
 * @param {HtmlState} state
 * @param {string} line
 * @returns {HtmlState}
 */
function advanceHtmlState(state, line) {
    if (state !== null) {
        if (state === '!--' ? line.includes('-->') : new RegExp(`</${state}\\s*>`, 'i').test(line)) return null;
        return state;
    }

    if (/^\s*<!--/.test(line) && !line.includes('-->')) return '!--';
    const match = line.match(/^\s*<(address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul)(?:\s|>|\/)/i);
    if (match === null || /\/>\s*$/.test(line)) return null;

    const tag = match[1].toLowerCase();
    return new RegExp(`</${tag}\\s*>`, 'i').test(line) ? null : tag;
}

/** @param {string} text */
function splitLines(text) {
    const lines = [];
    const pattern = /([^\r\n]*)(\r\n|\n|\r)/g;
    let lastIndex = 0;
    let match;

    while ((match = pattern.exec(text)) !== null) {
        lines.push({ content: match[1], ending: match[2] });
        lastIndex = pattern.lastIndex;
    }

    lines.push({ content: text.slice(lastIndex), ending: '' });
    return lines;
}

/** @param {string} line */
function isBlank(line) {
    return line.trim().length === 0;
}

/** @param {string} line */
function isUnorderedListItem(line) {
    return /^[\t ]*[-+*][\t ]+/.test(line);
}

/** @param {string} line */
function isTableLine(line) {
    const trimmed = line.trim();
    return /^\|.*\|$/.test(trimmed)
        || /^:?-{3,}:?(?:\s*\|\s*:?-{3,}:?)+\s*\|?$/.test(trimmed);
}

/** @param {string} line */
function isHtmlLine(line) {
    return /^\s*<\/?[A-Za-z][^>]*>/.test(line);
}

/** @param {string} line */
function isPlainParagraphLine(line) {
    const trimmed = line.trim();
    if (trimmed.length === 0) return false;
    if (/^(?:#{1,6}\s|>|[-+*]\s|\d+[.)]\s)/.test(trimmed)) return false;
    if (/^(?:[-*_]\s*){3,}$/.test(trimmed)) return false;
    if (/^(?: {4}|\t)/.test(line)) return false;
    return !isTableLine(line) && !isHtmlLine(line) && readFence(line) === null;
}

/** @param {string} line */
function hasTrailingHardBreakBackslash(line) {
    const match = line.match(/(\\+)$/);
    return match !== null && match[1].length % 2 === 1;
}
