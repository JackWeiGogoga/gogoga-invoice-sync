import { Notice, Plugin, TFile, WorkspaceLeaf } from "obsidian";
import { DEFAULT_SETTINGS, mergeSettings, type InvoiceSyncSettings } from "./settings";
import { IndexStore } from "./core/index-store";
import { SyncService, type ProgressFn, type SyncReport } from "./core/sync";
import { InvoiceSyncSettingTab } from "./settings-tab";
import { InvoiceSyncView, VIEW_TYPE_INVOICE_SYNC } from "./ui/sidebar";

/** 启动后延迟多久再自动同步，避开 Obsidian 启动高峰。 */
const STARTUP_DELAY_MS = 15_000;

export default class InvoiceSyncPlugin extends Plugin {
  settings: InvoiceSyncSettings = DEFAULT_SETTINGS;
  index!: IndexStore;
  sync!: SyncService;
  private autoSyncTimer: number | null = null;
  private running: Promise<SyncReport> | null = null;

  async onload(): Promise<void> {
    this.settings = mergeSettings(await this.loadData());
    this.index = new IndexStore(this.app, this.manifest.dir ?? `.obsidian/plugins/${this.manifest.id}`);
    await this.index.load();
    this.sync = new SyncService(this.app, () => this.settings, this.index);

    this.registerView(VIEW_TYPE_INVOICE_SYNC, (leaf: WorkspaceLeaf) => new InvoiceSyncView(leaf, this));
    this.addSettingTab(new InvoiceSyncSettingTab(this.app, this));
    this.addRibbonIcon("receipt", "发票", () => void this.activateView());

    this.addCommand({ id: "open-panel", name: "打开发票面板", callback: () => void this.activateView() });
    this.addCommand({ id: "sync", name: "同步发票邮箱", callback: () => void this.runSyncWithNotice() });
    this.addCommand({ id: "open-base", name: "打开发票总表", callback: () => void this.openBase() });

    this.app.workspace.onLayoutReady(() => {
      this.rescheduleAutoSync();
      if (this.settings.syncOnStartup && this.sync.isConfigured()) {
        const t = window.setTimeout(() => void this.runSync(), STARTUP_DELAY_MS);
        this.register(() => window.clearTimeout(t));
      }
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
    const notice = new Notice("发票同步中…", 0);
    const r = await this.runSync((p) => notice.setMessage(`发票同步：${p.message}`));
    notice.setMessage(
      r.errors.length > 0
        ? `发票同步失败：${r.errors[0]}`
        : `发票同步完成：新增 ${r.created + r.imported} 张${r.problems ? `，${r.problems} 个待处理` : ""}`,
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

  openSettings(): void {
    // Obsidian 未在公开类型里暴露 setting，这里按运行时结构调用
    const app = this.app as unknown as { setting: { open(): void; openTabById(id: string): void } };
    app.setting.open();
    app.setting.openTabById(this.manifest.id);
  }
}
