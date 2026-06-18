import {
    Plugin,
    BasesView,
    BasesPropertyOption,
    MarkdownRenderer,
    QueryController,
    TFile,
    PluginSettingTab,
    Setting
} from 'obsidian';

interface SpotlightSettings {
    propertyHeights: Record<string, number>;
    propertyOrder: string[];
}

const DEFAULT_SETTINGS: SpotlightSettings = {
    propertyHeights: {},
    propertyOrder: []
};



class SpotlightView extends BasesView {
    type = 'bases-spotlight-view';
    currentIndex = 0;
    sidebarVisible = true;
    sidebarWidth = 300;

    private centerEl: HTMLElement;
    private sidebarEl: HTMLElement;
    private isResizing = false;
    private containerEl: HTMLElement;
    public plugin: BasesSpotlightPlugin;

    constructor(controller: QueryController, containerEl: HTMLElement, plugin: BasesSpotlightPlugin) {
        super(controller);
        this.plugin = plugin;
        this.containerEl = containerEl;
        
        // Setup base DOM
        this.containerEl.addClass('spotlight-bases-view');
        this.containerEl.tabIndex = 0; // Make focusable for keyboard events

        // Layout: Center, Resizer, Sidebar
        this.centerEl = this.containerEl.createDiv('spotlight-center');
        
        const resizerEl = this.containerEl.createDiv('spotlight-resizer');
        resizerEl.addEventListener('mousedown', (e) => this.initResize(e));

        this.sidebarEl = this.containerEl.createDiv('spotlight-sidebar');

        // Keyboard navigation
        this.containerEl.addEventListener('keydown', (e) => this.handleKeyDown(e));
        
        // Hide/Show sidebar toggle
        const toggleBtn = this.containerEl.createEl('button', {
            text: 'Toggle Sidebar',
            cls: 'spotlight-sidebar-toggle'
        });
        toggleBtn.addEventListener('click', () => this.toggleSidebar());
    }

    onDataUpdated(): void {
        this.render();
    }

    private get filteredEntries(): any[] {
        if (!this.data || !this.data.data) return [];
        return this.data.data.filter((entry: any) => {
            const file = entry.file;
            if (file instanceof TFile && file.extension !== 'md') {
                const sidecarPath = file.path + '.md';
                if (this.app.vault.getAbstractFileByPath(sidecarPath)) {
                    return false; // Hide original file if shadow md exists
                }
            }
            return true;
        });
    }

    private toggleSidebar() {
        this.sidebarVisible = !this.sidebarVisible;
        if (this.sidebarVisible) {
            this.sidebarEl.style.display = 'flex';
        } else {
            this.sidebarEl.style.display = 'none';
        }
    }

    private initResize(e: MouseEvent) {
        this.isResizing = true;
        document.addEventListener('mousemove', this.doResize);
        document.addEventListener('mouseup', this.stopResize);
    }

    private doResize = (e: MouseEvent) => {
        if (!this.isResizing) return;
        const containerRect = this.containerEl.getBoundingClientRect();
        // Calculate new width for right sidebar
        const newWidth = containerRect.right - e.clientX;
        if (newWidth > 100 && newWidth < containerRect.width - 100) {
            this.sidebarWidth = newWidth;
            this.sidebarEl.style.width = `${this.sidebarWidth}px`;
        }
    }

    private stopResize = () => {
        this.isResizing = false;
        document.removeEventListener('mousemove', this.doResize);
        document.removeEventListener('mouseup', this.stopResize);
    }

