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
            const file = entry.file;
            if (file instanceof TFile) {
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
                    centerContentEl.addClass('spotlight-center-pdf-container', 'markdown-rendered');
                    MarkdownRenderer.render(this.app, `![[${file.path}]]`, centerContentEl, file.path, this);
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
        for (const prop of properties) {
            const val = entry.getValue(prop);
            
            const propEl = this.sidebarEl.createDiv('spotlight-property');
            propEl.createDiv({ text: this.getPropName(prop), cls: 'spotlight-property-name' });
            
            const valContainerEl = propEl.createDiv({ cls: 'spotlight-property-value-container' });
            const valEl = valContainerEl.createDiv({ cls: 'spotlight-property-value spotlight-scrollable-text' });
            
            if (val && typeof (val as any).renderTo === 'function') {
                (val as any).renderTo(valEl, this.app.renderContext);
            } else {
                valEl.setText(this.formatValue(val));
            }

            // Editable logic
            if (prop.startsWith('note.') && entry.file instanceof TFile) {
                valContainerEl.title = "Double click to edit";
                valContainerEl.addEventListener('dblclick', () => {
                    const propName = prop.substring(5);
                    const cache = this.app.metadataCache.getFileCache(entry.file as TFile);
                    const rawValue = cache?.frontmatter?.[propName];
                    
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
                        } catch (e) {
                            // Keep as string
                        }

                        await this.app.fileManager.processFrontMatter(entry.file as TFile, (fm) => {
                            if (newValStr === '') {
                                delete fm[propName];
                            } else {
                                fm[propName] = parsedVal;
                            }
                        });
                        // Base will naturally fire onDataUpdated when frontmatter changes!
                    };

                    inputEl.addEventListener('blur', save);
                    inputEl.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' && !e.shiftKey) {
                            e.preventDefault();
                            inputEl.blur(); // Triggers save
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
