import { Plugin, WorkspaceLeaf, MarkdownView, Notice, TFile, PluginSettingTab, Setting, Modal, App, TextComponent, TFolder, TAbstractFile, Component } from 'obsidian';
import { checkLogseqSyntaxDOM } from './logseqSyntax';

// Utility function for setting element styles (centralized for Obsidian best practices)
function setElementStyles(el: HTMLElement, styles: Record<string, string>): void {
    Object.entries(styles).forEach(([key, value]) => {
        const cssKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
        el.style.setProperty(cssKey, value);
    });
}

// Interface for settings can be added here
// Interface for settings
interface BookmarkItem {
    type: string;
    path?: string;
    ctime?: number;
    [key: string]: unknown;
}

// Interface for mock file objects used in simulations
interface MockFile {
    path: string;
    basename: string;
}

interface LogseqerSettings {
    enableSyntaxCheck: boolean;
    enableJournalNew: boolean;
    enableBacklinkQuery: boolean;
    backlinkQueryString: string;
    logseqFolder: string; // Folder containing Logseq files
    developerMode?: boolean;
    enableVaultCommand?: boolean;
    enableSyncCommand?: boolean;
    enableVaultDateCheck?: boolean;
    enableVaultNamespaceCheck?: boolean;
    enableVaultTaskMarkerCheck?: boolean;
    enableVaultFolderSettingsCheck?: boolean;
    bookmarkSyncDirection?: 'obsidian-to-logseq' | 'logseq-to-obsidian' | 'bidirectional'; // Bookmark sync direction
}

const DEFAULT_SETTINGS: LogseqerSettings = {
    enableSyntaxCheck: true,
    enableJournalNew: true,
    enableBacklinkQuery: true,
    backlinkQueryString: '-path:"journals/Journaling"',
    logseqFolder: 'logseq',
    developerMode: false,
    enableVaultCommand: true,
    enableSyncCommand: true,
    enableVaultDateCheck: true,
    enableVaultNamespaceCheck: true,
    enableVaultTaskMarkerCheck: true,
    enableVaultFolderSettingsCheck: true,
    bookmarkSyncDirection: 'obsidian-to-logseq', // Default: Obsidian to Logseq
}

export default class LogseqerPlugin extends Plugin {
    settings: LogseqerSettings;
    statusBarItem: HTMLElement;
    devStatusBarItem: HTMLElement | null = null;

    async onload() {
        await this.loadSettings();

        if (this.settings.developerMode) this.createDevButton();

        this.addSettingTab(new LogseqerSettingTab(this.app, this));

        // 1. Feature: Page Node Syntax Check
        this.statusBarItem = this.addStatusBarItem();
        this.statusBarItem.addClass("logseqer-status-item");
        this.updateSyntaxCheck(); // Initial check

        // Register event for active leaf change

        this.registerEvent(this.app.workspace.on('active-leaf-change', (_leaf) => {
            void this.updateSyntaxCheck();
            void this.updateBacklinkQuery();
        }));

        // Also trigger on file-open which might be cleaner for completely new files loading
        this.registerEvent(this.app.workspace.on('file-open', (_file) => {
            // When file opens, the active leaf is relevant
            void this.updateBacklinkQuery();
        }));

        // Register event for editor changes
        this.registerEvent(
            this.app.workspace.on('editor-change', (_editor, _info) => {
                void this.updateSyntaxCheck();
            })
        );

        // 2. Feature: Vault Check Command (register if enabled)
        if (this.settings.enableVaultCommand) {
            this.addCommand({
                id: 'check-vault',
                name: 'Check vault compatibility',
                callback: () => {
                    void this.runVaultCheckCommand();
                }
            });
        }

        // 3. Feature: Sync Settings Command (register if enabled)
        if (this.settings.enableSyncCommand) {
            this.addCommand({
                id: 'sync-settings',
                name: 'Sync settings (bookmarks/favorites)',
                callback: () => {
                    void this.syncSettings();
                }
            });
        }

        // 4. Feature: Journal
        // New Journal automatically add "- "
        this.registerEvent(
            this.app.vault.on('create', async (file) => {
                if (!this.settings.enableJournalNew) return;

                // Get configured journal folder or default
                const journalFolder = this.getDailyNoteFolder();

                if (file instanceof TFile && file.path.startsWith(journalFolder + '/')) {
                    // Delay slightly to ensure file is ready?
                    // Read and modify
                    try {
                        await this.app.vault.process(file, (data) => {
                            if (!data.startsWith("- ")) {
                                return "- " + data;
                            }
                            return data;
                        });
                    } catch (e) {
                        console.warn("Logseqer: Failed to process journal file", e);
                    }
                }
            })
        );
    }

