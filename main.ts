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
            // Display property content
            const propValue = entry.getValue(spotlightProperty as any);
            const valueStr = this.formatValue(propValue);
            centerContentEl.createEl('div', { text: valueStr, cls: 'spotlight-attribute-content' });
        } else {
            // Display page content
            const file = entry.file;
            if (file instanceof TFile) {
                const renderIndex = this.currentIndex;
                this.app.vault.cachedRead(file).then(content => {
                    if (this.currentIndex !== renderIndex) return;
                    centerContentEl.empty();
                    MarkdownRenderer.render(this.app, content, centerContentEl, file.path, this);
                });
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
            const valStr = this.formatValue(val);
            
            const propEl = this.sidebarEl.createDiv('spotlight-property');
            propEl.createDiv({ text: this.getPropName(prop), cls: 'spotlight-property-name' });
            const valEl = propEl.createDiv({ text: valStr, cls: 'spotlight-property-value' });
            // Allow long text to scroll within the value box
            valEl.addClass('spotlight-scrollable-text');
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
