import { getMarkdownContext, transformSelection } from './textTransforms.js';

/** @typedef {'add-list-markers' | 'hard-breaks-to-soft' | 'soft-breaks-to-hard'} SelectionActionId */
/** @typedef {'command' | 'context-menu' | 'both'} SelectionActionMode */
/** @typedef {'command' | 'context-menu'} SelectionActionSurface */

/**
 * @param {boolean} enabled
 * @param {SelectionActionMode} mode
 * @param {SelectionActionSurface} surface
 */
export function isSelectionActionAvailable(enabled, mode, surface) {
    return enabled && (mode === 'both' || mode === surface);
}

/**
 * Apply an action through Obsidian's Editor-compatible interface and keep the transformed text selected.
 *
 * @param {{
 *   getSelection(): string,
 *   getCursor(side: 'from'): { line: number, ch: number },
 *   getRange(from: { line: number, ch: number }, to: { line: number, ch: number }): string,
 *   posToOffset(pos: { line: number, ch: number }): number,
 *   offsetToPos(offset: number): { line: number, ch: number },
 *   replaceSelection(text: string, origin?: string): void,
 *   setSelection(anchor: { line: number, ch: number }, head: { line: number, ch: number }): void
 * }} editor
 * @param {SelectionActionId} action
 */
export function applySelectionAction(editor, action) {
    const selectedText = editor.getSelection();
    if (selectedText.length === 0) return { text: selectedText, changes: 0 };

    const from = editor.getCursor('from');
    const startOffset = editor.posToOffset(from);
    const prefix = editor.getRange({ line: 0, ch: 0 }, from);
    const result = transformSelection(action, selectedText, getMarkdownContext(prefix));

    if (result.changes === 0) return result;

    editor.replaceSelection(result.text, 'logseqer-selection-transform');
    editor.setSelection(from, editor.offsetToPos(startOffset + result.text.length));
    return result;
}