    onunload() {
        // Cleanup on plugin unload
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    // Helper: Get Daily Notes Folder from Internal Plugin
    getDailyNoteFolder(): string {
        try {
            const internalPlugins = (this.app as unknown as Record<string, unknown>).internalPlugins;
            if (typeof internalPlugins === 'object' && internalPlugins !== null && 'getPluginById' in internalPlugins) {
                const dailyNotesPlugin = (internalPlugins as Record<string, (id: string) => unknown>).getPluginById('daily-notes');
                if (typeof dailyNotesPlugin === 'object' && dailyNotesPlugin !== null && 'instance' in dailyNotesPlugin) {
                    const instance = (dailyNotesPlugin as Record<string, unknown>).instance;
                    if (typeof instance === 'object' && instance !== null && 'options' in instance) {
                        const options = (instance as Record<string, unknown>).options;
                        if (typeof options === 'object' && options !== null && 'folder' in options) {
                            return (options as Record<string, string>).folder || 'journals';
                        }
                    }
                }
            }
        } catch (error) {
            console.warn("Logseqer: Could not retrieve Daily Notes Settings, falling back to 'journals'", error);
        }
        return 'journals';
    }

    // Helper: Determine pages folder - prefer a folder named 'pages' if present
    getPagesFolder(): string {
        try {
            const folders = this.app.vault.getAllLoadedFiles().filter((f: TAbstractFile) => f instanceof TFolder).map((f: TAbstractFile) => f.path);
            // Prefer exact 'pages' at root
            if (folders.includes('pages')) return 'pages';
            // Prefer any top-level folder named pages/... (startsWith)
            const pagesLike = folders.find(p => p === 'pages' || p.startsWith('pages/'));
            if (pagesLike) return 'pages';
        } catch (e) {
            console.warn('Logseqer: failed determining pages folder from vault', e);
        }
        // Default fallback used by Logseq
        return 'pages';
    }

    // 2. Feature: Vault Check helper (manual only)
    checkVault() {
        // Manual only - no startup behavior
        new Notice("Run 'Check vault compatibility' from the command palette to inspect vault.");
    }

    async runVaultCheckCommand() {
        console.warn("Logseqer: Starting Vault Check...");

        new Notice("Vault check started...");

        const files = this.app.vault.getMarkdownFiles();
        const issues: VaultCheckIssue[] = [];

        // Determine expected folders (Logseq cannot change paths here)
        const pagesFolder = this.getPagesFolder();

        // 0. Settings check: compare Obsidian settings against Logseq expectations
        if (this.settings.enableVaultFolderSettingsCheck) {
            try {
                const cfgDir = this.app.vault.configDir;
                const adapter = this.app.vault.adapter;

                // First, read Logseq config for date format to compare with Obsidian
                let logseqDateFormat = 'yyyy-MM-dd';
                try {
                    const configPath = `${this.settings.logseqFolder}/config.edn`;
                    if (await adapter.exists(configPath)) {
                        const cfg = await adapter.read(configPath);
                        // Filter out comment lines (starting with ";;") and extract valid code lines
                        // Handle different line endings: \n (Unix), \r\n (Windows), \r (old Mac)
                        const lines = cfg.split(/\r?\n|\r/);
                        const validLines = lines
                            .map(line => line.trim())
                            .filter(line => line && !line.startsWith(';;')); // Remove empty lines and comments
                        const codeText = validLines.join('\n');
                        // Match :journal/page-title-format "format" pattern
                        const m = codeText.match(/:journal\/page-title-format\s+"([^"]+)"/);
                        if (m) logseqDateFormat = m[1];
                    }
                } catch (e) {
                    console.warn('Logseqer: failed reading Logseq config.edn for date format', e);
                }

                // Convert Logseq format (yyyy-MM-dd) to Obsidian format (YYYY-MM-DD)
                const expectedObsDailyFormat = logseqDateFormat
                    .replace(/yyyy/g, 'YYYY')
                    .replace(/MM/g, 'MM')
                    .replace(/dd/g, 'DD')
                    .replace(/_/g, '-');

                // Read Obsidian daily notes settings (internal plugin preferred)
                let obsDailyFormat: string | null = null;
                let obsDailyFolder: string | null = null;
                try {
                    const dnPlugin = (this.app as unknown as Record<string, unknown>).internalPlugins;
                    if (typeof dnPlugin === 'object' && dnPlugin !== null && 'getPluginById' in dnPlugin) {
                        const dailyNotesObj = (dnPlugin as Record<string, (id: string) => unknown>).getPluginById('daily-notes');
                        if (typeof dailyNotesObj === 'object' && dailyNotesObj !== null && 'instance' in dailyNotesObj) {
                            const instance = (dailyNotesObj as Record<string, unknown>).instance;
                            if (typeof instance === 'object' && instance !== null && 'options' in instance) {
                                const options = (instance as Record<string, unknown>).options;
                                if (typeof options === 'object' && options !== null) {
                                    const opts = options as Record<string, string>;
                                    obsDailyFormat = opts.format || null;
                                    obsDailyFolder = opts.folder || null;
                                }
                            }
                        }
                    }
                } catch {
                    // Fallback to config files
                }

                // Fallback to config files in .obsidian
                if (!obsDailyFormat || !obsDailyFolder) {
                    const dailyPath = `${cfgDir}/daily-notes.json`;
                    if (await adapter.exists(dailyPath)) {
                        const txt = await adapter.read(dailyPath);
                        try {
                            const j = JSON.parse(txt);
                            obsDailyFormat = obsDailyFormat || j.format || null;
                            obsDailyFolder = obsDailyFolder || j.folder || null;
                        } catch {
                            // Unable to parse daily-notes.json
                        }
                    }
                }

                // Read app.json for newFileLocation/newFileFolderPath
                let appNewFileLocation: string | null = null;
                let appNewFileFolderPath: string | null = null;
                const appPath = `${cfgDir}/app.json`;
                if (await adapter.exists(appPath)) {
                    try {
                        const txt = await adapter.read(appPath);
                        const j = JSON.parse(txt);
                        appNewFileLocation = j.newFileLocation || null;
                        appNewFileFolderPath = j.newFileFolderPath || null;
                    } catch {
                        // Unable to read or parse app.json
                    }
                }

                // Expected values for Logseq compatibility
                const expectedJournalFolder = 'journals';
                const expectedPagesFolder = 'pages';
                const expectedNewFileLocation = 'folder';

                // 1. Check newFileFolderPath
                if (appNewFileFolderPath !== expectedPagesFolder) {
                    issues.push({
                        type: 'Settings',
                        description: `Obsidian new file folder path is '${appNewFileFolderPath || '(not set)'}', expected '${expectedPagesFolder}'.`,
                        suggestedFix: `Set Obsidian new file folder to '${expectedPagesFolder}'.`,
                        fixData: { type: 'settings-update', target: 'app.json', key: 'newFileFolderPath', value: expectedPagesFolder }
                    });
                }

                // 2. Check newFileLocation
                if (appNewFileLocation !== expectedNewFileLocation) {
                    issues.push({
                        type: 'Settings',
                        description: `Obsidian new file location is '${appNewFileLocation || '(not set)'}', expected '${expectedNewFileLocation}'.`,
                        suggestedFix: `Set Obsidian new file location to '${expectedNewFileLocation}'.`,
                        fixData: { type: 'settings-update', target: 'app.json', key: 'newFileLocation', value: expectedNewFileLocation }
                    });
                }

                // 3. Check daily notes folder
                if (obsDailyFolder !== expectedJournalFolder) {
                    issues.push({
                        type: 'Settings',
                        description: `Obsidian daily notes folder is '${obsDailyFolder || '(not set)'}', expected '${expectedJournalFolder}'.`,
                        suggestedFix: `Set Obsidian daily notes folder to '${expectedJournalFolder}'.`,
                        fixData: { type: 'settings-update', target: 'daily-notes.json', key: 'folder', value: expectedJournalFolder }
                    });
                }

                // 4. Check daily notes format (from Logseq config)
                if (obsDailyFormat !== expectedObsDailyFormat) {
                    issues.push({
                        type: 'Settings',
                        description: `Obsidian daily notes format is '${obsDailyFormat || '(not set)'}', expected '${expectedObsDailyFormat}' (from Logseq config: ${logseqDateFormat}).`,
                        suggestedFix: `Set Obsidian daily notes format to '${expectedObsDailyFormat}'.`,
                        fixData: { type: 'settings-update', target: 'daily-notes.json', key: 'format', value: expectedObsDailyFormat }
                    });
                }
            } catch (error) {
                console.warn('Logseqer: folder settings check failed', error);
            }
        }

        // Note: Date format check is now handled in Settings check above (comparing config files)
        // The old file-by-file date format check has been removed as it's not needed.
        // Vault Check should only compare configuration files, not individual journal files.

        for (const file of files) {
            const fileName = file.basename;

            // 2. Namespace check: check for files with "___" separator (e.g., "a___b___c.md")
            // Rule: Convert "a___b___c.md" to "c.md" and add "tags: a/b" at the beginning
            if (file.path.startsWith(pagesFolder + '/')) {
                if (this.settings.enableVaultNamespaceCheck && fileName.includes('___') && !fileName.startsWith('.')) {
                    // Extract namespace parts (e.g., "a___b___c" -> ["a", "b", "c"])
                    const parts = fileName.replace(/\.md$/, '').split('___');
                    if (parts.length > 1) {
                        const finalName = parts[parts.length - 1]; // Last part is the actual filename
                        const namespaceParts = parts.slice(0, -1); // All parts except the last
                        const namespacePath = namespaceParts.join('/'); // e.g., "a/b"
                        const newPath = `${pagesFolder}/${finalName}.md`;
                        
                        issues.push({
                            file,
                            type: 'Namespace',
                            description: `File "${file.path}" uses namespace separator "___".`,
                            suggestedFix: `Rename to "${newPath}" and add "tags: ${namespacePath}" at the beginning of the file.`,
                            fixData: { 
                                type: 'namespace-rename', 
                                newPath,
                                namespacePath,
                                originalName: fileName
                            }
                        });
                    }
                }
            }

            // 3. Task marker detection: detect common Logseq markers
            // Logseq task markers typically appear at the start of a line, optionally with "- " prefix
            // Examples: "TODO", "- TODO", "DONE", "- DONE", etc.
            if (this.settings.enableVaultTaskMarkerCheck) {
                try {
                    const content = await this.app.vault.read(file);
                    // Match Logseq task markers: word boundary + marker + optional colon
                    // Pattern matches: TODO, DONE, DOING, NOW, LATER (with word boundaries)
                    const markerRegex = /\b(TODO|DONE|DOING|NOW|LATER)\b/;
                    if (markerRegex.test(content)) {
                        issues.push({
                            file,
                            type: 'Task Marker',
                            description: `File "${file.path}" contains Logseq task markers (TODO/DONE/DOING/NOW/LATER).`,
                            suggestedFix: 'Convert Logseq task markers to markdown tasks (- [ ] / - [x]).',
                            fixData: { type: 'content-replace', content }
                        });
                    }
                } catch (e) {
                    console.warn('Logseqer: failed reading file for markers', file.path, e);
                }
            }
        }

        if (issues.length > 0) {
            new VaultCheckResolutionModal(this.app, this, issues).open();
        } else {
            // Show a modal that requires manual close to indicate success
            const modal = new Modal(this.app);
            modal.titleEl.setText('Vault check');
            modal.contentEl.createEl('p', { text: 'Vault check completed. No issues found.' });
            const btn = modal.contentEl.createEl('button', { text: 'Close', cls: 'mod-cta' });
            btn.onclick = () => modal.close();
            modal.open();
        }
    }

