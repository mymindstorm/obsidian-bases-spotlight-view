import {
    Plugin,
    BasesView,
    BasesPropertyOption,
    MarkdownRenderer,
    QueryController,
    TFile,
    } from 'obsidian';

interface Spotlights {
    propertyHeights: Record<string, number>;
    propertyOrder: string[];
}

const DEFAULT_SETTINGS: Spotlights = {
    propertyHeights: {},
    propertyOrder: []
};



interface BasesEntry {
    file: TFile | null;
    getValue: (prop: string) => unknown;
}

class SpotlightView extends BasesView {
    type = 'bases-spotlight-view';
    currentIndex = 0;
    sidebarVisible = true;
    sidebarWidth = 300;

    private centerEl: HTMLElement;
    private sidebarEl: HTMLElement;
    private isResizing = false;
    private containerEl: HTMLElement;
    private activePdfBlobUrls: string[] = [];
    private wrapperEl: HTMLElement;
    public plugin: BasesSpotlightPlugin;

    constructor(controller: QueryController, containerEl: HTMLElement, plugin: BasesSpotlightPlugin) {
        super(controller);
        this.plugin = plugin;
        this.containerEl = containerEl;
        
        // Setup base DOM
        this.containerEl.addClass('spotlight-bases-view');
        this.containerEl.tabIndex = 0; // Make focusable for keyboard events

        this.wrapperEl = this.containerEl.createDiv('spotlight-bases-wrapper');

        // Layout: Center, Resizer, Sidebar
        this.centerEl = this.wrapperEl.createDiv('spotlight-center');
        
        const resizerEl = this.wrapperEl.createDiv('spotlight-resizer');
        resizerEl.addEventListener('mousedown', (e) => this.initResize(e));

        this.sidebarEl = this.wrapperEl.createDiv('spotlight-sidebar');

        // Keyboard navigation
        this.containerEl.addEventListener('keydown', (e) => this.handleKeyDown(e));
        
        // Hide/Show sidebar toggle
        const toggleBtn = this.containerEl.createEl('button', {
            text: 'Toggle Sidebar',
            cls: 'spotlight-sidebar-toggle'
        });
        toggleBtn.addEventListener('click', () => this.toggleSidebar());

        const fullscreenBtn = this.containerEl.createEl('button', {
            text: 'Full Screen',
            cls: 'spotlight-fullscreen-toggle'
        });
        fullscreenBtn.addEventListener('click', () => {
            if (!activeDocument.fullscreenElement) {
                this.containerEl.requestFullscreen().catch((_err: unknown) => {
                    console.error(`Error attempting to enable fullscreen: ${err.message}`);
                });
            } else {
                activeDocument.exitFullscreen().catch(console.error);
            }
        });
        
        activeDocument.addEventListener('fullscreenchange', () => {
            if (activeDocument.fullscreenElement === this.containerEl) {
                fullscreenBtn.setText('Exit Full Screen');
                this.containerEl.addClass('spotlight-is-fullscreen');
            } else {
                fullscreenBtn.setText('Full Screen');
                this.containerEl.removeClass('spotlight-is-fullscreen');
            }
        });
    }

    onDataUpdated(): void {
        this.render();
    }

    private get filteredEntries(): BasesEntry[] {
        if (!this.data || !this.data.data) return [];
        return this.data.data.filter((entry: BasesEntry) => {
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
            this.sidebarEl.setCssStyles({ display: 'flex' });
        } else {
            this.sidebarEl.setCssStyles({ display: 'none' });
        }
    }

    private initResize(e: MouseEvent) {
        this.isResizing = true;
        activeDocument.addEventListener('mousemove', this.doResize);
        activeDocument.addEventListener('mouseup', this.stopResize);
    }

    private doResize = (e: MouseEvent) => {
        if (!this.isResizing) return;
        const containerRect = this.containerEl.getBoundingClientRect();
        // Calculate new width for right sidebar
        const newWidth = containerRect.right - e.clientX;
        if (newWidth > 100 && newWidth < containerRect.width - 100) {
            this.sidebarWidth = newWidth;
            this.sidebarEl.setCssStyles({ width: `${this.sidebarWidth}px` });
        }
    }

    private stopResize = () => {
        this.isResizing = false;
        activeDocument.removeEventListener('mousemove', this.doResize);
        activeDocument.removeEventListener('mouseup', this.stopResize);
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
            const propValue = entry.getValue(spotlightProperty);
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
                centerContentEl.empty();
                centerContentEl.addClass('spotlight-error-container');
                centerContentEl.createEl('div', { text: '❓', cls: 'spotlight-error-icon' });
                centerContentEl.createEl('div', { text: `File not found: ${valueStr}`, cls: 'spotlight-error-message' });
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
        this.sidebarEl.setCssStyles({ width: `${this.sidebarWidth}px` });
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
        let targetFile = entry.file;
        if (!(targetFile instanceof TFile)) return;
        if (!targetFile) return;
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
                    val = cache.frontmatter[propName];
                }
            }
            
