import {
    Plugin,
    BasesView,
    BasesPropertyOption,
    MarkdownRenderer,
    QueryController,
    TFile
} from 'obsidian';

class SpotlightView extends BasesView {
    type = 'bases-spotlight-view';
    currentIndex = 0;
    sidebarVisible = true;
    sidebarWidth = 300;

    private centerEl: HTMLElement;
    private sidebarEl: HTMLElement;
    private isResizing = false;
    private containerEl: HTMLElement;

    constructor(controller: QueryController, containerEl: HTMLElement) {
        super(controller);
        
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
        if (!this.data || !this.data.data.length) return;
        
        if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
            this.currentIndex = Math.min(this.currentIndex + 1, this.data.data.length - 1);
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

        if (!this.data || !this.data.data || this.data.data.length === 0) {
            this.centerEl.createEl('div', { text: 'No entries found.', cls: 'spotlight-empty' });
            return;
        }

        // Clamp index
        if (this.currentIndex >= this.data.data.length) {
            this.currentIndex = this.data.data.length - 1;
        }
        if (this.currentIndex < 0) {
            this.currentIndex = 0;
        }

        const entry = this.data.data[this.currentIndex];

        // Render Spotlight Center
        const spotlightProperty = this.config.get('spotlight_property') as string | undefined;
        const centerContentEl = this.centerEl.createDiv('spotlight-center-content');
        
        if (spotlightProperty && spotlightProperty !== '') {
            this.centerEl.removeClass('spotlight-center-no-padding');
            // Display property content
            const propValue = entry.getValue(spotlightProperty as any);
            const valueStr = this.formatValue(propValue);
            centerContentEl.createEl('div', { text: valueStr, cls: 'spotlight-attribute-content' });
        } else {
            // Display page content
            let file = entry.file;
            if (file instanceof TFile) {
                // If it's a sidecar (e.g. image.png.md), display the original file instead
                const sidecarMatch = file.name.match(/^(.*\.(png|jpg|jpeg|gif|bmp|svg|webp|pdf))\.md$/i);
                if (sidecarMatch) {
                    const originalPath = file.path.slice(0, -3);
                    const originalFile = this.app.vault.getAbstractFileByPath(originalPath);
                    if (originalFile instanceof TFile) {
                        file = originalFile;
                    }
                }

                const renderIndex = this.currentIndex;
                const ext = file.extension.toLowerCase();
                const imageExtensions = ['png', 'jpg', 'jpeg', 'gif', 'bmp', 'svg', 'webp'];
                
                if (imageExtensions.includes(ext) || ext === 'pdf') {
                    this.centerEl.addClass('spotlight-center-no-padding');
                } else {
                    this.centerEl.removeClass('spotlight-center-no-padding');
                }

                if (imageExtensions.includes(ext)) {
                    centerContentEl.empty();
                    centerContentEl.addClass('spotlight-center-media-container');
                    const resourcePath = this.app.vault.getResourcePath(file);
                    centerContentEl.createEl('img', { attr: { src: resourcePath }, cls: 'spotlight-media' });
                } else if (ext === 'pdf') {
                    centerContentEl.empty();
                    centerContentEl.addClass('spotlight-center-pdf-container');
                    const resourcePath = this.app.vault.getResourcePath(file);
                    const iframe = centerContentEl.createEl('iframe', {
                        cls: 'spotlight-pdf-iframe',
                        attr: {
                            src: resourcePath,
                            type: 'application/pdf',
                        }
                    });
                } else {
                    this.app.vault.cachedRead(file).then(content => {
                        if (this.currentIndex !== renderIndex) return;
                        centerContentEl.empty();
                        centerContentEl.addClass('markdown-rendered', 'markdown-preview-view');
                        MarkdownRenderer.render(this.app, content, centerContentEl, file.path, this);
                    }).catch(err => {
                        if (this.currentIndex !== renderIndex) return;
                        centerContentEl.empty();
                        centerContentEl.createEl('div', { text: `Could not load content for ${file.name}.` });
                    });
                }
            } else {
                centerContentEl.createEl('div', { text: 'Cannot read file content.' });
            }
        }

        // Render Sidebar
        this.sidebarEl.style.width = `${this.sidebarWidth}px`;
        const sidebarTitle = this.sidebarEl.createEl('h3', { text: 'Attributes' });
        sidebarTitle.addClass('spotlight-sidebar-title');

        const properties = this.data.properties || [];

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
            propEl.createDiv({ text: this.getPropName(prop), cls: 'spotlight-property-name' });
            
            const valContainerEl = propEl.createDiv({ cls: 'spotlight-property-value-container' });
            const valEl = valContainerEl.createDiv({ cls: 'spotlight-property-value spotlight-scrollable-text' });
            
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
                    
                    // Determine which file to edit
                    let fileToEdit = entry.file as TFile;
                    if (fileToEdit.extension !== 'md') {
                        const sidecarPath = fileToEdit.path + '.md';
                        let sidecar = this.app.vault.getAbstractFileByPath(sidecarPath);
                        if (!sidecar) {
                            sidecar = await this.app.vault.create(sidecarPath, '');
                        }
                        fileToEdit = sidecar as TFile;
                    }

                    const cache = this.app.metadataCache.getFileCache(fileToEdit);
                    const rawValue = cache?.frontmatter?.[propName];
                    
                    // Use Obsidian's internal type manager if available to detect checkbox properties
                    const typeManager = (this.app as any).metadataTypeManager;
                    const propType = typeManager?.getPropertyInfo?.(propName)?.type;
                    const isCheckbox = propType === 'checkbox' || typeof rawValue === 'boolean';

                    if (isCheckbox) {
                        this.app.fileManager.processFrontMatter(fileToEdit, (fm) => {
                            fm[propName] = !rawValue;
                        });
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

                        await this.app.fileManager.processFrontMatter(fileToEdit, (fm) => {
                            if (newValStr === '') {
                                delete fm[propName];
                            } else {
                                fm[propName] = parsedVal;
                            }
                        });
                        
                        // Force rerender if we created/edited a sidecar manually, as Bases might not react to it if the base query is for the binary file
                        if (fileToEdit !== entry.file) {
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
        countEl.setText(`Entry ${this.currentIndex + 1} of ${this.data.data.length}`);
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
}

export default class BasesSpotlightPlugin extends Plugin {
    async onload() {
        this.registerBasesView('bases-spotlight-view', {
            name: "Spotlight View",
            factory: (controller: QueryController, containerEl: HTMLElement) => {
                const view = new SpotlightView(controller, containerEl);
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
}
