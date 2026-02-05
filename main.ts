import { Plugin, ItemView, WorkspaceLeaf, MarkdownView, Notice, TFile, PluginSettingTab, Setting, Modal, App, TextComponent, TFolder, TAbstractFile } from 'obsidian';

// Interface for settings can be added here
// Interface for settings
interface LogseqerSettings {
    ignoreVaultCheck: boolean;
    enableSyntaxCheck: boolean;
    enableJournalNew: boolean;
    enableBacklinkQuery: boolean;
    backlinkQueryString: string;
    logseqFolder: string; // Folder containing Logseq files
    obsidianFolder: string; // Folder containing Obsidian config
}

const DEFAULT_SETTINGS: LogseqerSettings = {
    ignoreVaultCheck: false,
    enableSyntaxCheck: true,
    enableJournalNew: true,
    enableBacklinkQuery: true,
    backlinkQueryString: '-path:"journals/Journaling"',
    logseqFolder: 'logseq',
    obsidianFolder: '.obsidian'
}

export default class LogseqerPlugin extends Plugin {
    settings: LogseqerSettings;
    statusBarItem: HTMLElement;

    async onload() {
        await this.loadSettings();

        this.addSettingTab(new LogseqerSettingTab(this.app, this));

        // 1. Feature: Page Node Syntax Check
        this.statusBarItem = this.addStatusBarItem();
        this.statusBarItem.addClass("logseqer-status-item");
        this.updateSyntaxCheck(); // Initial check

        // Register event for active leaf change

        this.registerEvent(this.app.workspace.on('active-leaf-change', (leaf) => {
            this.updateSyntaxCheck();
            this.updateBacklinkQuery(leaf);
        }));

        // Also trigger on file-open which might be cleaner for completely new files loading
        this.registerEvent(this.app.workspace.on('file-open', (file) => {
            // When file opens, the active leaf is relevant
            this.updateBacklinkQuery();
        }));

        // Register event for editor changes
        this.registerEvent(
            this.app.workspace.on('editor-change', (editor, info) => {
                this.updateSyntaxCheck();
            })
        );

        // 2. Feature: Vault Check Command
        this.addCommand({
            id: 'logseqer-check-vault',
            name: 'Check Vault Compatibility',
            callback: () => {
                this.runVaultCheckCommand();
            }
        });

        // 3. Feature: Sync Settings Command
        this.addCommand({
            id: 'logseqer-sync-settings',
            name: 'Sync Settings (Bookmarks/Favorites)',
            callback: () => {
                this.syncSettings();
            }
        });

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
                    await this.app.vault.process(file, (data) => {
                        if (!data.startsWith("- ")) {
                            return "- " + data;
                        }
                        return data;
                    });
                }
            })
        );
    }

    onunload() {

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
            // @ts-ignore
            const dailyNotesPlugin = this.app.internalPlugins.getPluginById('daily-notes');
            if (dailyNotesPlugin && dailyNotesPlugin.instance && dailyNotesPlugin.instance.options) {
                return dailyNotesPlugin.instance.options.folder || 'journals';
            }
        } catch (e) {
            console.warn("Logseqer: Could not retrieve Daily Notes Settings, falling back to 'journals'", e);
        }
        return 'journals';
    }

    // 2. Feature: Vault Check
    async checkVault() {
        if (this.settings.ignoreVaultCheck) return;

        // Notify user about the check
        new Notice("Logseqer: It is recommended to run 'Check Vault Compatibility' command once to ensure smooth interoperability.");
    }

    async runVaultCheckCommand() {
        new Notice("Vault Check started...");
        console.log("Logseqer: Starting Vault Check...");

        const files = this.app.vault.getMarkdownFiles();
        const journalFolder = this.getDailyNoteFolder();
        const issues: VaultCheckIssue[] = [];

        // Basic Regex for dates like 2024_01_01, 2024-01-01, etc.
        const dateLikeRegex = /^(\d{4}[-_]\d{2}[-_]\d{2})$/;

        for (const file of files) {
            const fileName = file.basename;

            // 1. Date Format Check
            if (file.path.startsWith(journalFolder + '/')) {
                if (!dateLikeRegex.test(fileName)) {
                    issues.push({
                        file,
                        type: 'Date',
                        description: `Journal file "${file.path}" does not match YYYY-MM-DD or YYYY_MM_DD.`,
                        suggestedFix: "No automatic fix available (Manual Rename recommended).",
                        fixData: null
                    });
                }
            }

            // 2. Namespace check
            if (fileName.includes('.') && !fileName.startsWith('.')) {
                const newPath = file.path.replace(fileName, fileName.replace(/\./g, '/'));
                issues.push({
                    file,
                    type: 'Namespace',
                    description: `File "${file.path}" contains dots in the name (Logseq style hierarchy).`,
                    suggestedFix: `Convert to Obsidian folders: "${newPath}"`,
                    fixData: { type: 'rename', newPath }
                });
            }

            // 3. Task marker conversion
            const content = await this.app.vault.read(file);
            if (content.includes("TODO ") || content.includes("DOING ")) {
                issues.push({
                    file,
                    type: 'Task Marker',
                    description: `File "${file.path}" contains Logseq task markers (TODO/DOING).`,
                    suggestedFix: "Convert Logseq markers to Obsidian tasks (- [ ]).",
                    fixData: { type: 'content-replace', content }
                });
            }
        }

        if (issues.length > 0) {
            new VaultCheckResolutionModal(this.app, this, issues).open();
        } else {
            new Notice("Vault Check completed. No issues found!");
        }
    }

    // 3. Feature: Settings Sync
    async syncSettings() {
        const adapter = this.app.vault.adapter;
        const bookmarkPath = `${this.settings.obsidianFolder}/bookmarks.json`;
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

            // 5. Build Map of all markdown files: Basename -> TFile[]
            const allFiles = this.app.vault.getMarkdownFiles();
            const fileMap = new Map<string, TFile[]>();

            for (const file of allFiles) {
                if (!fileMap.has(file.basename)) {
                    fileMap.set(file.basename, []);
                }
                fileMap.get(file.basename)?.push(file);
            }

            // 6. Categorize Pages
            const bookmarkContent = JSON.parse(await adapter.read(bookmarkPath));
            const existingPaths = new Set(bookmarkContent.items.map((item: any) => item.path));

            let addedDirectlyCount = 0;
            const missingPages: string[] = [];
            const ambiguousPages: { name: string; files: TFile[] }[] = [];

            // Helper for fallback checks
            const journalFolder = this.getDailyNoteFolder();

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
                new Notice(`Synced ${addedDirectlyCount} unique favorites.`);
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
            console.error(e);
            new Notice("Error syncing settings. See console.");
        }
    }

    // 4. Feature: Backlinks Customization
    // Custom "journals/*" backlinks default query (now uses dynamic folder)
    async updateBacklinkQuery(leaf?: WorkspaceLeaf | null) {
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

            const tryInject = async (attempt: number) => {
                // Ensure element is connected (user hasn't closed tab)
                // @ts-ignore
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

        const editor = view.editor;
        const lineCount = editor.lineCount();
        const ruleRegExp = /^- /;
        let invalidCount = 0;

        for (let i = 0; i < lineCount; i++) {
            const line = editor.getLine(i);
            if (line.trim() === '') continue;

            if (!ruleRegExp.test(line)) {
                invalidCount++;
            }
        }

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
            this.suggestEl.style.position = 'fixed';
            this.suggestEl.style.left = `${rect.left}px`;
            this.suggestEl.style.top = `${rect.bottom}px`;
            this.suggestEl.style.width = `${rect.width}px`;
            document.body.appendChild(this.suggestEl);
        }

        this.suggestEl.empty();
        matches.forEach(folder => {
            const item = this.suggestEl!.createDiv({ cls: 'suggestion-item', text: folder });
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

    constructor(app: any, plugin: LogseqerPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();

        containerEl.createEl('h2', { text: 'Logseqer Plugin Settings' });

        new Setting(containerEl)
            .setName('Enable Syntax Check')
            .setDesc('Show syntax check status in status bar.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableSyntaxCheck)
                .onChange(async (value) => {
                    this.plugin.settings.enableSyntaxCheck = value;
                    await this.plugin.saveSettings();
                    this.plugin.updateSyntaxCheck();
                }));

        new Setting(containerEl)
            .setName('Enable New Journal Format')
            .setDesc('Automatically prepend "- " to new journal files.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableJournalNew)
                .onChange(async (value) => {
                    this.plugin.settings.enableJournalNew = value;
                    await this.plugin.saveSettings();
                }));

        containerEl.createEl('h3', { text: 'Vault & Sync' });

        new Setting(containerEl)
            .setName('Ignore Vault Check on Startup')
            .setDesc('Correct vault check warnings.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.ignoreVaultCheck)
                .onChange(async (value) => {
                    this.plugin.settings.ignoreVaultCheck = value;
                    await this.plugin.saveSettings();
                }));

        // Logseq Folder Setting with Folder Suggest
        let logseqInput: TextComponent;
        new Setting(containerEl)
            .setName('Logseq Folder')
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



        // Obsidian Folder Setting with Folder Suggest
        let obsidianInput: TextComponent;
        new Setting(containerEl)
            .setName('Obsidian Folder')
            .setDesc('Folder containing Obsidian config (bookmarks.json)')
            .addText(text => {
                obsidianInput = text;
                text.setValue(this.plugin.settings.obsidianFolder)
                    .onChange(async (value) => {
                        this.plugin.settings.obsidianFolder = value;
                        await this.plugin.saveSettings();
                    });
            });

        // Attach folder suggest to input
        new FolderSuggest(this.app, obsidianInput.inputEl);



        containerEl.createEl('h3', { text: 'Backlinks Customization' });

        new Setting(containerEl)
            .setName('Enable Backlink Default Query')
            .setDesc('Automatically set a search query in backlinks for Journals.')
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableBacklinkQuery)
                .onChange(async (value) => {
                    this.plugin.settings.enableBacklinkQuery = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Default Query')
            .setDesc('The query string to input into the backlinks search box. Example: -path:"journals/Journaling"')
            .addText(text => text
                .setPlaceholder('-path:"journals/Journaling"')
                .setValue(this.plugin.settings.backlinkQueryString)
                .onChange(async (value) => {
                    this.plugin.settings.backlinkQueryString = value;
                    await this.plugin.saveSettings();
                }));

        // Reset to Defaults Button
        containerEl.createEl('h3', { text: 'Advanced' });

        new Setting(containerEl)
            .setName('Restore Defaults')
            .setDesc('Reset all plugin settings to their default values')
            .addButton(button => button
                .setButtonText('Restore Defaults')
                .setWarning()
                .onClick(async () => {
                    // Confirmation dialog
                    const confirmed = confirm('Are you sure you want to restore all settings to default values? This cannot be undone.');
                    if (confirmed) {
                        this.plugin.settings = Object.assign({}, DEFAULT_SETTINGS);
                        await this.plugin.saveSettings();
                        this.display(); // Refresh the settings display
                        new Notice('Settings restored to defaults');
                    }
                }));
    }
}

class SyncResolutionModal extends Modal {
    plugin: LogseqerPlugin;
    missingPages: string[];
    ambiguousPages: { name: string; files: TFile[] }[];
    bookmarkPath: string;

    // State
    selectedMissing: Set<string>;
    selectedAmbiguous: Map<string, string>; // PageName -> FilePath

    constructor(
        app: App,
        plugin: LogseqerPlugin,
        missingPages: string[],
        ambiguousPages: { name: string; files: TFile[] }[],
        bookmarkPath: string
    ) {
        super(app);
        this.plugin = plugin;
        this.missingPages = missingPages;
        this.ambiguousPages = ambiguousPages;
        this.bookmarkPath = bookmarkPath;

        this.selectedMissing = new Set(missingPages);
        this.selectedAmbiguous = new Map();

        // Default ambiguous to first option
        ambiguousPages.forEach(p => {
            if (p.files.length > 0) this.selectedAmbiguous.set(p.name, p.files[0].path);
        });
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Sync Logseq Favorites' });
        contentEl.createEl('p', { text: 'Review changes to your Obsidian Bookmarks.', cls: 'logseqer-sync-desc' });

        // Section: Ambiguous (Duplicates)
        if (this.ambiguousPages.length > 0) {
            const section = contentEl.createDiv({ cls: 'logseqer-sync-section' });
            section.createSpan({ text: 'Duplicate Matches (Please Select)', cls: 'logseqer-sync-header' });

            const list = section.createDiv({ cls: 'logseqer-sync-list' });

            this.ambiguousPages.forEach(p => {
                const item = list.createDiv({ cls: 'logseqer-sync-item' });

                // Label
                item.createDiv({ text: p.name, cls: 'logseqer-sync-item-label' });

                // Control (Select)
                const controlDiv = item.createDiv({ cls: 'logseqer-sync-item-control' });
                const select = controlDiv.createEl('select');

                p.files.forEach(f => {
                    const opt = select.createEl('option', { text: f.path, value: f.path });
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
            section.createSpan({ text: 'Missing Pages (Create & Bookmark)', cls: 'logseqer-sync-header' });

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
        const saveBtn = btnDiv.createEl('button', { text: 'Sync Selected', cls: 'mod-cta' });
        saveBtn.onclick = async () => await this.executeSync();

        const cancelBtn = btnDiv.createEl('button', { text: 'Cancel' });
        cancelBtn.onclick = () => this.close();
    }

    async executeSync() {
        this.close();
        const adapter = this.app.vault.adapter;
        let createdCount = 0;
        let addedCount = 0;

        try {
            // Read latest
            const bookmarkContent = JSON.parse(await adapter.read(this.bookmarkPath));

            // 1. Ambiguous
            this.selectedAmbiguous.forEach((path, name) => {
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
                // @ts-ignore
                const folderPath = this.app.fileManager.getNewFileParent("").path;
                const targetPath = `${folderPath}/${name}.md`;

                if (!(await adapter.exists(targetPath))) {
                    await this.app.vault.create(targetPath, "");
                }

                // Add to bookmarks (check if not already there, though unlikely for missing logic)
                // Actually, duplicate check is good practice
                const exists = bookmarkContent.items.some((i: any) => i.path === targetPath);
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
            console.error(e);
            new Notice("Failed to sync bookmarks.");
        }
    }

    onClose() {
        this.contentEl.empty();
    }
}

interface VaultCheckIssue {
    file: TFile;
    type: 'Date' | 'Namespace' | 'Task Marker';
    description: string;
    suggestedFix: string;
    fixData: any;
}

class VaultCheckResolutionModal extends Modal {
    plugin: LogseqerPlugin;
    issues: VaultCheckIssue[];
    selectedIssues: Set<VaultCheckIssue>;

    constructor(app: App, plugin: LogseqerPlugin, issues: VaultCheckIssue[]) {
        super(app);
        this.plugin = plugin;
        this.issues = issues;
        this.selectedIssues = new Set(issues.filter(i => i.fixData !== null));
    }

    onOpen() {
        const { contentEl } = this;
        contentEl.createEl('h2', { text: 'Vault Compatibility Check' });
        contentEl.createEl('p', { text: 'The following Logseq-to-Obsidian compatibility issues were found. Select the fixes you wish to apply.', cls: 'logseqer-sync-desc' });

        const section = contentEl.createDiv({ cls: 'logseqer-sync-section' });
        const list = section.createDiv({ cls: 'logseqer-sync-list' });

        this.issues.forEach(issue => {
            const item = list.createDiv({ cls: 'logseqer-sync-item' });

            const infoDiv = item.createDiv({ cls: 'logseqer-sync-item-label' });
            infoDiv.createEl('span', { text: `[${issue.type}] `, cls: 'logseqer-issue-type' }).style.fontWeight = 'bold';
            infoDiv.createEl('span', { text: issue.description });
            infoDiv.createEl('br');
            infoDiv.createEl('span', { text: issue.suggestedFix, cls: 'logseqer-issue-fix' }).style.fontSize = '0.9em';
            infoDiv.createEl('span', { text: ` (File: ${issue.file.path})`, cls: 'logseqer-issue-path' }).style.color = 'var(--text-muted)';

            if (issue.fixData) {
                const controlDiv = item.createDiv({ cls: 'logseqer-sync-item-control' });
                const checkbox = controlDiv.createEl('input', { type: 'checkbox' });
                checkbox.checked = this.selectedIssues.has(issue);

                checkbox.onchange = (e) => {
                    if ((e.target as HTMLInputElement).checked) this.selectedIssues.add(issue);
                    else this.selectedIssues.delete(issue);
                };
            }
        });

        const btnDiv = contentEl.createDiv({ cls: 'modal-button-container' });
        const fixBtn = btnDiv.createEl('button', { text: 'Apply Selected Fixes', cls: 'mod-cta' });
        fixBtn.onclick = async () => {
            await this.applyFixes();
            this.close();
        };

        const cancelBtn = btnDiv.createEl('button', { text: 'Close' });
        cancelBtn.onclick = () => this.close();
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

                    await this.app.fileManager.renameFile(issue.file, newPath);
                    renameCount++;
                } else if (issue.fixData.type === 'content-replace') {
                    // Replace Logseq task markers
                    let content = await this.app.vault.read(issue.file);
                    content = content.replace(/^TODO /gm, '- [ ] ');
                    content = content.replace(/^DOING /gm, '- [/] ');
                    content = content.replace(/^- TODO /gm, '- [ ] ');
                    content = content.replace(/^- DOING /gm, '- [/] ');

                    await this.app.vault.modify(issue.file, content);
                    contentCount++;
                }
            } catch (e) {
                console.error(`Failed to fix issue for ${issue.file.path}:`, e);
            }
        }

        new Notice(`Applied ${renameCount} renames and ${contentCount} content fixes.`);
    }

    onClose() {
        this.contentEl.empty();
    }
}