    // Simulation: open Vault Check modal with sample issues (no file changes performed)
    runVaultCheckSimulation() {
        const sampleFile1: MockFile = { path: 'pages/example/nestedPage.md', basename: 'nestedPage' };
        const sampleFile2: MockFile = { path: 'journals/2024-02-30.md', basename: '2024-02-30' };
        const sampleFile3: MockFile = { path: 'pages/task-example.md', basename: 'task-example' };

        const issues: VaultCheckIssue[] = [
            {
                file: sampleFile1,
                type: 'Namespace',
                description: `File "${sampleFile1.path}" appears to use nested folders under pages/.`,
                suggestedFix: `Convert to namespace (dots): "pages/example.nestedPage.md"`,
                fixData: { type: 'rename', newPath: 'pages/example.nestedPage.md' }
            },
            {
                file: sampleFile2,
                type: 'Date',
                description: `Journal file "${sampleFile2.path}" does not match configured date format (yyyy-MM-dd).`,
                suggestedFix: 'Manual rename recommended.',
                fixData: null
            },
            {
                file: sampleFile3,
                type: 'Task Marker',
                description: `File "${sampleFile3.path}" contains Logseq task markers (TODO).`,
                suggestedFix: 'Convert Logseq task markers to markdown tasks (- [ ] / - [x]).',
                fixData: { type: 'content-replace', content: '- TODO sample task' }
            }
        ];

        // Open the modal in simulation mode so Apply button does not perform real changes
        new VaultCheckResolutionModal(this.app, this, issues, true).open();
    }
    // 3. Feature: Settings Sync
    async syncSettings() {
        const adapter = this.app.vault.adapter;
        const bookmarkPath = `${this.app.vault.configDir}/bookmarks.json`;
        const logseqConfigPath = `${this.settings.logseqFolder}/config.edn`;

        if (!(await adapter.exists(bookmarkPath))) {
            new Notice(`Obsidian bookmarks not found at ${bookmarkPath}`);
            return;
        }

        if (!(await adapter.exists(logseqConfigPath))) {
            new Notice(`Logseq config not found at ${logseqConfigPath}`);
            return;
        }

        try {
            // Read Obsidian bookmarks
            const bookmarkContent = JSON.parse(await adapter.read(bookmarkPath)) as {items: BookmarkItem[]};
            const bookmarkedFiles = bookmarkContent.items
                .filter((item: BookmarkItem) => item.type === 'file')
                .map((item: BookmarkItem) => item.path || '')
                .filter((path: string) => path.length > 0);
            
            const obsidianPageNames = new Set<string>();
            for (const filePath of bookmarkedFiles) {
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                    obsidianPageNames.add(file.basename);
                }
            }

            // Read Logseq favorites
            const configContent = await adapter.read(logseqConfigPath);
            const favoritesRegex = /:favorites\s*\[([^\]]*)\]/;
            const match = configContent.match(favoritesRegex);
            const logseqPageNames = match ? new Set(match[1].match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, '')) || []) : new Set<string>();

            // Determine sync direction
            const direction = this.settings.bookmarkSyncDirection || 'obsidian-to-logseq';
            const isBidirectional = direction === 'bidirectional';
            const canModifyObsidian = isBidirectional || direction === 'logseq-to-obsidian';
            const canModifyLogseq = isBidirectional || direction === 'obsidian-to-logseq';

            // Open the sync modal
            new BookmarkSyncModal(
                this.app,
                this,
                Array.from(obsidianPageNames).sort(),
                Array.from(logseqPageNames).sort(),
                bookmarkPath,
                logseqConfigPath,
                canModifyObsidian,
                canModifyLogseq,
                direction
            ).open();

        } catch (e) {
            console.error("Logseqer: Error preparing bookmark sync", e);
            new Notice("Error preparing bookmark sync. See console.");
        }
    }

    // Sync from Logseq favorites to Obsidian bookmarks
    async syncLogseqToObsidian() {
        const adapter = this.app.vault.adapter;
        const bookmarkPath = `${this.app.vault.configDir}/bookmarks.json`;
        const logseqConfigPath = `${this.settings.logseqFolder}/config.edn`;

        if (!(await adapter.exists(logseqConfigPath))) {
            new Notice(`Logseq config not found at ${logseqConfigPath}`);
            return;
        }

        if (!(await adapter.exists(bookmarkPath))) {
            new Notice(`Obsidian bookmarks not found at ${bookmarkPath}`);
            return;
        }

        try {
            const configContent = await adapter.read(logseqConfigPath);
            const favoritesRegex = /:favorites\s*\[([^\]]*)\]/;
            const match = configContent.match(favoritesRegex);

            if (!match) {
                new Notice("No :favorites found in Logseq config.");
                return;
            }

            const favoritesStr = match[1];
            const pages = favoritesStr.match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, '')) || [];

            if (pages.length === 0) {
                new Notice("No pages found in Logseq favorites.");
                return;
            }

            // Build Map of all markdown files: Basename -> TFile[]
            const allFiles = this.app.vault.getMarkdownFiles();
            const fileMap = new Map<string, TFile[]>();

            for (const file of allFiles) {
                if (!fileMap.has(file.basename)) {
                    fileMap.set(file.basename, []);
                }
                fileMap.get(file.basename)?.push(file);
            }

            // Categorize Pages
            const bookmarkContent = JSON.parse(await adapter.read(bookmarkPath)) as {items: BookmarkItem[]};
            const existingPaths = new Set(bookmarkContent.items.map((item: BookmarkItem) => item.path || '').filter((path: string) => path.length > 0));

            let addedDirectlyCount = 0;
            const missingPages: string[] = [];
            const ambiguousPages: { name: string; files: TFile[] }[] = [];

            for (const pageName of pages) {
                const matches = fileMap.get(pageName) || [];

                if (matches.length === 0) {
                    missingPages.push(pageName);
                } else if (matches.length === 1) {
                    const file = matches[0];
                    if (!existingPaths.has(file.path)) {
                        bookmarkContent.items.push({
                            type: 'file',
                            ctime: Date.now(),
                            path: file.path
                        });
                        existingPaths.add(file.path);
                        addedDirectlyCount++;
                    }
                } else {
                    // Check if ANY of the matches are already bookmarked
                    const alreadyBookmarked = matches.some(m => existingPaths.has(m.path));
                    if (!alreadyBookmarked) {
                        ambiguousPages.push({ name: pageName, files: matches });
                    }
                }
            }

            if (addedDirectlyCount > 0) {
                await adapter.write(bookmarkPath, JSON.stringify(bookmarkContent, null, 2));
                new Notice(`Synced ${addedDirectlyCount} favorites from Logseq to Obsidian.`);
            }

            if (missingPages.length > 0 || ambiguousPages.length > 0) {
                new SyncResolutionModal(
                    this.app,
                    this,
                    missingPages,
                    ambiguousPages,
                    bookmarkPath
                ).open();
            } else if (addedDirectlyCount === 0) {
                new Notice("Bookmarks are up to date.");
            }

        } catch (e) {
            console.error("Logseqer: Error syncing from Logseq to Obsidian", e);
            new Notice("Error syncing from Logseq to Obsidian. See console.");
        }
    }

    // Sync from Obsidian bookmarks to Logseq favorites
    async syncObsidianToLogseq() {
        const adapter = this.app.vault.adapter;
        const bookmarkPath = `${this.app.vault.configDir}/bookmarks.json`;
        const logseqConfigPath = `${this.settings.logseqFolder}/config.edn`;

        if (!(await adapter.exists(bookmarkPath))) {
            new Notice(`Obsidian bookmarks not found at ${bookmarkPath}`);
            return;
        }

        if (!(await adapter.exists(logseqConfigPath))) {
            new Notice(`Logseq config not found at ${logseqConfigPath}`);
            return;
        }

        try {
            const bookmarkContent = JSON.parse(await adapter.read(bookmarkPath)) as {items: BookmarkItem[]};
            const bookmarkedFiles = bookmarkContent.items
                .filter((item: BookmarkItem) => item.type === 'file')
                .map((item: BookmarkItem) => item.path || '')
                .filter((path: string) => path.length > 0);

            if (bookmarkedFiles.length === 0) {
                new Notice("No bookmarks found in Obsidian.");
                return;
            }

            // Extract page names from file paths (basename without .md)
            const pageNames = new Set<string>();
            for (const filePath of bookmarkedFiles) {
                const file = this.app.vault.getAbstractFileByPath(filePath);
                if (file instanceof TFile) {
                    pageNames.add(file.basename);
                }
            }

            // Read Logseq config to check existing favorites
            let configContent = await adapter.read(logseqConfigPath);
            const favoritesRegex = /:favorites\s*\[([^\]]*)\]/;
            const match = configContent.match(favoritesRegex);
            const existingFavorites = match ? match[1].match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, '')) || [] : [];
            
            // Merge page names with existing favorites (only add new ones)
            const pageNamesArray = Array.from(pageNames);
            const newFavorites = pageNamesArray.filter(name => !existingFavorites.includes(name));
            
            if (newFavorites.length === 0) {
                new Notice("All bookmarks are already in Logseq favorites.");
                return;
            }
            
            // Show confirmation modal with page list
            const sortedNewFavorites = newFavorites.sort();
            const message = `Add ${sortedNewFavorites.length} new bookmarks from Obsidian to Logseq?\n\n` +
                `New pages to add:\n${sortedNewFavorites.slice(0, 20).join(', ')}${sortedNewFavorites.length > 20 ? `\n... and ${sortedNewFavorites.length - 20} more` : ''}\n\n` +
                (existingFavorites.length > 0 ? `Note: ${existingFavorites.length} existing favorites will be preserved.` : '');
            
            new CustomConfirmationModal(this.app, message, () => {
                (async () => {
                    try {
                        // Re-read config to ensure we have the latest content
                        let currentConfigContent = await adapter.read(logseqConfigPath);
                        const currentMatch = currentConfigContent.match(favoritesRegex);

                        // Merge with existing favorites (preserve all existing, add new ones)
                        const currentExisting = currentMatch ? currentMatch[1].match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, '')) || [] : [];
                        const mergedFavorites = new Set<string>([...currentExisting, ...pageNamesArray]);
                        const sortedMergedFavorites = Array.from(mergedFavorites).sort();
                        const favoritesArray = sortedMergedFavorites.map(name => `"${name}"`).join(' ');

                        if (currentMatch) {
                            // Replace existing :favorites with merged list
                            currentConfigContent = currentConfigContent.replace(favoritesRegex, `:favorites [${favoritesArray}]`);
                        } else {
                            // Add :favorites if not exists (add before closing brace or at end)
                            if (currentConfigContent.trim().endsWith('}')) {
                                currentConfigContent = currentConfigContent.slice(0, -1) + ` :favorites [${favoritesArray}]\n}`;
                            } else {
                                currentConfigContent += `\n:favorites [${favoritesArray}]`;
                            }
                        }

                        await adapter.write(logseqConfigPath, currentConfigContent);
                        new Notice(`Added ${sortedNewFavorites.length} new bookmarks to Logseq favorites (${existingFavorites.length} existing preserved).`);
                    } catch (e) {
                        console.error("Logseqer: Error syncing from Obsidian to Logseq", e);
                        new Notice("Error syncing from Obsidian to Logseq. See console.");
                    }
                })();
            }).open();

        } catch (e) {
            console.error("Logseqer: Error syncing from Obsidian to Logseq", e);
            new Notice("Error syncing from Obsidian to Logseq. See console.");
        }
    }

    // 4. Feature: Backlinks Customization
    // Custom "journals/*" backlinks default query (now uses dynamic folder)
    updateBacklinkQuery(leaf?: WorkspaceLeaf | null) {
        if (!this.settings.enableBacklinkQuery) return;

        // If no leaf provided (e.g. file-open), get the active one
        if (!leaf) {
            leaf = this.app.workspace.getLeaf(false);
        }
        // Check if leaf is valid and is a MarkdownView
        if (!leaf || !(leaf.view instanceof MarkdownView)) return;

        const view = leaf.view as MarkdownView;
        const file = view.file;
        const journalFolder = this.getDailyNoteFolder();

        if (file && file.path.startsWith(journalFolder + '/')) {
            const maxRetries = 10;
            const retryInterval = 100;

            const tryInject = (attempt: number) => {
                // Ensure element is connected (user hasn't closed tab)
                if (view.containerEl && !view.containerEl.isConnected) return;

                // Scoped selector within the specific view container
                const searchInputContainer = view.containerEl.querySelector('.embedded-backlinks .search-input-container');

                if (!searchInputContainer) {
                    if (attempt < maxRetries) {
                        setTimeout(() => tryInject(attempt + 1), retryInterval);
                    }
                    return;
                }

                // Ensure it is visible
                let style = searchInputContainer.getAttribute('style') || "";
                if (style.includes("display: none")) {
                    style = style.replace(/display:\s?none;?/g, '');
                    searchInputContainer.setAttribute('style', style);
                }

                const inputEl = searchInputContainer.querySelector("input");
                if (!inputEl) {
                    if (attempt < maxRetries) {
                        setTimeout(() => tryInject(attempt + 1), retryInterval);
                    }
                    return;
                }

                if (inputEl.value !== this.settings.backlinkQueryString) {
                    inputEl.value = this.settings.backlinkQueryString;
                    inputEl.dispatchEvent(new Event('input', { bubbles: true }));
                }
            };

            // Start attempts
            tryInject(0);
        }
    }

    updateSyntaxCheck() {
        if (!this.settings.enableSyntaxCheck) {
            this.statusBarItem.setText('');
            return;
        }

        const view = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (!view) {
            this.statusBarItem.setText('');
            return;
        }

        const invalidCount = checkLogseqSyntaxDOM();

        if (invalidCount === 0) {
            this.statusBarItem.setText('✅');
            this.statusBarItem.removeClass('is-invalid');
            this.statusBarItem.addClass('is-valid');
        } else {
            this.statusBarItem.setText(`${invalidCount}`);
            this.statusBarItem.removeClass('is-valid');
            this.statusBarItem.addClass('is-invalid');
        }
        this.statusBarItem.title = "LS Syntax Check";
    }

    createDevButton() {
        if (this.devStatusBarItem) return;
        this.devStatusBarItem = this.addStatusBarItem();
        this.devStatusBarItem.addClass('logseqer-dev-item');
        this.devStatusBarItem.setText('Dev');
        this.devStatusBarItem.onclick = () => {
            new DeveloperModal(this.app, this).open();
        };
    }

    removeDevButton() {
        if (!this.devStatusBarItem) return;
        this.devStatusBarItem.remove();
        this.devStatusBarItem = null;
    }
}

