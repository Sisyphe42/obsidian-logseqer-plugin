# Obsidian Logseqer Plugin

An Obsidian plugin designed to provide a Logseq-native experience and enhance workflow compatibility between both applications.

## Main Features

All features can be enabled/disabled individually in plugin settings for maximum customization.

### 1. Syntax Check

Real-time validation showing if lines follow Logseq's `- ` format. Status shown in status bar.

### 2. Vault Compatibility Check

Command to check date formats, journals/pages settings, namespace consistency, and task markers throughout the vault.

> WIP: Needing more feedback and functionality. Having the potential to be the main feature if it works well.

### 3. Bookmark Sync

Syncs Logseq favorites to Obsidian bookmarks. Handles duplicates and creates missing pages if needed with manual confirmation.

### 4. Journal Enhancements

- Auto-formats new journal files
- Customizable default backlinks query

## Quick Start

1. Install plugin in `.obsidian/plugins/`
2. Enable in Settings → Community Plugins
3. Configure folder paths in settings (with autocomplete and default values which recommended)
4. Run `Sync Settings` command to sync bookmarks

## Build

```bash
npm install
npm run build
```

## Settings

- **Toggle Features**: Enable/disable each feature independently
- **Folder Configuration**: Logseq and Obsidian folders (autocomplete available)
- **Backlink Query**: Customize journal backlinks filter
- **Restore Defaults**: Reset all settings to defaults

## License

MIT