            const propEl = this.sidebarEl.createDiv('spotlight-property');
            propEl.dataset.prop = prop;
            
            const propNameEl = propEl.createDiv({ text: this.getPropName(prop), cls: 'spotlight-property-name' });
            
            // Reordering logic: only the name is draggable
            propNameEl.draggable = true;
            propNameEl.setCssStyles({ cursor: 'grab' }); // show grab cursor on the name
            
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
            propEl.addEventListener('drop', (e) => { const doDrop = async () => {
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
                await this.plugin.saves();
                this.render();
                };
                doDrop().catch(console.error);
            });

            
            const valContainerEl = propEl.createDiv({ cls: 'spotlight-property-value-container' });
            
            // Set saved height
            if (this.plugin.settings.propertyHeights[prop]) {
                valContainerEl.setCssStyles({ height: `${this.plugin.settings.propertyHeights[prop]}px`, maxHeight: 'none' });
            }

            const valEl = valContainerEl.createDiv({ cls: 'spotlight-property-value spotlight-scrollable-text' });
            
            // Resizing logic
            const resizerEl = propEl.createDiv('spotlight-property-resizer');
            resizerEl.draggable = false;
            let startY = 0;
            let startHeight = 0;
            
            const onMouseMove = (e: MouseEvent) => {
                const newHeight = Math.max(20, startHeight + (e.clientY - startY));
                valContainerEl.setCssStyles({ height: `${newHeight}px`, maxHeight: 'none' });
            };
            
            const onMouseUp = () => { const doMouseUp = async () => {
                activeDocument.removeEventListener('mousemove', onMouseMove);
                activeDocument.removeEventListener('mouseup', onMouseUp);
                
                window.setTimeout(() => { this.isResizing = false; }, 50);
                
                const currentHeight = valContainerEl.getBoundingClientRect().height;
                this.plugin.settings.propertyHeights[prop] = currentHeight;
                await this.plugin.saves();
                };
                doMouseUp().catch(console.error);
            };
            
            resizerEl.addEventListener('mousedown', (e) => {
                e.preventDefault();
                e.stopPropagation();
                this.isResizing = true;
                startY = e.clientY;
                startHeight = valContainerEl.getBoundingClientRect().height;
                activeDocument.addEventListener('mousemove', onMouseMove);
                activeDocument.addEventListener('mouseup', onMouseUp);
            });
            
            resizerEl.addEventListener('click', (e) => {
                e.preventDefault();
                e.stopPropagation();
            });

            let isEmpty = false;
            if (val && typeof (val as { renderTo?: Function }).renderTo === 'function') {
                (val as { renderTo: Function }).renderTo(valEl, this.app.renderContext);
                // Simple heuristic for empty rendered value
                if (valEl.innerHTML === '') isEmpty = true;
            } else {
                const formatted = this.formatValue(val);
                if (formatted === '') isEmpty = true;
                else valEl.setText(formatted);
            }

            if (isEmpty) {
                valEl.setText('—');
                valEl.setCssStyles({ color: 'var(--text-faint)' });
            }

            const hyperlinkProperty = this.config.get('hyperlink_property') as string | undefined;