// Custom Confirmation Modal
class CustomConfirmationModal extends Modal {
    onConfirm: () => void;
    message: string;

    constructor(app: App, message: string, onConfirm: () => void) {
        super(app);
        this.message = message;
        this.onConfirm = onConfirm;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('p', { text: this.message });
        
        const btnDiv = contentEl.createDiv({ cls: 'modal-button-container' });
        const confirmBtn = btnDiv.createEl('button', { text: 'Confirm', cls: 'mod-cta' });
        confirmBtn.onclick = () => {
            this.onConfirm();
            this.close();
        };

        const cancelBtn = btnDiv.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();
    }

    onClose() {
        this.contentEl.empty();
    }
}

class DeveloperModal extends Modal {
    plugin: LogseqerPlugin;
    constructor(app: App, plugin: LogseqerPlugin) {
        super(app);
        this.plugin = plugin;
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h3', { text: 'Developer tools' });
        contentEl.createEl('p', { text: 'Use these controls to show test notifications and dialogs that users see.' });

        const btn1 = contentEl.createEl('button', { text: 'Show test notice' });
        btn1.onclick = () => {
            new Notice('This is a test notice from Developer Mode.');
        };

        const btn2 = contentEl.createEl('button', { text: 'Vault check with issues' });
        btn2.onclick = () => {
            // Open a dry-run simulation of the Vault Check UI (no real file changes)
            void this.plugin.runVaultCheckSimulation();
        };

        const btn2b = contentEl.createEl('button', { text: 'Vault check with no issues' });
        btn2b.onclick = () => {
            // Show the success modal that indicates no issues found
            const modal = new Modal(this.app);
            modal.titleEl.setText('Vault check');
            modal.contentEl.createEl('p', { text: 'Vault check completed. No issues found.' });
            const btn = modal.contentEl.createEl('button', { text: 'Close', cls: 'mod-cta' });
            btn.onclick = () => modal.close();
            modal.open();
        };

        const btn3 = contentEl.createEl('button', { text: 'Sync resolution' });
        btn3.onclick = () => {
            // Provide sample data for ambiguous/missing pages (dry-run)
            const missing = ['Sample Page A', 'New Page B'];
            const ambiguous = [
                { name: 'DuplicatePage', files: [{ path: 'pages/DuplicatePage.md' } as MockFile, { path: 'pages/sub/DuplicatePage.md' } as MockFile] }
            ];
            new SyncResolutionModal(this.app, this.plugin, missing, ambiguous, `${this.plugin.app.vault.configDir}/bookmarks.json`, true).open();
        };

        const del = contentEl.createEl('button', { text: 'Remove dev button' });
        del.onclick = async () => {
            this.plugin.removeDevButton();
            this.close();
            this.plugin.settings.developerMode = false;
            await this.plugin.saveSettings();
        };
    }

    onClose() {
        this.contentEl.empty();
    }
}

// Folder Suggest Component for Settings
class FolderSuggest {
    private inputEl: HTMLInputElement;
    private app: App;
    private suggestEl: HTMLElement | null = null;
    private folders: string[] = [];

    constructor(app: App, inputEl: HTMLInputElement) {
        this.app = app;
        this.inputEl = inputEl;
        this.loadFolders();
        this.attachListeners();
    }

    private loadFolders() {
        this.folders = this.app.vault.getAllLoadedFiles()
            .filter((f: TAbstractFile) => f instanceof TFolder)
            .map((f: TAbstractFile) => f.path)
            .sort();
    }

    private attachListeners() {
        this.inputEl.addEventListener('input', () => this.onInput());
        this.inputEl.addEventListener('focus', () => this.onInput());
        this.inputEl.addEventListener('blur', () => {
            setTimeout(() => this.hideSuggestions(), 200);
        });
    }

    private onInput() {
        const value = this.inputEl.value;
        const matches = this.folders.filter(f =>
            f.toLowerCase().includes(value.toLowerCase())
        ).slice(0, 10);

        if (matches.length > 0 && value) {
            this.showSuggestions(matches);
        } else {
            this.hideSuggestions();
        }
    }

    private showSuggestions(matches: string[]) {
        if (!this.suggestEl) {
            this.suggestEl = createDiv({ cls: 'suggestion-container' });
            // Position relative to input element
            const rect = this.inputEl.getBoundingClientRect();
            this.suggestEl.setCssProps({
                left: `${rect.left}px`,
                top: `${rect.bottom}px`,
                width: `${rect.width}px`
            });
            document.body.appendChild(this.suggestEl);
        }

        this.suggestEl.empty();
        const suggestEl = this.suggestEl;
        matches.forEach(folder => {
            const item = suggestEl.createDiv({ cls: 'suggestion-item', text: folder });
            item.addEventListener('click', () => {
                this.inputEl.value = folder;
                this.inputEl.dispatchEvent(new Event('input'));
                this.hideSuggestions();
            });
        });
    }

    private hideSuggestions() {
        if (this.suggestEl) {
            this.suggestEl.remove();
            this.suggestEl = null;
        }
    }
}

class LogseqerSettingTab extends PluginSettingTab {
    plugin: LogseqerPlugin;

