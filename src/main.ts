import { getLanguage, Notice, normalizePath, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, mergeSettings, type InvoiceSyncSettings } from "./settings";
import { IndexStore } from "./core/index-store";
import { SyncService, type ProgressFn, type SyncReport } from "./core/sync";
import { InvoiceSyncSettingTab } from "./settings-tab";
import { InvoiceSyncView, VIEW_TYPE_INVOICE_SYNC } from "./ui/sidebar";
import { isReimbursed, toggleReimbursed } from "./core/status";
import { setLocale, t, tn } from "./i18n";

/** 启动后延迟多久再自动同步，避开 Obsidian 启动高峰。 */
const STARTUP_DELAY_MS = 15_000;

export default class InvoiceSyncPlugin extends Plugin {
  settings: InvoiceSyncSettings = DEFAULT_SETTINGS;
  index!: IndexStore;
  sync!: SyncService;
  private autoSyncTimer: number | null = null;
  private running: Promise<SyncReport> | null = null;

  async onload(): Promise<void> {
    // 界面语言跟随 Obsidian：中文用简体中文，其他用英文。写进 vault 的数据不受影响。
    setLocale(getLanguage());
    this.settings = mergeSettings(await this.loadData());
    this.index = new IndexStore(this.app, this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`);
    await this.index.load();
    this.sync = new SyncService(this.app, () => this.settings, this.index);

    this.registerView(VIEW_TYPE_INVOICE_SYNC, (leaf: WorkspaceLeaf) => new InvoiceSyncView(leaf, this));
    this.addSettingTab(new InvoiceSyncSettingTab(this.app, this));
    this.addRibbonIcon("receipt", t("ribbon.open"), () => void this.activateView());

    this.addCommand({ id: "open-panel", name: t("command.openPanel"), callback: () => void this.activateView() });
    this.addCommand({ id: "sync", name: t("command.sync"), callback: () => void this.runSyncWithNotice() });
    this.addCommand({ id: "open-base", name: t("command.openBase"), callback: () => void this.openBase() });
    this.addCommand({
      id: "toggle-current-invoice-status",
      name: t("command.toggleStatus"),
      checkCallback: (checking) => {
        const file = this.app.workspace.getActiveFile();
        if (!file || !this.isInvoice(file)) return false;
        if (!checking) void this.toggleInvoiceStatus(file.path, true);
        return true;
      },
    });
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (this.isInvoice(file)) this.refreshView();
    }));

    this.app.workspace.onLayoutReady(() => {
      void (async () => {
        await this.migrateReimbursementCheckbox();
        this.refreshView();
        this.rescheduleAutoSync();
        if (this.settings.syncOnStartup && this.sync.isConfigured()) {
          const t = window.setTimeout(() => void this.runSync(), STARTUP_DELAY_MS);
          this.register(() => window.clearTimeout(t));
        }
      })();
    });
  }

  onunload(): void {
    if (this.autoSyncTimer !== null) window.clearInterval(this.autoSyncTimer);
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  /** 同步入口；已在同步中就复用同一次，不并发。 */
  runSync(onProgress?: ProgressFn): Promise<SyncReport> {
    if (this.running) return this.running;
    this.running = (async () => {
      try {
        const report = await this.sync.sync(onProgress);
        if (report.errors.length === 0) {
          this.settings.lastSyncAt = new Date().toISOString();
          await this.saveSettings();
        }
        return report;
      } finally {
        this.running = null;
        this.refreshView();
      }
    })();
    return this.running;
  }

  private async runSyncWithNotice(): Promise<void> {
    const notice = new Notice(t("notice.syncing"), 0);
    const r = await this.runSync((p) => notice.setMessage(t("notice.syncProgress", { message: p.message })));
    notice.setMessage(
      r.errors.length > 0
        ? t("notice.syncFailed", { error: r.errors[0] ?? "" })
        : tn("notice.syncDone", r.created + r.imported) + (r.problems ? tn("notice.syncDoneProblems", r.problems) : ""),
    );
    window.setTimeout(() => notice.hide(), 6000);
  }

  rescheduleAutoSync(): void {
    if (this.autoSyncTimer !== null) {
      window.clearInterval(this.autoSyncTimer);
      this.autoSyncTimer = null;
    }
    if (!this.settings.autoSyncEnabled) return;
    const ms = Math.max(15, this.settings.autoSyncIntervalMinutes) * 60_000;
    this.autoSyncTimer = window.setInterval(() => {
      if (this.sync.isConfigured()) void this.runSync();
    }, ms);
    this.registerInterval(this.autoSyncTimer);
  }

  async activateView(): Promise<void> {
    const { workspace } = this.app;
    const existing = workspace.getLeavesOfType(VIEW_TYPE_INVOICE_SYNC)[0];
    if (existing) {
      await workspace.revealLeaf(existing);
      return;
    }
    const leaf = workspace.getRightLeaf(false);
    if (!leaf) return;
    await leaf.setViewState({ type: VIEW_TYPE_INVOICE_SYNC, active: true });
    await workspace.revealLeaf(leaf);
  }

  refreshView(): void {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_INVOICE_SYNC)) {
      if (leaf.view instanceof InvoiceSyncView) leaf.view.refresh();
    }
  }

  async openBase(): Promise<void> {
    await this.sync.ensureScaffold();
    const file = this.app.vault.getAbstractFileByPath(this.sync.basePath);
    if (file instanceof TFile) await this.app.workspace.getLeaf(false).openFile(file);
  }

  private isInvoice(file: TFile): boolean {
    const fm = this.app.metadataCache.getFileCache(file)?.frontmatter as { type?: string } | undefined;
    if (fm?.type === "invoice") return true;

    // metadataCache 在刚打开、刚改名或 iCloud 尚未完成刷新时可能暂时没有 frontmatter。
    // 发票笔记均由插件写入 rootFolder 的年月子目录，因此用路径作可靠后备判定；
    // 同时排除根目录里的 Bases 总表。
    const root = normalizePath(this.settings.rootFolder);
    return file.extension === "md"
      && file.path.startsWith(`${root}/`)
      && file.path !== this.sync.basePath;
  }

  /**
   * 在待报销与已报销之间一键切换。底层写入原生 Checkbox 布尔属性。
   * 返回新状态（true 为已报销）；路径不是发票笔记时返回 undefined。
   */
  async toggleInvoiceStatus(path: string, showNotice = false): Promise<boolean | undefined> {
    const file = this.app.vault.getFileByPath(path);
    if (!file || !this.isInvoice(file)) {
      if (showNotice) new Notice(t("notice.notInvoice"));
      return undefined;
    }
    let next = false;
    await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
      next = toggleReimbursed(fm.reimbursed, fm.status);
      fm.reimbursed = next;
      delete fm.status;
    });
    this.refreshView();
    // processFrontMatter 落盘早于 metadataCache 更新；稍后再刷新一次，避免面板短暂显示旧状态。
    window.setTimeout(() => this.refreshView(), 150);
    if (showNotice) new Notice(t(next ? "notice.markedReimbursed" : "notice.markedPending"));
    return next;
  }

  /**
   * 一次性把旧 status 文本迁移为 reimbursed Checkbox，并同步已有 Bases 配置。
   * 重复执行是幂等的，用户在机器区外写的其他内容不会被改动。
   */
  private async migrateReimbursementCheckbox(): Promise<void> {
    const typeManager = (this.app as unknown as {
      metadataTypeManager?: { setType(name: string, type: string): void };
    }).metadataTypeManager;
    try {
      typeManager?.setType("reimbursed", "checkbox");
    } catch {
      // 私有属性类型 API 在旧版 Obsidian 不可用时，布尔值仍会按 Checkbox 推断。
    }

    const prefix = `${normalizePath(this.settings.rootFolder)}/`;
    for (const file of this.app.vault.getMarkdownFiles()) {
      if (!file.path.startsWith(prefix)) continue;
      await this.app.fileManager.processFrontMatter(file, (fm: Record<string, unknown>) => {
        if (fm.type !== "invoice") return;
        if (typeof fm.reimbursed !== "boolean") {
          fm.reimbursed = isReimbursed(fm.reimbursed, fm.status);
        }
        delete fm.status;
      });
    }

    const base = this.app.vault.getFileByPath(this.sync.basePath);
    if (base) {
      await this.app.vault.process(base, (source) => source
        .replace(/\bnote\.status\b/g, "note.reimbursed")
        .replace(/^(\s*-\s*)status(\s*)$/gm, "$1reimbursed$2")
        .replace(/status\s*==\s*["']未报销["']/g, "reimbursed != true")
        .replace(/displayName:\s*报销状态/g, "displayName: 已报销"));
    }
  }

  openSettings(): void {
    // Obsidian 未在公开类型里暴露 setting，这里按运行时结构调用
    const app = this.app as unknown as { setting: { open(): void; openTabById(id: string): void } };
    app.setting.open();
    app.setting.openTabById(this.manifest.id);
  }
}