    private handleKeyDown(e: KeyboardEvent) {
        const entries = this.filteredEntries;
        if (!entries.length) return;
        
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            this.currentIndex = Math.min(this.currentIndex + 1, entries.length - 1);
            this.render();
            e.preventDefault();
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
            this.currentIndex = Math.max(this.currentIndex - 1, 0);
            this.render();
            e.preventDefault();
        }
    }

    private render() {
        this.centerEl.empty();
        this.sidebarEl.empty();

        const entries = this.filteredEntries;

        if (!entries.length) {
            this.centerEl.createEl('div', { text: 'No entries found.', cls: 'spotlight-empty' });
            return;
        }

        // Clamp index
        if (this.currentIndex >= entries.length) {
            this.currentIndex = entries.length - 1;
        }
        if (this.currentIndex < 0) {
            this.currentIndex = 0;
        }

        const entry = entries[this.currentIndex];

        // Render Spotlight Center
        let shouldRenderProperty = false;
        let valueStr = '';
        const spotlightProperty = this.config.get('spotlight_property') as string | undefined;
        const centerContentEl = this.centerEl.createDiv('spotlight-center-content');
        
        if (spotlightProperty && spotlightProperty !== '') {
            const propValue = entry.getValue(spotlightProperty as any);
            valueStr = this.formatValue(propValue);
            if (valueStr !== '') {
                shouldRenderProperty = true;
            }
        }

        if (shouldRenderProperty) {
            const linkMatch = valueStr.match(/\[\[(.*?)\]\]/);
            if (linkMatch) {
                const linkText = linkMatch[1];
                const linkPath = linkText.split('|')[0];
                const destFile = this.app.metadataCache.getFirstLinkpathDest(linkPath, entry.file instanceof TFile ? entry.file.path : '');
                
                if (destFile instanceof TFile) {
                    this.renderFileContent(destFile, centerContentEl, this.currentIndex);
                } else {
                    this.centerEl.removeClass('spotlight-center-no-padding');
                    centerContentEl.empty();
                    centerContentEl.addClass('spotlight-error-container');
                    centerContentEl.createEl('div', { text: '❓', cls: 'spotlight-error-icon' });
                    centerContentEl.createEl('div', { text: `File not found: ${linkPath}`, cls: 'spotlight-error-message' });
                }
            } else {
                this.centerEl.removeClass('spotlight-center-no-padding');
                centerContentEl.createEl('div', { text: valueStr, cls: 'spotlight-attribute-content' });
            }
        } else {
            // Display page content
            let file = entry.file;
            if (file instanceof TFile) {
                this.renderFileContent(file, centerContentEl, this.currentIndex);
            } else {
                this.centerEl.removeClass('spotlight-center-no-padding');
                centerContentEl.createEl('div', { text: 'Cannot read file content.' });
            }
        }

        // Render Sidebar
        this.sidebarEl.style.width = `${this.sidebarWidth}px`;
        const sidebarTitle = this.sidebarEl.createEl('h3', { text: 'Attributes' });
        sidebarTitle.addClass('spotlight-sidebar-title');

        let properties = [...(this.data.properties || [])];
        const orderMap = new Map<string, number>();
        this.plugin.settings.propertyOrder.forEach((p, i) => orderMap.set(p, i));
        properties.sort((a, b) => {
            const indexA = orderMap.has(a) ? orderMap.get(a)! : Infinity;
            const indexB = orderMap.has(b) ? orderMap.get(b)! : Infinity;
            return indexA - indexB;
        });

        // Resolve target file and sidecar once
        let targetFile = entry.file as TFile;
        let isBinary = targetFile.extension !== 'md';
        let sidecarFile: TFile | null = null;
        
        if (isBinary) {
            const sidecarPath = targetFile.path + '.md';
            const sc = this.app.vault.getAbstractFileByPath(sidecarPath);
            if (sc instanceof TFile) sidecarFile = sc;
        }

        for (const prop of properties) {
            let val = entry.getValue(prop);

            // Try fallback to sidecar if val is empty
            if (!val && sidecarFile && prop.startsWith('note.')) {
                const propName = prop.substring(5);
                const cache = this.app.metadataCache.getFileCache(sidecarFile);
                if (cache?.frontmatter && cache.frontmatter[propName] !== undefined) {
                    val = cache.frontmatter[propName] as any;
                }
            }
            
            const propEl = this.sidebarEl.createDiv('spotlight-property');
            propEl.dataset.prop = prop;
            
            const propNameEl = propEl.createDiv({ text: this.getPropName(prop), cls: 'spotlight-property-name' });
            
            // Reordering logic: only the name is draggable
            propNameEl.draggable = true;
            propNameEl.style.cursor = 'grab'; // show grab cursor on the name
            
            propNameEl.addEventListener('dragstart', (e) => {
                e.dataTransfer?.setData('text/plain', prop);
                propEl.classList.add('spotlight-property-dragging');
            });
            propNameEl.addEventListener('dragend', () => {
                propEl.classList.remove('spotlight-property-dragging');
                this.sidebarEl.querySelectorAll('.spotlight-property-drag-over').forEach(el => el.classList.remove('spotlight-property-drag-over'));
                this.sidebarEl.querySelectorAll('.spotlight-property-drag-below').forEach(el => el.classList.remove('spotlight-property-drag-below'));
            });

            // Drop targets remain the entire property block
            propEl.addEventListener('dragover', (e) => {
                e.preventDefault();
                const rect = propEl.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                if (e.clientY < midY) {
                    propEl.classList.add('spotlight-property-drag-over');
                    propEl.classList.remove('spotlight-property-drag-below');
                } else {
                    propEl.classList.add('spotlight-property-drag-below');
                    propEl.classList.remove('spotlight-property-drag-over');
                }
            });
            propEl.addEventListener('dragleave', () => {
                propEl.classList.remove('spotlight-property-drag-over');
                propEl.classList.remove('spotlight-property-drag-below');
            });
            propEl.addEventListener('drop', async (e) => {
                e.preventDefault();
                propEl.classList.remove('spotlight-property-drag-over');
                propEl.classList.remove('spotlight-property-drag-below');
                
                const draggedProp = e.dataTransfer?.getData('text/plain');
                if (!draggedProp || draggedProp === prop) return;
                
                const rect = propEl.getBoundingClientRect();
                const midY = rect.top + rect.height / 2;
                const insertAfter = e.clientY >= midY;
                
                const currentOrder = [...properties];
                const fromIndex = currentOrder.indexOf(draggedProp);
                if (fromIndex > -1) currentOrder.splice(fromIndex, 1);
                
                let toIndex = currentOrder.indexOf(prop);
                if (insertAfter) toIndex++;
                currentOrder.splice(toIndex, 0, draggedProp);
                
                this.plugin.settings.propertyOrder = currentOrder;
                await this.plugin.saveSettings();
                this.render();
            });

            
            const valContainerEl = propEl.createDiv({ cls: 'spotlight-property-value-container' });
            
            // Set saved height
            if (this.plugin.settings.propertyHeights[prop]) {
                valContainerEl.style.height = `${this.plugin.settings.propertyHeights[prop]}px`;
                valContainerEl.style.maxHeight = 'none';
            }

            const valEl = valContainerEl.createDiv({ cls: 'spotlight-property-value spotlight-scrollable-text' });
            
            // Resizing logic
            const resizerEl = propEl.createDiv('spotlight-property-resizer');
            resizerEl.draggable = false;
            let startY = 0;
            let startHeight = 0;
            
            const onMouseMove = (e: MouseEvent) => {
                const newHeight = Math.max(20, startHeight + (e.clientY - startY));
                valContainerEl.style.height = `${newHeight}px`;
                valContainerEl.style.maxHeight = 'none';
            };
            
            const onMouseUp = async () => {
                document.removeEventListener('mousemove', onMouseMove);
                document.removeEventListener('mouseup', onMouseUp);
                
                const currentHeight = valContainerEl.getBoundingClientRect().height;
                this.plugin.settings.propertyHeights[prop] = currentHeight;
                await this.plugin.saveSettings();
            };
            
            resizerEl.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                startY = e.clientY;
                startHeight = valContainerEl.getBoundingClientRect().height;
                document.addEventListener('mousemove', onMouseMove);
                document.addEventListener('mouseup', onMouseUp);
            });

            let isEmpty = false;
            if (val && typeof (val as any).renderTo === 'function') {
                (val as any).renderTo(valEl, this.app.renderContext);
                // Simple heuristic for empty rendered value
                if (valEl.innerHTML === '') isEmpty = true;
            } else {
                const formatted = this.formatValue(val);
                if (formatted === '') isEmpty = true;
                else valEl.setText(formatted);
            }

            if (isEmpty) {
                valEl.setText('—');
                valEl.style.color = 'var(--text-faint)';
            }

            // Editable logic
            if (prop.startsWith('note.') && entry.file instanceof TFile) {
                propEl.title = "Click to edit";
                propEl.style.cursor = "pointer";
                propEl.addEventListener('click', async (e) => {
                    // Prevent multiple inputs if already editing
                    if (valContainerEl.querySelector('.spotlight-property-edit-input')) return;
                    
                    const propName = prop.substring(5);
                    
                    // Determine which file to read/edit
                    let originalFile = entry.file as TFile;
                    let targetIsBinary = originalFile.extension !== 'md';
                    let sidecarPath = targetIsBinary ? originalFile.path + '.md' : null;
                    let sidecar = sidecarPath ? this.app.vault.getAbstractFileByPath(sidecarPath) as TFile | null : null;
                    
                    let fileToRead = targetIsBinary ? sidecar : originalFile;

                    let rawValue: any = undefined;
                    if (fileToRead instanceof TFile) {
                        const cache = this.app.metadataCache.getFileCache(fileToRead);
                        rawValue = cache?.frontmatter?.[propName];
                    }
                    
                    // Use Obsidian's internal type manager if available to detect checkbox properties
                    const typeManager = (this.app as any).metadataTypeManager;
                    const propType = typeManager?.getPropertyInfo?.(propName)?.type;
                    const isCheckbox = propType === 'checkbox' || typeof rawValue === 'boolean';

                    if (isCheckbox) {
                        // For checkboxes, create sidecar immediately if needed, since there's no input phase
                        let fileToEdit = fileToRead;
                        if (!fileToEdit && sidecarPath) {
                            fileToEdit = await this.app.vault.create(sidecarPath, '') as TFile;
                        }
                        if (fileToEdit instanceof TFile) {
                            this.app.fileManager.processFrontMatter(fileToEdit, (fm) => {
                                fm[propName] = !rawValue;
                            });
                        }
                        return; // Handled directly, no need for textbox
                    }

                    const editValue = rawValue !== undefined ? (typeof rawValue === 'object' ? JSON.stringify(rawValue) : String(rawValue)) : '';
                    
                    valContainerEl.empty();
                    const inputEl = valContainerEl.createEl('textarea', { cls: 'spotlight-property-edit-input' });
                    inputEl.value = editValue;
                    inputEl.focus();

                    const save = async () => {
                        const newValStr = inputEl.value;
                        let parsedVal: any = newValStr;
                        try {
                            // Try to parse JSON (e.g. arrays like ["tag1", "tag2"])
                            if (newValStr.startsWith('[') || newValStr.startsWith('{')) {
                                parsedVal = JSON.parse(newValStr);
                            } else if (newValStr === 'true') parsedVal = true;
                            else if (newValStr === 'false') parsedVal = false;
                            else if (!isNaN(Number(newValStr)) && newValStr !== '') parsedVal = Number(newValStr);
                        } catch (err) {
                            // Keep as string
                        }

                        // Create sidecar now if needed
                        let fileToEdit = fileToRead;
                        if (!fileToEdit && sidecarPath) {
                            // Only create if we are actually saving a value, don't create for empty cancels
                            if (newValStr === '') {
                                this.render();
                                return;
                            }
                            fileToEdit = await this.app.vault.create(sidecarPath, '') as TFile;
                        }

                        if (fileToEdit instanceof TFile) {
                            await this.app.fileManager.processFrontMatter(fileToEdit, (fm) => {
                                if (newValStr === '') {
                                    delete fm[propName];
                                } else {
                                    fm[propName] = parsedVal;
                                }
                            });
                        }
                        
                        // Force rerender if we created/edited a sidecar manually
                        if (fileToEdit !== originalFile) {
                            setTimeout(() => this.render(), 100);
                        }
                    };

                    inputEl.addEventListener('blur', save);
                    inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            inputEl.blur(); // Triggers save
                        } else if (e.key === 'Escape') {
                            e.preventDefault();
                            // Cancel edit: just rerender
                            this.render();
                        }
                    });
                });
            }
        }

        const countEl = this.sidebarEl.createDiv('spotlight-count');
        countEl.setText(`Entry ${this.currentIndex + 1} of ${entries.length}`);
    }

    private formatValue(val: any): string {
        if (val === null || val === undefined) return '';
        if (typeof val === 'object') {
            if (Array.isArray(val)) return val.map(v => this.formatValue(v)).join(', ');
            // Handle specific Obsidian Value types if necessary, here fallback to JSON
            if (val.value !== undefined) return this.formatValue(val.value); // heuristic for unwrapping Value wrappers
            try {
                return JSON.stringify(val);
            } catch {
                return String(val);
            }
        }
        return String(val);
    }

    private getPropName(propId: string): string {
        // e.g. "note.tags" -> "tags"
        const parts = propId.split('.');
        return parts.length > 1 ? parts.slice(1).join('.') : propId;
    }

    private renderFileContent(file: TFile, containerEl: HTMLElement, renderIndex: number) {
        // If it's a sidecar (e.g. image.png.md), display the original file instead
        const sidecarMatch = file.name.match(/^(.*\.(png|jpg|jpeg|gif|bmp|svg|webp|pdf))\.md$/i);
        if (sidecarMatch) {
            const originalPath = file.path.slice(0, -3);
            const originalFile = this.app.vault.getAbstractFileByPath(originalPath);
            if (originalFile instanceof TFile) {
                file = originalFile;
            }
        }

        const ext = file.extension.toLowerCase();
        const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];
        
        if (imageExtensions.includes(ext) || ext === 'pdf') {
            this.centerEl.addClass('spotlight-center-no-padding');
        } else {
            this.centerEl.removeClass('spotlight-center-no-padding');
        }

        if (imageExtensions.includes(ext)) {
            containerEl.empty();
            containerEl.addClass('spotlight-center-media-container');
            const resourcePath = this.app.vault.getResourcePath(file);
            containerEl.createEl('img', { attr: { src: resourcePath }, cls: 'spotlight-media' });
        } else if (ext === 'pdf') {
            containerEl.empty();
            containerEl.addClass('spotlight-center-pdf-container');
            const resourcePath = this.app.vault.getResourcePath(file);
            containerEl.createEl('iframe', {
                cls: 'spotlight-pdf-iframe',
                attr: {
                    src: resourcePath,
                    type: 'application/pdf',
                }
            });
        } else {
            this.app.vault.cachedRead(file).then(content => {
                if (this.currentIndex !== renderIndex) return;
                containerEl.empty();
                containerEl.addClass('markdown-rendered', 'markdown-preview-view');
                MarkdownRenderer.render(this.app, content, containerEl, file.path, this);
            }).catch(err => {
                if (this.currentIndex !== renderIndex) return;
                containerEl.empty();
                containerEl.createEl('div', { text: `Could not load content for ${file.name}.` });
            });
        }
    }
}

export default class BasesSpotlightPlugin extends Plugin {
    settings: SpotlightSettings;

    async onload() {
        await this.loadSettings();

        this.registerBasesView('bases-spotlight-view', {
            name: "Spotlight View",
            factory: (controller: QueryController, containerEl: HTMLElement) => {
                const view = new SpotlightView(controller, containerEl, this);
                return view;
            },
            options: (config) => [
                {
                    type: 'property',
                    key: 'spotlight_property',
                    displayName: 'Spotlight Content Property',
                    // @ts-ignore
                    description: 'Select an attribute to display in the center instead of the page content'
                } as BasesPropertyOption
            ]
        });
    }

    onunload() {
        // Cleanup if necessary
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
}