    constructor(app: App, plugin: LogseqerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        new Setting(containerEl).setName('Logseqer plugin settings').setHeading();

        new Setting(containerEl)
            .setName('Syntax check')
            .setDesc('Show syntax check status in status bar.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableSyntaxCheck)
                .onChange(async (value) => {
                    this.plugin.settings.enableSyntaxCheck = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateSyntaxCheck();
                }));

        new Setting(containerEl)
            .setName('New journal format')
            .setDesc('Automatically prepend "- " to new journal files.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableJournalNew)
                .onChange(async (value) => {
                    this.plugin.settings.enableJournalNew = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName('Vault check').setHeading();

        // Parent: Vault Check command with collapsible subfeatures
        new Setting(containerEl)
            .setName('Vault check')
            .setDesc('Show the "Check vault compatibility" command in the command palette.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableVaultCommand ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.enableVaultCommand = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        // Sub-features container (collapsible)
        const vaultSubContainer = containerEl.createDiv({ cls: 'vault-subfeatures' });
        const parentEnabled = !!(this.plugin.settings.enableVaultCommand);
        vaultSubContainer.style.display = parentEnabled ? '' : 'none';

        // Date format check (reads Logseq :journal/page-title-format from config.edn)
        new Setting(vaultSubContainer)
            .setName('Date format check')
            .setDesc('Read Logseq config.edn for :journal/page-title-format and compare with Obsidian daily note format.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableVaultDateCheck ?? true)
                .setDisabled(!parentEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.enableVaultDateCheck = value;
                    await this.plugin.saveSettings();
                }));

        // Folder settings check (journals/pages mappings)
        new Setting(vaultSubContainer)
            .setName('Folder settings check')
            .setDesc('Verify Obsidian daily notes and new-file folder settings match Logseq expectations (journals/pages).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableVaultFolderSettingsCheck ?? true)
                .setDisabled(!parentEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.enableVaultFolderSettingsCheck = value;
                    await this.plugin.saveSettings();
                }));

        // Namespace check
        new Setting(vaultSubContainer)
            .setName('Namespace checks')
            .setDesc('Detect files with "___" separator (e.g., "a___b___c.md") and convert to "c.md" with "tags: a/b" at the beginning.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableVaultNamespaceCheck ?? true)
                .setDisabled(!parentEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.enableVaultNamespaceCheck = value;
                    await this.plugin.saveSettings();
                }));

        // Task marker check
        new Setting(vaultSubContainer)
            .setName('Task marker checks')
            .setDesc('Detect common Logseq task markers (TODO/DONE/DOING/etc.).')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableVaultTaskMarkerCheck ?? true)
                .setDisabled(!parentEnabled)
                .onChange(async (value) => {
                    this.plugin.settings.enableVaultTaskMarkerCheck = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl).setName('Bookmark sync').setHeading();

        // Sync command toggle
        new Setting(containerEl)
            .setName('Sync settings')
            .setDesc('Show the "Sync settings" command in the command palette.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableSyncCommand ?? true)
                .onChange(async (value) => {
                    this.plugin.settings.enableSyncCommand = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        // Sync direction setting
        new Setting(containerEl)
            .setName('Sync direction')
            .setDesc('Choose the direction for bookmark synchronization.')
            .addDropdown(dropdown => {
                dropdown
                    .addOption('obsidian-to-logseq', 'Obsidian → Logseq')
                    .addOption('logseq-to-obsidian', 'Logseq → Obsidian')
                    .addOption('bidirectional', 'Bidirectional (Both ways)')
                    .setValue(this.plugin.settings.bookmarkSyncDirection || 'obsidian-to-logseq')
                    .onChange(async (value: 'obsidian-to-logseq' | 'logseq-to-obsidian' | 'bidirectional') => {
                        this.plugin.settings.bookmarkSyncDirection = value;
                        await this.plugin.saveSettings();
                    });
            });

        // Logseq Folder Setting with Folder Suggest
        let logseqInput: TextComponent;
        new Setting(containerEl)
            .setName('Logseq folder')
            .setDesc('Folder containing Logseq files (config.edn)')
            .addText(text => {
                logseqInput = text;
                text.setValue(this.plugin.settings.logseqFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.logseqFolder = value;
                        await this.plugin.saveSettings();
                    });
            });

        // Attach folder suggest to input
        new FolderSuggest(this.app, logseqInput.inputEl);

        new Setting(containerEl).setName('Backlinks customization').setHeading();

        new Setting(containerEl)
            .setName('Backlink default query')
            .setDesc('Automatically set a search query in backlinks for Journals.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableBacklinkQuery)
                .onChange(async (value) => {
                    this.plugin.settings.enableBacklinkQuery = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Default query')
            .setDesc('The query string to input into the backlinks search box. Example: -path:"journals/Journaling"')
            .addText(text => text
                .setPlaceholder('-path:"journals/Journaling"')
                .setValue(this.plugin.settings.backlinkQueryString)
                .onChange(async (value) => {
                    this.plugin.settings.backlinkQueryString = value;
                    await this.plugin.saveSettings();
                }));

        // Reset to Defaults Button
        new Setting(containerEl).setName('Advanced').setHeading();

        new Setting(containerEl)
            .setName('Restore defaults')
            .setDesc('Reset all plugin settings to their default values')
            .addButton(button => button
                .setButtonText('Restore defaults')
                .setWarning()
                .onClick(() => {
                    // Confirmation dialog
                    new CustomConfirmationModal(this.app, 'Are you sure you want to restore all settings to default values? This cannot be undone.', () => {
                        (async () => {
                            this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
                            await this.plugin.saveSettings();
                            this.display(); // Refresh the settings display
                            new Notice('Settings restored to defaults');
                        })();
                    }).open();
                }));
        // Developer Mode (last item in Advanced)
        const devModeSetting = new Setting(containerEl)
            .setName('Dev mode')
            .setDesc('WARNING: Adds a dev button to the status bar for testing features. Not recommended for production use.');

        if (this.plugin.settings.developerMode) {
            devModeSetting.addButton(button => button
                .setButtonText('Disable')
                .setWarning()
                .onClick(async () => {
                    this.plugin.settings.developerMode = false;
                    await this.plugin.saveSettings();
                    this.plugin.removeDevButton();
                    this.display();
                }));
        } else {
            devModeSetting.addButton(button => button
                .setButtonText('Enable')
                .setWarning()
                .onClick(async () => {
                    this.plugin.settings.developerMode = true;
                    await this.plugin.saveSettings();
                    this.plugin.createDevButton();
                    this.display();
                }));
        }
    }
}

class BookmarkSyncModal extends Modal {
    plugin: LogseqerPlugin;
    obsidianPages: string[];
    logseqPages: string[];
    bookmarkPath: string;
    logseqConfigPath: string;
    canModifyObsidian: boolean;
    canModifyLogseq: boolean;
    direction: string;
    
    // State
    currentView: 'obsidian' | 'logseq';
    selectedToAdd: Set<string>; // Pages to add to current view
    selectedExisting: Set<string>; // Existing pages in current view (for reference)

    constructor(
        app: App,
        plugin: LogseqerPlugin,
        obsidianPages: string[],
        logseqPages: string[],
        bookmarkPath: string,
        logseqConfigPath: string,
        canModifyObsidian: boolean,
        canModifyLogseq: boolean,
        direction: string
    ) {
        super(app);
        this.plugin = plugin;
        this.obsidianPages = obsidianPages;
        this.logseqPages = logseqPages;
        this.bookmarkPath = bookmarkPath;
        this.logseqConfigPath = logseqConfigPath;
        this.canModifyObsidian = canModifyObsidian;
        this.canModifyLogseq = canModifyLogseq;
        this.direction = direction;
        
        // Default view based on direction
        this.currentView = direction === 'logseq-to-obsidian' ? 'logseq' : 'obsidian';
        this.selectedToAdd = new Set();
        this.selectedExisting = new Set();
        
        // Initialize selections based on current view
        this.initializeSelections();
    }

    initializeSelections() {
        if (this.currentView === 'obsidian') {
            // Show what Logseq has that Obsidian doesn't (to add to Obsidian)
            const toAdd = this.logseqPages.filter(p => !this.obsidianPages.includes(p));
            this.selectedToAdd = new Set(toAdd);
            this.selectedExisting = new Set(this.obsidianPages);
        } else {
            // Show what Obsidian has that Logseq doesn't (to add to Logseq)
            const toAdd = this.obsidianPages.filter(p => !this.logseqPages.includes(p));
            this.selectedToAdd = new Set(toAdd);
            this.selectedExisting = new Set(this.logseqPages);
        }
    }

    updateSelections() {
        // Update existing pages display when switching views
        if (this.currentView === 'obsidian') {
            this.selectedExisting = new Set(this.obsidianPages);
        } else {
            this.selectedExisting = new Set(this.logseqPages);
        }
        // Keep selectedToAdd - user's selections persist when switching views
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.empty();
        
        // Title with sync direction
        const directionText = this.direction === 'bidirectional' ? 'Bidirectional Sync' :
                             this.direction === 'logseq-to-obsidian' ? 'Logseq → Obsidian' :
                             'Obsidian → Logseq';
        contentEl.createEl('h2', { text: `Bookmark Sync: ${directionText}` });
        
        // Description
        contentEl.createEl('p', { 
            text: `Select bookmarks to sync. Switch between Obsidian and Logseq views using the buttons below.`,
            cls: 'logseqer-sync-desc' 
        });
        
        // Toggle buttons for Obsidian/Logseq
        const toggleContainer = contentEl.createDiv({ cls: 'modal-button-row' });
        setElementStyles(toggleContainer, { marginBottom: '20px' });
        const leftDiv = toggleContainer.createDiv({ cls: 'modal-button-left' });
        const obsidianBtn = leftDiv.createEl('button', {
            text: 'Obsidian',
            cls: this.currentView === 'obsidian' ? 'mod-cta' : ''
        });
        const logseqBtn = leftDiv.createEl('button', {
            text: 'Logseq',
            cls: this.currentView === 'logseq' ? 'mod-cta' : ''
        });
        
        obsidianBtn.onclick = () => {
            this.currentView = 'obsidian';
            this.updateSelections();
            // Re-initialize selections for new view
            const toAdd = this.logseqPages.filter(p => !this.obsidianPages.includes(p));
            this.selectedToAdd = new Set(toAdd.filter(p => this.selectedToAdd.has(p))); // Keep only valid selections
            this.onOpen();
        };
        logseqBtn.onclick = () => {
            this.currentView = 'logseq';
            this.updateSelections();
            // Re-initialize selections for new view
            const toAdd = this.obsidianPages.filter(p => !this.logseqPages.includes(p));
            this.selectedToAdd = new Set(toAdd.filter(p => this.selectedToAdd.has(p))); // Keep only valid selections
            this.onOpen();
        };
        
        // Determine if current view can be modified
        const canModify = this.currentView === 'obsidian' ? this.canModifyObsidian : this.canModifyLogseq;
        const otherPages = this.currentView === 'obsidian' ? this.logseqPages : this.obsidianPages;
        const currentPages = this.currentView === 'obsidian' ? this.obsidianPages : this.logseqPages;
        const toAddItems = otherPages.filter(p => !currentPages.includes(p)).sort();
        
        // Section 1: Pages to add (from other software)
        const toAddSection = contentEl.createDiv({ cls: 'logseqer-sync-section' });
        const toAddHeader = toAddSection.createDiv({ cls: 'logseqer-sync-header' });
        toAddHeader.createSpan({
            text: `To Add (${toAddItems.length})`,
            cls: 'logseqer-sync-header'
        });
        const toAddHeaderCheckbox = toAddHeader.createEl('input', { type: 'checkbox', cls: 'group-checkbox' }) as HTMLInputElement;
        toAddHeaderCheckbox.disabled = !canModify;
        toAddHeaderCheckbox.checked = canModify && toAddItems.length > 0 && 
            toAddItems.every(p => this.selectedToAdd.has(p));
        toAddHeaderCheckbox.onchange = () => {
            if (canModify) {
                if (toAddHeaderCheckbox.checked) {
                    toAddItems.forEach(p => this.selectedToAdd.add(p));
                } else {
                    toAddItems.forEach(p => this.selectedToAdd.delete(p));
                }
                this.contentEl.empty();
                this.onOpen();
            }
        };
        
        const toAddList = toAddSection.createDiv({ cls: 'logseqer-sync-list' });
        toAddItems.forEach(page => {
            const item = toAddList.createDiv({ cls: 'logseqer-sync-item' });
            const labelDiv = item.createDiv({ cls: 'logseqer-sync-item-label' });
            labelDiv.setText(page);
            
            const controlDiv = item.createDiv({ cls: 'logseqer-sync-item-control' });
            const checkbox = controlDiv.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
            checkbox.disabled = !canModify;
            checkbox.checked = this.selectedToAdd.has(page);
            checkbox.onchange = () => {
                if (canModify) {
                    if (checkbox.checked) {
                        this.selectedToAdd.add(page);
                    } else {
                        this.selectedToAdd.delete(page);
                    }
                    // Update header checkbox
                    toAddHeaderCheckbox.checked = toAddItems.every(p => this.selectedToAdd.has(p));
                }
            };
        });
        
        if (toAddItems.length === 0) {
            const emptyItem = toAddList.createDiv({ cls: 'logseqer-sync-item' });
            emptyItem.createDiv({ text: 'No new pages to add', cls: 'logseqer-sync-item-label' });
        }
        
        // Section 2: Existing pages
        const existingSection = contentEl.createDiv({ cls: 'logseqer-sync-section' });
        const existingHeader = existingSection.createDiv({ cls: 'logseqer-sync-header' });
        existingHeader.createSpan({
            text: `Existing (${currentPages.length})`,
            cls: 'logseqer-sync-header'
        });
        const existingHeaderCheckbox = existingHeader.createEl('input', { type: 'checkbox', cls: 'group-checkbox' }) as HTMLInputElement;
        existingHeaderCheckbox.disabled = true; // Existing items are read-only
        existingHeaderCheckbox.checked = currentPages.length > 0;
        
        const existingList = existingSection.createDiv({ cls: 'logseqer-sync-list' });
        const existingItems = currentPages.sort();
        existingItems.forEach(page => {
            const item = existingList.createDiv({ cls: 'logseqer-sync-item' });
            const labelDiv = item.createDiv({ cls: 'logseqer-sync-item-label' });
            labelDiv.setText(page);
            
            const controlDiv = item.createDiv({ cls: 'logseqer-sync-item-control' });
            const checkbox = controlDiv.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
            checkbox.disabled = true; // Existing items are read-only
            checkbox.checked = true;
        });
        
        if (existingItems.length === 0) {
            const emptyItem = existingList.createDiv({ cls: 'logseqer-sync-item' });
            emptyItem.createDiv({ text: 'No existing pages', cls: 'logseqer-sync-item-label' });
        }
        
        // Action buttons
        const btnRow = contentEl.createDiv({ cls: 'modal-button-row' });
        const rightDiv = btnRow.createDiv({ cls: 'modal-button-right' });
        
        const confirmBtn = rightDiv.createEl('button', { text: 'Confirm', cls: 'mod-cta' });
        confirmBtn.onclick = async () => {
            await this.executeSync();
            this.close();
        };
        
        const cancelBtn = rightDiv.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();
        
        // Adjust footer button widths (same as VaultCheckResolutionModal)
        const adjustFooterLayout = () => {
            const allBtns: HTMLButtonElement[] = Array.from(btnRow.querySelectorAll('button'));
            allBtns.forEach(b => { setElementStyles(b, { width: '', display: '' }); });
            const contentW = contentEl.clientWidth || (document.body.clientWidth - 200);
            let maxW = 0;
            allBtns.forEach(b => { maxW = Math.max(maxW, b.getBoundingClientRect().width); });
            const gap = 8;
            const totalNeeded = maxW * allBtns.length + gap * (allBtns.length - 1);
            if (totalNeeded <= contentW) {
                allBtns.forEach(b => setElementStyles(b, { width: `${Math.ceil(maxW)}px` }));
                setElementStyles(rightDiv, { flexBasis: '' });
            } else {
                setElementStyles(rightDiv, { flexBasis: '100%' });
                const rightBtns = Array.from(rightDiv.querySelectorAll('button'));
                if (rightBtns.length > 0) {
                    let m = 0;
                    rightBtns.forEach(b => m = Math.max(m, b.getBoundingClientRect().width));
                    rightBtns.forEach(b => setElementStyles(b, { width: `${Math.ceil(m)}px` }));
                }
                const widest = Math.max(...allBtns.map(b => b.getBoundingClientRect().width));
                if (widest > contentW) {
                    allBtns.forEach(b => { setElementStyles(b, { width: '100%', display: 'block' }); });
                }
            }
        };
        
        setTimeout(() => adjustFooterLayout(), 30);
        window.addEventListener('resize', adjustFooterLayout);
    }

    async executeSync() {
        const adapter = this.app.vault.adapter;
        
        try {
            // Sync to Obsidian if needed (pages from Logseq that are selected)
            if (this.canModifyObsidian) {
                const pagesToAddToObsidian = Array.from(this.selectedToAdd).filter(p => 
                    this.logseqPages.includes(p) && !this.obsidianPages.includes(p)
                );
                
                if (pagesToAddToObsidian.length > 0) {
                    const bookmarkContent = JSON.parse(await adapter.read(this.bookmarkPath)) as {items: BookmarkItem[]};
                    const existingPaths = new Set(bookmarkContent.items.map((item: BookmarkItem) => item.path || '').filter((path: string) => path.length > 0));
                    
                    // Build file map
                    const allFiles = this.app.vault.getMarkdownFiles();
                    const fileMap = new Map<string, TFile[]>();
                    for (const file of allFiles) {
                        if (!fileMap.has(file.basename)) {
                            fileMap.set(file.basename, []);
                        }
                        fileMap.get(file.basename)?.push(file);
                    }
                    
                    let addedCount = 0;
                    for (const pageName of pagesToAddToObsidian) {
                        const matches = fileMap.get(pageName) || [];
                        if (matches.length === 1) {
                            const file = matches[0];
                            if (!existingPaths.has(file.path)) {
                                bookmarkContent.items.push({
                                    type: 'file',
                                    ctime: Date.now(),
                                    path: file.path
                                });
                                existingPaths.add(file.path);
                                addedCount++;
                            }
                        }
                    }
                    
                    if (addedCount > 0) {
                        await adapter.write(this.bookmarkPath, JSON.stringify(bookmarkContent, null, 2));
                        new Notice(`Added ${addedCount} bookmarks to Obsidian.`);
                    }
                }
            }
            
            // Sync to Logseq if needed (pages from Obsidian that are selected)
            if (this.canModifyLogseq) {
                const pagesToAddToLogseq = Array.from(this.selectedToAdd).filter(p =>
                    this.obsidianPages.includes(p) && !this.logseqPages.includes(p)
                );
                
                if (pagesToAddToLogseq.length > 0) {
                    let configContent = await adapter.read(this.logseqConfigPath);
                    const favoritesRegex = /:favorites\s*\[([^\]]*)\]/;
                    const match = configContent.match(favoritesRegex);
                    
                    // Merge with existing
                    const currentExisting = match ? match[1].match(/"([^"]+)"/g)?.map(s => s.replace(/"/g, '')) || [] : [];
                    const mergedFavorites = new Set<string>([...currentExisting, ...pagesToAddToLogseq]);
                    const sortedMerged = Array.from(mergedFavorites).sort();
                    const favoritesArray = sortedMerged.map(name => `"${name}"`).join(' ');
                    
                    if (match) {
                        configContent = configContent.replace(favoritesRegex, `:favorites [${favoritesArray}]`);
                    } else {
                        if (configContent.trim().endsWith('}')) {
                            configContent = configContent.slice(0, -1) + ` :favorites [${favoritesArray}]\n}`;
                        } else {
                            configContent += `\n:favorites [${favoritesArray}]`;
                        }
                    }
                    
                    await adapter.write(this.logseqConfigPath, configContent);
                    new Notice(`Added ${pagesToAddToLogseq.length} favorites to Logseq.`);
                }
            }
            
        } catch (e) {
            console.error("Logseqer: Error executing bookmark sync", e);
            new Notice("Error executing bookmark sync. See console.");
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}

class SyncResolutionModal extends Modal {
    plugin: LogseqerPlugin;
    missingPages: string[];
    ambiguousPages: { name: string; files: (TFile | MockFile)[] }[];
    bookmarkPath: string;
    simulation: boolean;

    // State
    selectedMissing: Set<string>;
    selectedAmbiguous: Map<string, string>; // PageName -> FilePath

    constructor(
        app: App,
        plugin: LogseqerPlugin,
        missingPages: string[],
        ambiguousPages: { name: string; files: (TFile | MockFile)[] }[],
        bookmarkPath: string,
        simulation = false
    ) {
        super(app);
        this.plugin = plugin;
        this.missingPages = missingPages;
        this.ambiguousPages = ambiguousPages;
        this.bookmarkPath = bookmarkPath;
        this.simulation = !!simulation;

        this.selectedMissing = new Set(missingPages);
        this.selectedAmbiguous = new Map();

        // Default ambiguous to first option
        ambiguousPages.forEach(p => {
            if (p.files.length > 0) this.selectedAmbiguous.set(p.name, p.files[0].path);
        });
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Sync Logseq favorites' });
        contentEl.createEl('p', { text: 'Review changes to your Obsidian Bookmarks.', cls: 'logseqer-sync-desc' });

        // Section: Ambiguous (Duplicates)
        if (this.ambiguousPages.length > 0) {
            const section = contentEl.createDiv({ cls: 'logseqer-sync-section' });
            section.createSpan({ text: 'Duplicate matches (please select)', cls: 'logseqer-sync-header' });

            const list = section.createDiv({ cls: 'logseqer-sync-list' });

            this.ambiguousPages.forEach(p => {
                const item = list.createDiv({ cls: 'logseqer-sync-item' });

                // Label
                item.createDiv({ text: p.name, cls: 'logseqer-sync-item-label' });

                // Control (Select)
                const controlDiv = item.createDiv({ cls: 'logseqer-sync-item-control' });
                const select = controlDiv.createEl('select');

                p.files.forEach(f => {
                    select.createEl('option', { text: f.path, value: f.path });
                });

                select.onchange = (e) => {
                    const val = (e.target as HTMLSelectElement).value;
                    this.selectedAmbiguous.set(p.name, val);
                };
            });
        }

        // Section: Missing
        if (this.missingPages.length > 0) {
            const section = contentEl.createDiv({ cls: 'logseqer-sync-section' });
            section.createSpan({ text: 'Missing pages (create & bookmark)', cls: 'logseqer-sync-header' });

            const list = section.createDiv({ cls: 'logseqer-sync-list' });

            this.missingPages.forEach(p => {
                const item = list.createDiv({ cls: 'logseqer-sync-item' });

                // Label
                item.createDiv({ text: p, cls: 'logseqer-sync-item-label' });

                // Control (Checkbox via generic input for better style control, or Toggle)
                // Using simple generic input to avoid "Setting" overhead
                const controlDiv = item.createDiv({ cls: 'logseqer-sync-item-control' });
                const checkbox = controlDiv.createEl('input', { type: 'checkbox' });
                checkbox.checked = true;

                checkbox.onchange = (e) => {
                    const checked = (e.target as HTMLInputElement).checked;
                    if (checked) this.selectedMissing.add(p);
                    else this.selectedMissing.delete(p);
                };
            });
        }

        // Action Buttons
        const btnDiv = contentEl.createDiv({ cls: 'modal-button-container' });
        const saveBtn = btnDiv.createEl('button', { text: 'Sync selected', cls: 'mod-cta' });
        saveBtn.onclick = async () => await this.executeSync();

        const cancelBtn = btnDiv.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();
    }

    async executeSync() {
        if (this.simulation) {
            new Notice('Simulation mode: no changes will be made.');
            return;
        }

        this.close();
        const adapter = this.app.vault.adapter;
        let createdCount = 0;
        let addedCount = 0;

        try {
            // Read latest
            const bookmarkContent = JSON.parse(await adapter.read(this.bookmarkPath));

            // 1. Ambiguous
            this.selectedAmbiguous.forEach((_name, path) => {
                bookmarkContent.items.push({
                    type: 'file',
                    ctime: Date.now(),
                    path: path
                });
                addedCount++;
            });

            // 2. Missing
            for (const name of Array.from(this.selectedMissing)) {
                // Use default location for new notes
                const folderPath = this.app.fileManager.getNewFileParent("").path;
                const targetPath = `${folderPath}/${name}.md`;

                if (!(await adapter.exists(targetPath))) {
                    await this.app.vault.create(targetPath, "");
                }

                // Add to bookmarks (check if not already there, though unlikely for missing logic)
                // Actually, duplicate check is good practice
                const exists = bookmarkContent.items.some((i: BookmarkItem) => i.path === targetPath);
                if (!exists) {
                    bookmarkContent.items.push({
                        type: 'file',
                        ctime: Date.now(),
                        path: targetPath
                    });
                    createdCount++;
                }
            }

            if (createdCount > 0 || addedCount > 0) {
                await adapter.write(this.bookmarkPath, JSON.stringify(bookmarkContent, null, 2));
                new Notice(`Synced: ${addedCount} ambiguous resolved, ${createdCount} created in default folder.`);
            }

        } catch (e) {
            console.error("Logseqer: Failed to sync bookmarks", e);
            new Notice("Failed to sync bookmarks.");
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}

interface FixDataBase {
    type: string;
}

interface RenameFix extends FixDataBase {
    type: 'rename' | 'namespace-rename';
    newPath: string;
    namespacePath?: string;
    originalName?: string;
}

interface ContentReplaceFix extends FixDataBase {
    type: 'content-replace';
    content: string;
}

interface SettingsUpdateFix extends FixDataBase {
    type: 'settings-update';
    target: string;
    key: string;
    value: unknown;
}

type FixData = RenameFix | ContentReplaceFix | SettingsUpdateFix | null;

interface VaultCheckIssue {
    file?: TFile | MockFile; // Optional: Settings type issues don't need a specific file
    type: 'Date' | 'Namespace' | 'Task Marker' | 'Settings';
    description: string;
    suggestedFix: string;
    fixData: FixData;
}

class VaultCheckResolutionModal extends Modal {
    plugin: LogseqerPlugin;
    issues: VaultCheckIssue[];
    selectedIssues: Set<VaultCheckIssue>;
    simulation: boolean;
    components: Component[]; // Store components for cleanup

    constructor(app: App, plugin: LogseqerPlugin, issues: VaultCheckIssue[], simulation = false) {
        super(app);
        this.plugin = plugin;
        this.issues = issues;
        this.selectedIssues = new Set(issues.filter(i => i.fixData !== null));
        this.simulation = !!simulation;
        this.components = [];
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Vault compatibility check' });
        contentEl.createEl('p', { text: 'The following Logseq-to-Obsidian compatibility issues were found. Select the fixes you wish to apply.', cls: 'logseqer-sync-desc' });

            // (Select controls moved to modal footer)

        // Group issues by type
        const groups = new Map<string, VaultCheckIssue[]>();
        for (const i of this.issues) {
            const arr = groups.get(i.type) || [];
            arr.push(i);
            groups.set(i.type, arr);
        }

        groups.forEach((items, type) => {
            const section = contentEl.createDiv({ cls: 'logseqer-sync-section' });
            const header = section.createDiv({ cls: 'logseqer-sync-header' });
            header.createSpan({ text: `${type} (${items.length})`, cls: 'logseqer-sync-header' });

            // Group select checkbox (aligned right)
            const groupCheckbox = header.createEl('input', { type: 'checkbox', cls: 'group-checkbox' }) as HTMLInputElement;
            groupCheckbox.checked = items.every(it => this.selectedIssues.has(it));
            groupCheckbox.onchange = () => {
                if (groupCheckbox.checked) items.forEach(it => { if (it.fixData) this.selectedIssues.add(it); });
                else items.forEach(it => this.selectedIssues.delete(it));
                this.contentEl.empty();
                this.onOpen();
            };

            const list = section.createDiv({ cls: 'logseqer-sync-list' });

            items.forEach(issue => {
                const item = list.createDiv({ cls: 'logseqer-sync-item' });
                const infoDiv = item.createDiv({ cls: 'logseqer-sync-item-label' });
                
                // Show file path with Obsidian native link preview (if file exists)
                const pathDiv = infoDiv.createDiv({ cls: 'logseqer-issue-path' });
                if (issue.file) {
                    // Try using workspace hover-link event for preview
                    // Remove .md extension for internal link format
                    const hrefPath = issue.file.path.replace(/\.md$/, '');
                    const link = pathDiv.createEl('a', {
                        cls: 'internal-link',
                        text: issue.file.path,
                        href: hrefPath
                    });
                    link.setAttribute('data-href', hrefPath);
                    link.setAttribute('href', hrefPath);
                    
                    // Register hover event to trigger Obsidian's native preview
                    // Note: Obsidian's hover preview may not work in modals without additional setup
                    // This is a limitation - hover preview typically works in markdown views, not modals
                    link.onclick = (e) => {
                        e.preventDefault();
                        void this.app.workspace.openLinkText(hrefPath, '', true);
                    };
                } else {
                    // For Settings type issues without a file, just show description
                    pathDiv.setText(issue.description);
                }
                
                infoDiv.createEl('div', { text: issue.suggestedFix, cls: 'logseqer-issue-fix' });

                if (issue.fixData) {
                    const controlDiv = item.createDiv({ cls: 'logseqer-sync-item-control' });
                    const checkbox = controlDiv.createEl('input', { type: 'checkbox' }) as HTMLInputElement;
                    checkbox.checked = this.selectedIssues.has(issue);
                    checkbox.onchange = (e) => {
                        if ((e.target as HTMLInputElement).checked) this.selectedIssues.add(issue);
                        else this.selectedIssues.delete(issue);
                    };
                }
            });
        });

        // Footer: left = select controls, right = actions
        const btnRow = contentEl.createDiv({ cls: 'modal-button-row' });
        const leftDiv = btnRow.createDiv({ cls: 'modal-button-left' });
        const rightDiv = btnRow.createDiv({ cls: 'modal-button-right' });

        const selectAllBtn = leftDiv.createEl('button', { text: 'Select all' });
        const deselectAllBtn = leftDiv.createEl('button', { text: 'Deselect all' });
        selectAllBtn.onclick = () => {
            this.issues.forEach(i => { if (i.fixData) this.selectedIssues.add(i); });
            this.contentEl.empty();
            this.onOpen();
        };
        deselectAllBtn.onclick = () => {
            this.selectedIssues.clear();
            this.contentEl.empty();
            this.onOpen();
        };

        const fixBtn = rightDiv.createEl('button', { text: 'Apply', cls: 'mod-cta' });
        fixBtn.onclick = () => {
            if (this.simulation) {
                new Notice('Simulation mode: no changes will be made.');
                return;
            }
            new CustomConfirmationModal(this.app, 'Apply selected fixes? This will modify files in your vault.', () => {
                (async () => {
                    await this.applyFixes();
                    this.close();
                })();
            }).open();
        };

        const cancelBtn = rightDiv.createEl('button', { text: 'Close' });
        cancelBtn.onclick = () => this.close();

        // Adjust footer button widths and wrapping to match available space
        const adjustFooterLayout = () => {
            const allBtns: HTMLButtonElement[] = Array.from(btnRow.querySelectorAll('button'));
            // Reset styles
            allBtns.forEach(b => { setElementStyles(b, { width: '', display: '' }); });
            const contentW = contentEl.clientWidth || (document.body.clientWidth - 200);
            // measure widest
            let maxW = 0;
            allBtns.forEach(b => { maxW = Math.max(maxW, b.getBoundingClientRect().width); });
            const gap = 8; // approx
            const totalNeeded = maxW * allBtns.length + gap * (allBtns.length - 1);
            if (totalNeeded <= contentW) {
                // put left and right on same row, equalize width to maxW
                allBtns.forEach(b => setElementStyles(b, { width: `${Math.ceil(maxW)}px` }));
                setElementStyles(leftDiv, { flexBasis: '' });
                setElementStyles(rightDiv, { flexBasis: '' });
            } else {
                // Not enough space: put left group then right group
                setElementStyles(leftDiv, { flexBasis: '100%' });
                setElementStyles(rightDiv, { flexBasis: '100%' });
                // ensure buttons inside groups share equal widths
                const leftBtns = Array.from(leftDiv.querySelectorAll('button'));
                const rightBtns = Array.from(rightDiv.querySelectorAll('button'));
                const groups = [leftBtns, rightBtns];
                groups.forEach(g => {
                    if (g.length === 0) return;
                    let m = 0;
                    g.forEach(b => m = Math.max(m, b.getBoundingClientRect().width));
                    g.forEach(b => setElementStyles(b, { width: `${Math.ceil(m)}px` }));
                });
                // if still too wide, stack each button
                const widest = Math.max(...allBtns.map(b => b.getBoundingClientRect().width));
                if (widest > contentW) {
                    allBtns.forEach(b => { setElementStyles(b, { width: '100%', display: 'block' }); });
                }
            }
        };

        setTimeout(() => adjustFooterLayout(), 30);
        window.addEventListener('resize', adjustFooterLayout);
    }

    async applyFixes() {
        let renameCount = 0;
        let contentCount = 0;

        for (const issue of Array.from(this.selectedIssues)) {
            if (!issue.fixData) continue;

            try {
                if (issue.fixData.type === 'rename') {
                    // rename/move file
                    const newPath = issue.fixData.newPath;
                    const folderPath = newPath.substring(0, newPath.lastIndexOf('/'));

                    // Ensure parent folder exists
                    if (folderPath && !(await this.app.vault.adapter.exists(folderPath))) {
                        await this.app.vault.createFolder(folderPath);
                    }

                    // Only process rename if file is a TFile (not MockFile)
                    if (issue.file instanceof TFile) {
                        await this.app.fileManager.renameFile(issue.file, newPath);
                        renameCount++;
                    }
                } else if (issue.fixData.type === 'content-replace') {
                    // Replace Logseq task markers
                    if (issue.file instanceof TFile) {
                        let content = await this.app.vault.read(issue.file);
                        // Normalize DONE -> checked
                        content = content.replace(/^(\s*-?\s*)(?:DONE)\b\s*:??\s*/gmi, '$1- [x] ');
                        // Normalize TODO/DOING/NOW/LATER -> unchecked
                        content = content.replace(/^(\s*-?\s*)(?:TODO|DOING|NOW|LATER)\b\s*:??\s*/gmi, '$1- [ ] ');

                        await this.app.vault.modify(issue.file, content);
                        contentCount++;
                    }
                } else if (issue.fixData.type === 'namespace-rename') {
                    // Rename file from "a___b___c.md" to "c.md" and add "tags: a/b" at the beginning
                    const newPath = issue.fixData.newPath;
                    const namespacePath = issue.fixData.namespacePath;
                    
                    // Only process if file is a TFile (not MockFile)
                    if (!(issue.file instanceof TFile)) continue;
                    
                    // Read current content
                    let content = await this.app.vault.read(issue.file);
                    
                    // Add tags at the beginning if not already present
                    const tagsLine = `tags: ${namespacePath}`;
                    if (!content.includes(tagsLine)) {
                        // Check if file already has tags or frontmatter
                        const hasFrontmatter = content.startsWith('---');
                        if (hasFrontmatter) {
                            // Insert after frontmatter
                            const frontmatterEnd = content.indexOf('---', 3);
                            if (frontmatterEnd !== -1) {
                                content = content.slice(0, frontmatterEnd + 3) + '\n' + tagsLine + '\n' + content.slice(frontmatterEnd + 3);
                            } else {
                                // Malformed frontmatter, add at beginning
                                content = tagsLine + '\n\n' + content;
                            }
                        } else {
                            // No frontmatter, add at the beginning
                            content = tagsLine + '\n\n' + content;
                        }
                    }
                    
                    // Update content first (before rename to avoid path issues)
                    await this.app.vault.modify(issue.file, content);
                    
                    // Rename file
                    await this.app.fileManager.renameFile(issue.file, newPath);
                    
                    renameCount++;
                    contentCount++;
                } else if (issue.fixData.type === 'settings-update') {
                    // Update a config file in the vault config dir
                    try {
                        const cfgDir = this.app.vault.configDir;
                        const adapter = this.app.vault.adapter;
                        const target = issue.fixData.target; // 'daily-notes.json' or 'app.json'
                        const key = issue.fixData.key;
                        const value = issue.fixData.value;
                        const path = `${cfgDir}/${target}`;
                        let data: Record<string, unknown> = {};
                        if (await adapter.exists(path)) {
                            const txt = await adapter.read(path);
                            try { data = JSON.parse(txt) as Record<string, unknown>; } catch { data = {}; }
                        }
                        data[key] = value;
                        await adapter.write(path, JSON.stringify(data, null, 2));
                    } catch (error) {
                        console.error('Failed to update settings file', error);
                    }
                }
            } catch (e) {
                const issueDesc = issue.file ? issue.file.path : issue.description;
                console.error(`Failed to fix issue for ${issueDesc}:`, e);
            }
        }

        new Notice(`Applied ${renameCount} renames and ${contentCount} content fixes.`);
    }

    onClose() {
        // Clean up components
        this.components.forEach(component => component.unload());
        this.components = [];
        this.contentEl.empty();
    }
}
