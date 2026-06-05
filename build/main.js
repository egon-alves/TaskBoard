"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const obsidian_1 = require("obsidian");
const VIEW_TYPE_HOME_DASHBOARD = "home-dashboard-view";
const STATUS_CYCLE = ["#Novo", "#EmAndamento", "#Finalizado"];
const STATUS_COLOR = {
    "#Novo": "var(--color-base-40)",
    "#EmAndamento": "var(--color-yellow)",
    "#Finalizado": "var(--color-green)",
};
const CARD_TYPES = [
    { value: "atividade", label: "Atividade" },
    { value: "anotacao", label: "Anotação" },
    { value: "documentacao", label: "Documentação" },
];
// =========================
// PLUGIN
// =========================
class FolderDashboardPlugin extends obsidian_1.Plugin {
    async onload() {
        this.registerView(VIEW_TYPE_HOME_DASHBOARD, (leaf) => new HomeDashboardView(leaf));
        this.addRibbonIcon("home", "Dashboard", () => this.activateView());
    }
    async activateView() {
        const { workspace } = this.app;
        let leaf = workspace.getLeavesOfType(VIEW_TYPE_HOME_DASHBOARD)[0];
        if (!leaf) {
            leaf = workspace.getLeaf("tab");
            await leaf.setViewState({ type: VIEW_TYPE_HOME_DASHBOARD, active: true });
        }
        workspace.revealLeaf(leaf);
    }
}
exports.default = FolderDashboardPlugin;
// =========================
// MODAL — NOVO CARD
// =========================
class NewCardModal extends obsidian_1.Modal {
    filename = "Nova nota";
    targetFolder;
    date;
    cardType = "atividade";
    onSubmit;
    constructor(app, defaultFolder, onSubmit) {
        super(app);
        this.targetFolder = defaultFolder;
        this.date = new Date().toISOString().slice(0, 10);
        this.onSubmit = onSubmit;
    }
    onOpen() {
        const { contentEl } = this;
        contentEl.style.cssText = "display:flex;flex-direction:column;gap:12px;padding:8px;";
        contentEl.createEl("h2", { text: "Novo Card", attr: { style: "margin:0;font-size:16px;" } });
        // ── Nome ──
        this.field(contentEl, "Nome");
        const nameInput = contentEl.createEl("input", {
            attr: { type: "text", placeholder: "Nome do arquivo...", value: this.filename },
        });
        nameInput.style.cssText = "width:100%;padding:6px 10px;border-radius:6px;font-size:13px;";
        nameInput.oninput = (e) => { this.filename = e.target.value; };
        setTimeout(() => nameInput.select(), 50);
        // ── Tipo ──
        this.field(contentEl, "Tipo");
        const typeRow = contentEl.createDiv({ attr: { style: "display:flex;gap:6px;" } });
        const updateTypeButtons = () => {
            typeRow.querySelectorAll("button").forEach((b) => {
                const btn = b;
                const isActive = btn.dataset.type === this.cardType;
                btn.style.background = isActive ? "var(--interactive-accent)" : "transparent";
                btn.style.color = isActive ? "#fff" : "var(--text-muted)";
            });
        };
        CARD_TYPES.forEach(({ value, label }) => {
            const btn = typeRow.createEl("button", { text: label });
            btn.dataset.type = value;
            btn.style.cssText =
                "flex:1;padding:5px 0;border-radius:6px;font-size:12px;cursor:pointer;" +
                    `border:1px solid var(--background-modifier-border);` +
                    `background:${value === this.cardType ? "var(--interactive-accent)" : "transparent"};` +
                    `color:${value === this.cardType ? "#fff" : "var(--text-muted)"};`;
            btn.onclick = () => { this.cardType = value; updateTypeButtons(); };
        });
        // ── Data ──
        this.field(contentEl, "Data");
        const dateInput = contentEl.createEl("input", {
            attr: { type: "date", value: this.date },
        });
        dateInput.style.cssText = "width:100%;padding:6px 10px;border-radius:6px;font-size:13px;";
        dateInput.onchange = (e) => { this.date = e.target.value; };
        // ── Pasta ──
        this.field(contentEl, "Salvar em");
        const select = contentEl.createEl("select");
        select.style.cssText = "width:100%;padding:6px;border-radius:6px;font-size:13px;";
        this.app.vault.getAllFolders()
            .sort((a, b) => a.path.localeCompare(b.path))
            .forEach((folder) => {
            const opt = select.createEl("option", { text: folder.path || "/", value: folder.path });
            if (folder.path === this.targetFolder)
                opt.selected = true;
        });
        select.onchange = (e) => { this.targetFolder = e.target.value; };
        // ── Ações ──
        const actions = contentEl.createDiv({
            attr: { style: "display:flex;justify-content:flex-end;gap:8px;margin-top:4px;" },
        });
        actions.createEl("button", { text: "Cancelar" }).onclick = () => this.close();
        const createBtn = actions.createEl("button", { text: "Criar" });
        createBtn.style.cssText = "font-weight:600;";
        createBtn.onclick = () => {
            if (this.filename.trim()) {
                this.onSubmit(this.filename.trim(), this.targetFolder, this.date, this.cardType);
                this.close();
            }
        };
        nameInput.onkeydown = (e) => {
            if (e.key === "Enter")
                createBtn.click();
            if (e.key === "Escape")
                this.close();
        };
    }
    field(parent, label) {
        parent.createEl("label", {
            text: label,
            attr: { style: "font-size:11px;color:var(--text-muted);margin-bottom:-6px;" },
        });
    }
    onClose() { this.contentEl.empty(); }
}
// =========================
// VIEW
// =========================
class HomeDashboardView extends obsidian_1.ItemView {
    selectedFolder = null;
    ignoreFolders = new Set(["Resources"]);
    showFinalized = false;
    hideTasks = false;
    searchQuery = "";
    searchDebounce = null;
    constructor(leaf) {
        super(leaf);
    }
    getViewType() { return VIEW_TYPE_HOME_DASHBOARD; }
    getDisplayText() { return "Dashboard"; }
    getIcon() { return "home"; }
    async onOpen() { this.render(); }
    async onClose() { }
    // =========================
    // DATA
    // =========================
    getRootFolders() {
        return this.app.vault.getRoot().children
            .filter((f) => f.children)
            .map((f) => f.name)
            .filter((name) => !this.ignoreFolders.has(name));
    }
    getFilesFromFolder(folder) {
        return this.app.vault.getFiles().filter((f) => f.path.startsWith(folder + "/"));
    }
    fileIsRelevant(file) {
        const cache = this.app.metadataCache.getFileCache(file);
        if (!cache)
            return false;
        const tags = cache.tags?.map((t) => t.tag) ?? [];
        const hasTaskTag = tags.includes("#Task");
        const hasOpenCheckbox = cache.listItems?.some((item) => item.task === " ") ?? false;
        return hasTaskTag || hasOpenCheckbox;
    }
    getStatus(file) {
        const cache = this.app.metadataCache.getFileCache(file);
        const tags = cache?.tags?.map((t) => t.tag) ?? [];
        return STATUS_CYCLE.find((s) => tags.includes(s)) ?? "#Novo";
    }
    countOpenTasks(file) {
        const cache = this.app.metadataCache.getFileCache(file);
        return cache?.listItems?.filter((item) => item.task === " ").length ?? 0;
    }
    extractOpenTasks(content) {
        return content
            .split("\n")
            .filter((line) => /- \[ \]/.test(line))
            .map((line) => line.replace(/^\s*- \[ \]\s*/, "").trim());
    }
    getUntitledFiles() {
        return this.app.vault.getFiles().filter((f) => /sem.?t[ií]tulo/i.test(f.basename));
    }
    formatDate(timestamp) {
        return new Date(timestamp).toLocaleDateString("pt-BR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        });
    }
    getFilteredFiles() {
        const roots = this.getRootFolders();
        // "Todos" (null) → agrega todas as pastas raiz
        const allFiles = this.selectedFolder
            ? this.getFilesFromFolder(this.selectedFolder)
            : roots.flatMap((f) => this.getFilesFromFolder(f));
        let files = allFiles.filter((file) => {
            if (!this.fileIsRelevant(file))
                return false;
            const status = this.getStatus(file);
            if (!this.showFinalized && status === "#Finalizado")
                return false;
            return true;
        });
        if (this.searchQuery.trim()) {
            const q = this.searchQuery.toLowerCase();
            files = files.filter((f) => f.basename.toLowerCase().includes(q));
        }
        return files;
    }
    async cycleStatus(file) {
        const content = await this.app.vault.read(file);
        const current = this.getStatus(file);
        const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(current) + 1) % STATUS_CYCLE.length];
        const updated = content.includes(current)
            ? content.replace(current, next)
            : `${next}\n\n${content}`;
        await this.app.vault.modify(file, updated);
        const onCacheChange = (changedFile) => {
            if (changedFile.path === file.path) {
                this.app.metadataCache.off("changed", onCacheChange);
                this.render();
            }
        };
        this.app.metadataCache.on("changed", onCacheChange);
    }
    async createNewCard(filename, folder, date, type) {
        const path = folder ? `${folder}/${filename}.md` : `${filename}.md`;
        const templates = {
            atividade: `#Novo #Task\n\nData:: ${date}\n\n--- \n\n## Tarefas\n\n- [ ] \n`,
            anotacao: `#Novo\n\nData:: ${date}\n\n---\n\n## Notas\n\n`,
            documentacao: `#Novo\n\nData:: ${date}\n\n---\n\n## Descrição\n\n## Procedimento\n\n## Referências\n`,
        };
        try {
            const file = await this.app.vault.create(path, templates[type]);
            await this.app.workspace.getLeaf("tab").openFile(file);
            this.render();
        }
        catch (e) {
            console.error("Erro ao criar arquivo:", e);
        }
    }
    // =========================
    // UI
    // =========================
    render() {
        const container = this.contentEl;
        container.empty();
        container.style.cssText = "display:flex;flex-direction:column;gap:8px;padding:10px;";
        const files = this.getFilteredFiles();
        const totalTasks = files.reduce((sum, f) => sum + this.countOpenTasks(f), 0);
        this.renderTopBar(container, files.length, totalTasks);
        this.renderFolderBar(container);
        this.renderCards(container, files);
    }
    renderTopBar(container, fileCount, taskCount) {
        const bar = container.createDiv({
            attr: {
                style: "display:flex;align-items:center;gap:8px;" +
                    "background:var(--background-secondary);border-radius:8px;" +
                    "padding:6px 10px;border:1px solid var(--background-modifier-border);",
            },
        });
        // Ícone + título
        bar.createEl("span", { text: "🏠" });
        bar.createEl("span", {
            text: "Home Dashboard",
            attr: { style: "font-size:13px;font-weight:600;white-space:nowrap;" },
        });
        // Botão refresh
        const refreshBtn = bar.createEl("button", { text: "↻" });
        refreshBtn.title = "Atualizar";
        refreshBtn.style.cssText =
            "font-size:14px;padding:1px 5px;cursor:pointer;border-radius:5px;" +
                "border:none;background:transparent;color:var(--text-muted);line-height:1;";
        refreshBtn.onclick = () => this.render();
        // Separador
        bar.createEl("span", {
            attr: { style: "width:1px;height:14px;background:var(--background-modifier-border);flex-shrink:0;" },
        });
        // Contador
        bar.createEl("span", {
            text: `${fileCount} Nota${fileCount !== 1 ? "s" : ""} | ${taskCount} Tarefa${taskCount !== 1 ? "s" : ""} Abertas`,
            attr: { style: "font-size:11px;color:var(--text-muted);white-space:nowrap;" },
        });
        // Busca
        const search = bar.createEl("input", {
            attr: { type: "text", placeholder: "Buscar notas...", value: this.searchQuery },
        });
        search.style.cssText =
            "flex:1;padding:3px 8px;border-radius:5px;font-size:12px;" +
                "border:1px solid var(--background-modifier-border);background:var(--background-primary);";
        search.oninput = (e) => {
            this.searchQuery = e.target.value;
            if (this.searchDebounce)
                clearTimeout(this.searchDebounce);
            this.searchDebounce = setTimeout(() => this.render(), 250);
        };
        // Warning "Sem título" — inline e compacto
        const untitled = this.getUntitledFiles();
        if (untitled.length > 0) {
            const warn = bar.createEl("span", {
                text: `⚠ Sem título (${untitled.length})`,
                attr: {
                    title: untitled.map((f) => f.path).join("\n"),
                    style: "font-size:11px;color:var(--text-warning);cursor:pointer;white-space:nowrap;" +
                        "padding:2px 6px;border-radius:4px;background:var(--background-modifier-error);",
                },
            });
            let idx = 0;
            warn.onclick = () => {
                this.app.workspace.getLeaf("tab").openFile(untitled[idx % untitled.length]);
                idx++;
            };
        }
        // Spacer
        bar.createEl("span", { attr: { style: "flex:1;" } });
        // Novo Card
        const newCardBtn = bar.createEl("button", { text: "+ Novo Card" });
        newCardBtn.style.cssText =
            "font-size:11px;padding:3px 8px;cursor:pointer;border-radius:5px;" +
                "border:1px solid var(--background-modifier-border);background:transparent;color:var(--text-muted);";
        newCardBtn.onclick = () => {
            new NewCardModal(this.app, this.selectedFolder ?? "", (filename, folder, date, type) => this.createNewCard(filename, folder, date, type)).open();
        };
        // Hide tasks toggle
        const toggleWrap = bar.createDiv({
            attr: { style: "display:flex;align-items:center;gap:4px;cursor:pointer;" },
        });
        toggleWrap.createEl("span", {
            text: "Hide tasks",
            attr: { style: "font-size:11px;color:var(--text-muted);" },
        });
        const toggle = toggleWrap.createEl("div");
        toggle.style.cssText =
            `width:28px;height:16px;border-radius:8px;position:relative;` +
                `background:${this.hideTasks ? "var(--interactive-accent)" : "var(--background-modifier-border)"};`;
        const thumb = toggle.createEl("div");
        thumb.style.cssText =
            `width:12px;height:12px;border-radius:50%;background:#fff;position:absolute;top:2px;` +
                `left:${this.hideTasks ? "14px" : "2px"};`;
        toggleWrap.onclick = () => { this.hideTasks = !this.hideTasks; this.render(); };
        // #Finalizado chip
        const finalChip = bar.createEl("span", {
            text: "#Finalizado",
            attr: {
                style: `font-size:11px;padding:2px 8px;border-radius:10px;cursor:pointer;` +
                    `background:${this.showFinalized ? "var(--interactive-accent)" : "var(--background-modifier-border)"};` +
                    `color:${this.showFinalized ? "#fff" : "var(--text-muted)"};`,
            },
        });
        finalChip.onclick = () => { this.showFinalized = !this.showFinalized; this.render(); };
    }
    renderFolderBar(container) {
        const bar = container.createDiv({ attr: { style: "display:flex;gap:6px;flex-wrap:wrap;" } });
        const folders = ["Todos", ...this.getRootFolders()];
        folders.forEach((folder) => {
            const label = folder === "Todos"
                ? "Todos"
                : (folder.length > 18 ? folder.slice(0, 18) + "…" : folder);
            const btn = bar.createEl("button", { text: label });
            const isActive = (folder === "Todos" && this.selectedFolder === null) ||
                this.selectedFolder === folder;
            btn.style.cssText =
                `padding:4px 10px;cursor:pointer;border-radius:6px;font-size:12px;` +
                    `border:1px solid var(--background-modifier-border);` +
                    `background:${isActive ? "var(--interactive-accent)" : "transparent"};` +
                    `color:${isActive ? "#fff" : "var(--text-normal)"};`;
            btn.onclick = () => {
                this.selectedFolder = folder === "Todos" ? null : folder;
                this.render();
            };
        });
    }
    renderCards(container, files) {
        const grid = container.createDiv({
            attr: {
                style: "display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:10px;",
            },
        });
        if (files.length === 0) {
            grid.createEl("p", { text: "Nenhuma tarefa encontrada", attr: { style: "color:var(--text-muted);" } });
            return;
        }
        files.forEach((file) => {
            const status = this.getStatus(file);
            const taskCount = this.countOpenTasks(file);
            const card = grid.createDiv({
                attr: {
                    style: "border:1px solid var(--background-modifier-border);border-radius:8px;" +
                        "padding:10px;display:flex;flex-direction:column;gap:6px;cursor:pointer;" +
                        "background:var(--background-primary);",
                },
            });
            // ── Header ──
            const header = card.createDiv({
                attr: { style: "display:flex;justify-content:space-between;align-items:center;gap:6px;" },
            });
            header.createEl("span", {
                text: file.basename.length > 28 ? file.basename.slice(0, 28) + "…" : file.basename,
                attr: { style: "font-size:13px;font-weight:600;flex:1;overflow:hidden;" },
            });
            const right = header.createDiv({ attr: { style: "display:flex;align-items:center;gap:4px;" } });
            if (taskCount > 0) {
                right.createEl("span", {
                    text: String(taskCount),
                    attr: {
                        style: "font-size:11px;padding:1px 6px;border-radius:10px;" +
                            "background:var(--background-modifier-border);color:var(--text-muted);",
                    },
                });
            }
            const statusBtn = right.createEl("button", { text: status.replace("#", "") });
            statusBtn.style.cssText =
                `font-size:11px;padding:2px 7px;cursor:pointer;border-radius:10px;border:none;` +
                    `background:${STATUS_COLOR[status]};color:#fff;`;
            statusBtn.title = "Avançar status";
            statusBtn.onclick = async (e) => { e.stopPropagation(); await this.cycleStatus(file); };
            // ── Data de modificação ──
            card.createEl("span", {
                text: this.formatDate(file.stat.mtime),
                attr: { style: "font-size:11px;color:var(--text-faint);" },
            });
            // ── Lista de tasks ──
            if (!this.hideTasks) {
                this.app.vault.read(file).then((text) => {
                    const tasks = this.extractOpenTasks(text);
                    if (tasks.length > 0) {
                        const list = card.createEl("ul", { attr: { style: "margin:0;padding-left:14px;" } });
                        tasks.slice(0, 5).forEach((task) => list.createEl("li", { text: task, attr: { style: "font-size:12px;" } }));
                        if (tasks.length > 5)
                            card.createEl("small", {
                                text: `+${tasks.length - 5} mais…`,
                                attr: { style: "color:var(--text-muted);" },
                            });
                    }
                    else {
                        card.createEl("small", {
                            text: "Sem checkboxes abertos",
                            attr: { style: "color:var(--text-faint);" },
                        });
                    }
                });
            }
            card.onclick = () => this.app.workspace.getLeaf("tab").openFile(file);
        });
    }
}
