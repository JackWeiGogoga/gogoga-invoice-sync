/**
 * 侧边栏：只放「需要你看一眼」的东西——同步按钮、概况、待处理队列、最近几张。
 * 完整列表交给 Bases 总表。
 */
import { ItemView, Notice, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import type InvoiceSyncPlugin from "../main";
import type { QueueItem } from "../core/index-store";
import type { ProblemReason } from "../core/pipeline";
import type { SyncProgress, SyncReport } from "../core/sync";
import { reimbursementLabel } from "../core/status";
import { t, tn } from "../i18n";

export const VIEW_TYPE_INVOICE_SYNC = "invoice-sync-view";

/** 用时再查，界面语言在插件加载时才确定。未知原因（旧版本写入的索引）原样显示。 */
function reasonLabel(reason: ProblemReason): string {
  const known: readonly ProblemReason[] = [
    "no-xml", "link-failed", "xml-invalid", "unmatched-files", "amount-mismatch", "buyer-mismatch", "import-failed",
  ];
  return known.includes(reason) ? t(`reason.${reason}`) : reason;
}

function yuan(v: number): string {
  return `¥${v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function relTime(iso?: string): string {
  if (!iso) return t("view.neverSynced");
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(min)) return "—";
  if (min < 1) return t("view.justSynced");
  if (min < 60) return tn("view.syncedMinutes", min);
  const h = Math.floor(min / 60);
  return h < 24 ? tn("view.syncedHours", h) : tn("view.syncedDays", Math.floor(h / 24));
}

export class InvoiceSyncView extends ItemView {
  private statusEl!: HTMLElement;
  private barWrapEl!: HTMLElement;
  private barEl!: HTMLElement;
  private bodyEl!: HTMLElement;
  private syncBtn!: HTMLButtonElement;
  private busy = false;

  constructor(
    leaf: WorkspaceLeaf,
    private readonly plugin: InvoiceSyncPlugin,
  ) {
    super(leaf);
  }

  getViewType(): string {
    return VIEW_TYPE_INVOICE_SYNC;
  }

  getDisplayText(): string {
    return t("view.title");
  }

  getIcon(): string {
    return "receipt";
  }

  async onOpen(): Promise<void> {
    this.renderShell();
    this.renderBody();
    // 你在属性里改了报销状态，概况跟着变
    const refresh = debounce(() => this.renderBody(), 500, true);
    this.registerEvent(this.app.metadataCache.on("changed", (file) => {
      if (file.path.startsWith(`${this.plugin.settings.rootFolder}/`)) refresh();
    }));
  }

  /** 外部（自动同步、设置变更）触发的刷新。 */
  refresh(): void {
    if (this.bodyEl) this.renderBody();
  }

  private renderShell(): void {
    const root = this.contentEl;
    root.empty();
    root.addClass("invoice-sync-view");

    const header = root.createDiv({ cls: "invoice-sync-header" });
    header.createEl("h3", { text: t("view.title"), cls: "invoice-sync-title" });
    const actions = header.createDiv({ cls: "invoice-sync-header-actions" });
    const baseBtn = actions.createEl("button", { cls: "invoice-sync-icon-btn", attr: { "aria-label": t("command.openBase") } });
    setIcon(baseBtn, "table");
    baseBtn.onclick = () => void this.plugin.openBase();
    const settingsBtn = actions.createEl("button", { cls: "invoice-sync-icon-btn", attr: { "aria-label": t("view.settings") } });
    setIcon(settingsBtn, "settings");
    settingsBtn.onclick = () => this.plugin.openSettings();

    this.syncBtn = root.createEl("button", { text: t("view.sync"), cls: "invoice-sync-primary" });
    this.syncBtn.onclick = () => void this.runSync();

    this.statusEl = root.createDiv({ cls: "invoice-sync-status" });
    this.barWrapEl = root.createDiv({ cls: "invoice-sync-bar-wrap" });
    this.barEl = this.barWrapEl.createDiv({ cls: "invoice-sync-bar" });
    this.barWrapEl.hide();

    this.bodyEl = root.createDiv({ cls: "invoice-sync-body" });
  }

  private renderBody(): void {
    const el = this.bodyEl;
    el.empty();
    if (!this.busy) this.statusEl.setText(relTime(this.plugin.settings.lastSyncAt));

    if (!this.plugin.sync.isConfigured()) {
      const setup = el.createDiv({ cls: "invoice-sync-setup" });
      setup.createDiv({ text: t("view.setupTitle"), cls: "invoice-sync-setup-title" });
      setup.createDiv({ text: t("view.setupDesc"), cls: "invoice-sync-muted" });
      const go = setup.createEl("button", { text: t("view.goToSettings") });
      go.onclick = () => this.plugin.openSettings();
    }

    // 概况
    const st = this.plugin.sync.stats();
    const tiles = el.createDiv({ cls: "invoice-sync-tiles" });
    const tile = (label: string, count: number, total: number, cls = "") => {
      const card = tiles.createDiv({ cls: `invoice-sync-tile ${cls}` });
      card.createDiv({ text: label, cls: "invoice-sync-tile-label" });
      // 卡片太窄放不下分，取整显示，悬停看精确值
      card.createDiv({ text: `¥${Math.round(total).toLocaleString("zh-CN")}`, cls: "invoice-sync-tile-value", attr: { title: yuan(total) } });
      card.createDiv({ text: tn("view.tileCount", count), cls: "invoice-sync-tile-sub" });
    };
    tile(t("view.tileUnreimbursed"), st.unreimbursed, st.unreimbursedTotal, st.unreimbursed > 0 ? "is-accent" : "");
    tile(t("view.tileThisMonth"), st.thisMonth, st.thisMonthTotal);
    tile(t("view.tileAll"), st.count, st.total);

    // 待处理
    const queue = this.plugin.index.queue;
    if (queue.length > 0) {
      const sec = el.createDiv({ cls: "invoice-sync-section" });
      sec.createDiv({ text: t("view.queueTitle", { n: queue.length }), cls: "invoice-sync-section-title" });
      for (const item of queue) this.renderQueueItem(sec, item);
    }

    // 最近
    const recent = this.plugin.sync.recent();
    if (recent.length > 0) {
      const sec = el.createDiv({ cls: "invoice-sync-section" });
      sec.createDiv({ text: t("view.recent"), cls: "invoice-sync-section-title" });
      for (const r of recent) {
        const row = sec.createDiv({ cls: "invoice-sync-row" });
        const main = row.createDiv({ cls: "invoice-sync-row-main" });
        main.createDiv({ text: r.seller, cls: "invoice-sync-row-title" });
        main.createDiv({ text: r.issued, cls: "invoice-sync-muted" });
        const right = row.createDiv({ cls: "invoice-sync-row-right" });
        right.createDiv({ text: yuan(r.total), cls: "invoice-sync-amount" });
        const label = reimbursementLabel(r.reimbursed);
        const status = right.createEl("button", {
          text: label,
          cls: `invoice-sync-chip${r.reimbursed ? "" : " is-pending"}`,
          attr: { title: t("view.toggleHint"), "aria-label": t("view.toggleAria", { seller: r.seller, status: label }) },
        });
        status.onclick = async (event) => {
          event.stopPropagation();
          status.disabled = true;
          const next = await this.plugin.toggleInvoiceStatus(r.path);
          if (next !== undefined) new Notice(t(next ? "notice.markedReimbursed" : "notice.markedPending"));
          this.renderBody();
        };
        row.onclick = () => void this.app.workspace.openLinkText(r.path, "", false);
      }
    } else if (this.plugin.sync.isConfigured()) {
      el.createDiv({ text: t("view.empty"), cls: "invoice-sync-muted invoice-sync-empty" });
    }
  }

  private renderQueueItem(parent: HTMLElement, item: QueueItem): void {
    const card = parent.createDiv({ cls: "invoice-sync-queue-item" });
    const top = card.createDiv({ cls: "invoice-sync-queue-top" });
    top.createSpan({ text: reasonLabel(item.reason), cls: `invoice-sync-reason reason-${item.reason}` });
    top.createSpan({ text: item.subject, cls: "invoice-sync-queue-subject" });
    card.createDiv({ text: item.detail, cls: "invoice-sync-muted invoice-sync-queue-detail" });

    const actions = card.createDiv({ cls: "invoice-sync-queue-actions" });
    const btn = (text: string, fn: () => Promise<void> | void) => {
      const b = actions.createEl("button", { text, cls: "invoice-sync-small-btn" });
      b.onclick = async (e) => {
        e.stopPropagation();
        b.disabled = true;
        try {
          await fn();
        } finally {
          this.renderBody();
        }
      };
    };
    if (item.notePath && item.reason !== "import-failed") {
      btn(t("queue.openNote"), () => void this.app.workspace.openLinkText(item.notePath ?? "", "", false));
    }
    if (item.link) btn(t("queue.openLink"), () => void window.open(item.link, "_blank"));
    if (item.rawFile || item.reason === "import-failed") {
      btn(t("queue.retry"), async () => {
        const r = await this.plugin.sync.retry(item);
        const made = r.created + r.imported;
        new Notice(made > 0 ? tn("queue.retrySuccess", made) : t("queue.retryFailed"));
      });
    }
    btn(item.reason === "buyer-mismatch" || item.reason === "amount-mismatch" ? t("queue.acknowledge") : t("queue.ignore"), () => this.plugin.sync.dismiss(item));
  }

  private onProgress(p: SyncProgress): void {
    this.statusEl.setText(p.message);
    if (p.total && p.current !== undefined) {
      this.barWrapEl.show();
      this.barEl.setCssProps({ width: `${Math.min(100, Math.round((p.current / p.total) * 100))}%` });
    }
  }

  async runSync(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.syncBtn.disabled = true;
    this.syncBtn.setText(t("view.syncing"));
    this.statusEl.removeClass("is-error");
    let report: SyncReport | null = null;
    try {
      report = await this.plugin.runSync((p) => this.onProgress(p));
    } finally {
      this.busy = false;
      this.syncBtn.disabled = false;
      this.syncBtn.setText(t("view.sync"));
      this.barWrapEl.hide();
      this.barEl.setCssProps({ width: "0%" });
      this.renderBody();
      if (report) this.showReport(report);
    }
  }

  private showReport(r: SyncReport): void {
    if (r.errors.length > 0) {
      this.statusEl.setText(r.errors[0] ?? t("view.syncFailed"));
      this.statusEl.addClass("is-error");
      return;
    }
    const parts = [tn("report.checked", r.mails)];
    if (r.created) parts.push(t("report.created", { n: r.created }));
    if (r.imported) parts.push(t("report.imported", { n: r.imported }));
    if (r.problems) parts.push(tn("report.problems", r.problems));
    this.statusEl.setText(parts.join(" · "));
  }
}
