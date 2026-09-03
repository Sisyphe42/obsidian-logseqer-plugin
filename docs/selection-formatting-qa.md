# Selection formatting QA

## Automated coverage

- Action routing: master switch and `command` / `context-menu` / `both`
- Editor adapter: replacement, undo origin, and retained selection
- LF and CRLF line endings
- Idempotent unordered-list conversion and empty-line handling
- Soft/hard line-break conversion and no-op reporting
- Fenced code, tables, multiline HTML, paragraph separators, and non-paragraph blocks
- Selections that begin inside a protected block

Run with:

```bash
npm test
npm run build
```

## Desktop manual check

1. Select multiple paragraph lines in Source mode and Live Preview.
2. Run each action from the context menu and command palette.
3. Confirm the result notice reports the changed count or a no-op.
4. Set each action to `Command only`, `Context menu only`, and `Command and context menu`; verify only the selected surfaces appear.
5. Disable the master switch and verify all three actions disappear.
6. Enable Strict line breaks and confirm soft and hard breaks render differently.
7. Undo each transform once and confirm the full selection reverts in one step.

## Mobile manual check

1. Open a Markdown note in the Obsidian mobile editor.
2. Select text and long-press the selection.
3. Verify only actions configured for the context menu appear.
4. Run all three actions and confirm the same notices and protected-block behavior as desktop.
5. Set one action to `Command only`; verify it disappears from long-press while remaining available from the command palette.
6. Disable the master switch and verify all three actions disappear.