            // Editable or Link logic
            if (hyperlinkProperty && prop === hyperlinkProperty) {
                propEl.title = "Click to open file (Ctrl/Cmd+Click for new pane)";
                valEl.addClass('spotlight-hyperlink-value');
                propEl.addEventListener('click', (e) => {
                    if (this.isResizing || (e.target as HTMLElement).closest('.spotlight-property-resizer')) return;
                    if (entry.file instanceof TFile) {
                        const newLeaf = (e as MouseEvent).ctrlKey || (e as MouseEvent).metaKey || (e as MouseEvent).button === 1;
                        this.app.workspace.getLeaf(newLeaf).openFile(entry.file);
                    }
                });
            } else if (prop.startsWith('note.') && entry.file instanceof TFile) {
                propEl.title = "Click to edit";
                propEl.setCssStyles({ cursor: "pointer" });
                propEl.addEventListener('click', (e) => {
                    const doClick = async () => {
                    // Prevent edit if we just finished resizing or clicked the resizer
                    if (this.isResizing || (e.target as HTMLElement).closest('.spotlight-property-resizer')) return;
                    
                    // Prevent multiple inputs if already editing
                    if (valContainerEl.querySelector('.spotlight-property-edit-input')) return;
                    
                    const propName = prop.substring(5);
                    
                    // Determine which file to read/edit
                    let originalFile = entry.file;
                    if (!(originalFile instanceof TFile)) return;
                    let targetIsBinary = originalFile.extension !== 'md';
                    let sidecarPath = targetIsBinary ? originalFile.path + '.md' : null;
                    let sidecar = sidecarPath ? (this.app.vault.getAbstractFileByPath(sidecarPath) instanceof TFile ? this.app.vault.getAbstractFileByPath(sidecarPath) : null) : null;
                    
                    let fileToRead = targetIsBinary ? sidecar : originalFile;

                    let rawValue: unknown = undefined;
                    if (fileToRead instanceof TFile) {
                        const cache = this.app.metadataCache.getFileCache(fileToRead);
                        rawValue = cache?.frontmatter?.[propName];
                    }
                    
                    // Use Obsidian's internal type manager if available to detect checkbox properties
                    const typeManager = (this.app as unknown as { metadataTypeManager?: { getPropertyInfo: (p: string) => { type: string } } }).metadataTypeManager;
                    const propType = typeManager?.getPropertyInfo?.(propName)?.type;
                    const isCheckbox = propType === 'checkbox' || typeof rawValue === 'boolean';

                    if (isCheckbox) {
                        // For checkboxes, create sidecar immediately if needed, since there's no input phase
                        let fileToEdit = fileToRead;
                        if (!fileToEdit && sidecarPath) {
                            const newFile = await this.app.vault.create(sidecarPath, '');
                            fileToEdit = newFile instanceof TFile ? newFile : null;
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
                        let parsedVal: unknown = newValStr;
                        try {
                            // Try to parse JSON (e.g. arrays like ["tag1", "tag2"])
                            if (newValStr.startsWith('[') || newValStr.startsWith('{')) {
                                parsedVal = JSON.parse(newValStr);
                            } else if (newValStr === 'true') parsedVal = true;
                            else if (newValStr === 'false') parsedVal = false;
                            else if (!isNaN(Number(newValStr)) && newValStr !== '') parsedVal = Number(newValStr);
                        } catch (_err: unknown) {
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
                            const newFile = await this.app.vault.create(sidecarPath, '');
                            fileToEdit = newFile instanceof TFile ? newFile : null;
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
                            window.setTimeout(() => this.render(), 100);
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
                };
                doClick().catch(console.error);
            });
            }
        }

        const navContainerEl = this.sidebarEl.createDiv('spotlight-nav-container');
        
        const prevBtn = navContainerEl.createEl('button', { text: 'Previous', cls: 'spotlight-nav-btn' });
        prevBtn.disabled = this.currentIndex === 0;
        prevBtn.addEventListener('click', () => {
            this.currentIndex = Math.max(this.currentIndex - 1, 0);
            this.render();
        });

        const countEl = navContainerEl.createDiv('spotlight-count');
        countEl.setText(`Entry ${this.currentIndex + 1} of ${entries.length}`);

        const nextBtn = navContainerEl.createEl('button', { text: 'Next', cls: 'spotlight-nav-btn' });
        nextBtn.disabled = this.currentIndex === entries.length - 1;
        nextBtn.addEventListener('click', () => {
            this.currentIndex = Math.min(this.currentIndex + 1, entries.length - 1);
            this.render();
        });
    }

    private formatValue(val: unknown): string {
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
        this.activePdfBlobUrls.forEach(url => URL.revokeObjectURL(url));
        this.activePdfBlobUrls = [];

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
            this.app.vault.readBinary(file).then(buffer => {
                if (this.currentIndex !== renderIndex) return;
                const blob = new Blob([buffer], { type: 'application/pdf' });
                const url = URL.createObjectURL(blob);
                this.activePdfBlobUrls.push(url);
                containerEl.createEl('iframe', {
                    cls: 'spotlight-pdf-iframe',
                    attr: {
                        src: url,
                        type: 'application/pdf'
                    }
                });
            }).catch((_err: unknown) => {
                if (this.currentIndex !== renderIndex) return;
                containerEl.empty();
                containerEl.createEl('div', { text: `Could not load PDF content for ${file.name}.` });
            });
        } else {
            this.app.vault.cachedRead(file).then(content => {
                if (this.currentIndex !== renderIndex) return;

                // Pre-process content to avoid loading native Obsidian PDF embeds
                const codeBlocks: string[] = [];
                let modifiedContent = content.replace(/(```[\s\S]*?```|`[^`]*`)/g, (match) => {
                    codeBlocks.push(match);
                    return `__SPOTLIGHT_CODE_BLOCK_${codeBlocks.length - 1}__`;
                });

                modifiedContent = modifiedContent.replace(/!\[\[(.*?)\]\]/g, (match, p1) => {
                    const cleanSrc = p1.split('|')[0].split('#')[0];
                    if (cleanSrc.toLowerCase().endsWith('.pdf')) {
                        const heightMatch = p1.match(/height=(\d+)/);
                        const height = heightMatch ? heightMatch[1] : '800';
                        return `<div class="spotlight-pdf-placeholder" data-src="${p1}" style="height: ${height}px; width: 100%;"></div>`;
                    }
                    return match;
                });

                modifiedContent = modifiedContent.replace(/!\[(.*?)\]\((.*?)\)/g, (match, p1, p2) => {
                    const cleanSrc = p2.split('|')[0].split('#')[0];
                    if (cleanSrc.toLowerCase().endsWith('.pdf')) {
                        const heightMatch = p2.match(/height=(\d+)/);
                        const height = heightMatch ? heightMatch[1] : '800';
                        return `<div class="spotlight-pdf-placeholder" data-src="${p2}" style="height: ${height}px; width: 100%;"></div>`;
                    }
                    return match;
                });

                modifiedContent = modifiedContent.replace(/__SPOTLIGHT_CODE_BLOCK_(\d+)__/g, (match, p1) => {
                    return codeBlocks[parseInt(p1, 10)];
                });

                containerEl.empty();
                containerEl.addClass('markdown-rendered', 'markdown-preview-view');
                MarkdownRenderer.render(this.app, modifiedContent, containerEl, file.path, this).then(() => {
                    if (this.currentIndex !== renderIndex) return;
                    
                    const placeholders = containerEl.querySelectorAll('.spotlight-pdf-placeholder');
                    placeholders.forEach(placeholder => {
                        const src = placeholder.getAttribute('data-src');
                        if (!src) return;
                        
                        const cleanSrc = src.split('|')[0].split('#')[0];
                        const destFile = this.app.metadataCache.getFirstLinkpathDest(cleanSrc, file.path);
                        if (destFile instanceof TFile && destFile.extension.toLowerCase() === 'pdf') {
                            this.app.vault.readBinary(destFile).then(buffer => {
                                if (this.currentIndex !== renderIndex) return;
                                
                                const blob = new Blob([buffer], { type: 'application/pdf' });
                                const url = URL.createObjectURL(blob);
                                this.activePdfBlobUrls.push(url);
                                
                                placeholder.empty();
                                placeholder.createEl('iframe', {
                                    cls: 'spotlight-pdf-iframe',
                                    attr: {
                                        src: url,
                                        type: 'application/pdf'
                                    }
                                });
                            });
                        }
                    });
                });
            }).catch((_err: unknown) => {
                if (this.currentIndex !== renderIndex) return;
                containerEl.empty();
                containerEl.createEl('div', { text: `Could not load content for ${file.name}.` });
            });
        }
    }
}

export default class BasesSpotlightPlugin extends Plugin {
    settings: Spotlights;

    async onload() {
        await this.loads();

        this.registerBasesView('bases-spotlight-view', {
            name: "Spotlight View",
            icon: "presentation",
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
                } as BasesPropertyOption,
                {
                    type: 'property',
                    key: 'hyperlink_property',
                    displayName: 'Hyperlink Property',
                    // @ts-ignore
                    description: 'Select an attribute to display as a clickable link that opens the file'
                } as BasesPropertyOption
            ]
        });
    }

    onunload() {
        // Cleanup if necessary
    }

    async loads() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saves() {
        await this.saveData(this.settings);
    }
}
