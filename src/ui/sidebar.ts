/**
 * 侧边栏：只放「需要你看一眼」的东西——同步按钮、概况、待处理队列、最近几张。
 * 完整列表交给 Bases 总表。
 */
import { ItemView, Notice, WorkspaceLeaf, debounce, setIcon } from "obsidian";
import type InvoiceSyncPlugin from "../main";
import type { QueueItem } from "../core/index-store";
import type { ProblemReason } from "../core/pipeline";
import type { SyncProgress, SyncReport } from "../core/sync";

export const VIEW_TYPE_INVOICE_SYNC = "invoice-sync-view";

const REASON_LABEL: Record<ProblemReason, string> = {
  "no-xml": "缺少 XML",
  "link-failed": "链接下载失败",
  "xml-invalid": "XML 无法解析",
  "unmatched-files": "文件对不上",
  "amount-mismatch": "金额异常",
  "buyer-mismatch": "抬头不符",
  "import-failed": "导入失败",
};

function yuan(v: number): string {
  return `¥${v.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function relTime(iso?: string): string {
  if (!iso) return "尚未同步";
  const min = Math.floor((Date.now() - new Date(iso).getTime()) / 60000);
  if (Number.isNaN(min)) return "—";
  if (min < 1) return "刚刚同步";
  if (min < 60) return `${min} 分钟前同步`;
  const h = Math.floor(min / 60);
  return h < 24 ? `${h} 小时前同步` : `${Math.floor(h / 24)} 天前同步`;
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
    return "发票";
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
    header.createEl("h3", { text: "发票", cls: "invoice-sync-title" });
    const actions = header.createDiv({ cls: "invoice-sync-header-actions" });
    const baseBtn = actions.createEl("button", { cls: "invoice-sync-icon-btn", attr: { "aria-label": "打开发票总表" } });
    setIcon(baseBtn, "table");
    baseBtn.onclick = () => void this.plugin.openBase();
    const settingsBtn = actions.createEl("button", { cls: "invoice-sync-icon-btn", attr: { "aria-label": "设置" } });
    setIcon(settingsBtn, "settings");
    settingsBtn.onclick = () => this.plugin.openSettings();

    this.syncBtn = root.createEl("button", { text: "同步", cls: "invoice-sync-primary" });
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
      setup.createDiv({ text: "还没有配置邮箱", cls: "invoice-sync-setup-title" });
      setup.createDiv({ text: "填好邮箱地址和 IMAP 授权码后就能同步。", cls: "invoice-sync-muted" });
      const go = setup.createEl("button", { text: "去设置" });
      go.onclick = () => this.plugin.openSettings();
    }

    // 概况
    const st = this.plugin.sync.stats();
    const tiles = el.createDiv({ cls: "invoice-sync-tiles" });
    const tile = (label: string, count: number, total: number, cls = "") => {
      const t = tiles.createDiv({ cls: `invoice-sync-tile ${cls}` });
      t.createDiv({ text: label, cls: "invoice-sync-tile-label" });
      // 卡片太窄放不下分，取整显示，悬停看精确值
      t.createDiv({ text: `¥${Math.round(total).toLocaleString("zh-CN")}`, cls: "invoice-sync-tile-value", attr: { title: yuan(total) } });
      t.createDiv({ text: `${count} 张`, cls: "invoice-sync-tile-sub" });
    };
    tile(this.plugin.settings.initialStatus, st.unreimbursed, st.unreimbursedTotal, st.unreimbursed > 0 ? "is-accent" : "");
    tile("本月", st.thisMonth, st.thisMonthTotal);
    tile("全部", st.count, st.total);

    // 待处理
    const queue = this.plugin.index.queue;
    if (queue.length > 0) {
      const sec = el.createDiv({ cls: "invoice-sync-section" });
      sec.createDiv({ text: `待处理 · ${queue.length}`, cls: "invoice-sync-section-title" });
      for (const item of queue) this.renderQueueItem(sec, item);
    }

    // 最近
    const recent = this.plugin.sync.recent();
    if (recent.length > 0) {
      const sec = el.createDiv({ cls: "invoice-sync-section" });
      sec.createDiv({ text: "最近", cls: "invoice-sync-section-title" });
      for (const r of recent) {
        const row = sec.createDiv({ cls: "invoice-sync-row" });
        const main = row.createDiv({ cls: "invoice-sync-row-main" });
        main.createDiv({ text: r.seller, cls: "invoice-sync-row-title" });
        main.createDiv({ text: r.issued, cls: "invoice-sync-muted" });
        const right = row.createDiv({ cls: "invoice-sync-row-right" });
        right.createDiv({ text: yuan(r.total), cls: "invoice-sync-amount" });
        if (r.status) {
          right.createDiv({
            text: r.status,
            cls: `invoice-sync-chip${r.status === this.plugin.settings.initialStatus ? " is-pending" : ""}`,
          });
        }
        row.onclick = () => void this.app.workspace.openLinkText(r.path, "", false);
      }
    } else if (this.plugin.sync.isConfigured()) {
      el.createDiv({ text: "还没有发票，点「同步」拉取邮箱。", cls: "invoice-sync-muted invoice-sync-empty" });
    }
  }

  private renderQueueItem(parent: HTMLElement, item: QueueItem): void {
    const card = parent.createDiv({ cls: "invoice-sync-queue-item" });
    const top = card.createDiv({ cls: "invoice-sync-queue-top" });
    top.createSpan({ text: REASON_LABEL[item.reason] ?? item.reason, cls: `invoice-sync-reason reason-${item.reason}` });
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
      btn("打开笔记", () => void this.app.workspace.openLinkText(item.notePath ?? "", "", false));
    }
    if (item.link) btn("打开链接", () => void window.open(item.link, "_blank"));
    if (item.rawFile || item.reason === "import-failed") {
      btn("重试", async () => {
        const r = await this.plugin.sync.retry(item);
        new Notice(r.created + r.imported > 0 ? `已生成 ${r.created + r.imported} 张发票` : "仍未成功，详情见待处理");
      });
    }
    btn(item.reason === "buyer-mismatch" || item.reason === "amount-mismatch" ? "知道了" : "忽略", () => this.plugin.sync.dismiss(item));
  }

  private onProgress(p: SyncProgress): void {
    this.statusEl.setText(p.message);
    if (p.total && p.current !== undefined) {
      this.barWrapEl.show();
      this.barEl.style.width = `${Math.min(100, Math.round((p.current / p.total) * 100))}%`;
    }
  }

  async runSync(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    this.syncBtn.disabled = true;
    this.syncBtn.setText("同步中…");
    this.statusEl.removeClass("is-error");
    let report: SyncReport | null = null;
    try {
      report = await this.plugin.runSync((p) => this.onProgress(p));
    } finally {
      this.busy = false;
      this.syncBtn.disabled = false;
      this.syncBtn.setText("同步");
      this.barWrapEl.hide();
      this.barEl.style.width = "0%";
      this.renderBody();
      if (report) this.showReport(report);
    }
  }

  private showReport(r: SyncReport): void {
    if (r.errors.length > 0) {
      this.statusEl.setText(r.errors[0] ?? "同步失败");
      this.statusEl.addClass("is-error");
      return;
    }
    const parts = [`检查 ${r.mails} 封新邮件`];
    if (r.created) parts.push(`新增 ${r.created} 张`);
    if (r.imported) parts.push(`导入 ${r.imported} 张`);
    if (r.problems) parts.push(`${r.problems} 个待处理`);
    this.statusEl.setText(parts.join(" · "));
  }
}
