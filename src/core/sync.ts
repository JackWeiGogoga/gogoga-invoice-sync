/**
 * 同步编排：IMAP 拉邮件 → 管线出发票 → 写原始文件与笔记 → 记录问题。
 */
import type { App } from "obsidian";
import { normalizePath, TFile } from "obsidian";
import type { InvoiceSyncSettings } from "../settings";
import type { IndexStore, QueueItem } from "./index-store";
import { peekMessageId, processMessage, type MailOutcome } from "./pipeline";
import { buildNote, pathsFor } from "./note-builder";
import { checkAmounts } from "../invoice/einvoice";
import { expandFiles, groupInvoices, groupPdfInvoices } from "../invoice/files";
import type { FileBlob, Invoice, InvoiceBundle } from "../invoice/model";
import { nodeFetcher, type Fetcher } from "../invoice/download";
import { fetchNew, listFolders, withImap } from "../mail/imap";
import { baseFileContent } from "./base-file";
import { joinPath } from "./util";
import { isReimbursed } from "./status";

export interface SyncProgress {
  message: string;
  current?: number;
  total?: number;
}
export type ProgressFn = (p: SyncProgress) => void;

export interface SyncReport {
  mails: number;
  created: number;
  duplicates: number;
  ignored: number;
  problems: number;
  imported: number;
  errors: string[];
}

function emptyReport(): SyncReport {
  return { mails: 0, created: 0, duplicates: 0, ignored: 0, problems: 0, imported: 0, errors: [] };
}

export interface InvoiceStats {
  count: number;
  total: number;
  unreimbursed: number;
  unreimbursedTotal: number;
  thisMonth: number;
  thisMonthTotal: number;
}

/** 写入一张发票时的来源信息。 */
interface WriteMeta {
  mailKey?: string;
  subject: string;
  source?: string;
  received?: string;
}

function toBuffer(data: Uint8Array): ArrayBuffer {
  return data.slice().buffer;
}

export class SyncService {
  private readonly fetcher: Fetcher;

  constructor(
    private readonly app: App,
    private readonly getSettings: () => InvoiceSyncSettings,
    private readonly index: IndexStore,
    fetcher?: Fetcher,
  ) {
    this.fetcher = fetcher ?? nodeFetcher;
  }

  /** 从钥匙串取授权码。 */
  private password(): string | null {
    const id = this.getSettings().secretId;
    if (!id) return null;
    return this.app.secretStorage.getSecret(id);
  }

  isConfigured(): boolean {
    return !!this.getSettings().email && !!this.password();
  }

  /** 测试连接：返回文件夹列表。 */
  async testConnection(): Promise<Array<{ path: string; messages?: number }>> {
    const s = this.getSettings();
    const pass = this.password();
    if (!s.email || !pass) throw new Error("请先填写邮箱地址并选择授权码");
    return withImap({ host: s.host, port: s.port, user: s.email, pass }, listFolders);
  }

  /** 完整同步：邮箱 + 导入文件夹。 */
  async sync(onProgress?: ProgressFn): Promise<SyncReport> {
    const report = emptyReport();
    const s = this.getSettings();
    await this.ensureScaffold();

    const pass = this.password();
    if (!s.email || !pass) {
      report.errors.push("尚未配置邮箱地址或授权码");
    } else {
      try {
        await withImap({ host: s.host, port: s.port, user: s.email, pass }, async (client) => {
          const all = await listFolders(client);
          const targets = new Set(s.folders.filter((f) => all.some((x) => x.path === f)));
          if (s.includeJunk) for (const f of all) if (f.specialUse === "\\Junk") targets.add(f.path);

          for (const folder of targets) {
            const mark = this.index.getFolder(folder);
            onProgress?.({ message: `检查 ${folder}…` });
            await fetchNew(client, folder, {
              lastUid: mark?.lastUid ?? 0,
              uidValidity: mark?.uidValidity,
              // 起始日期只对首次同步生效
              since: !mark && s.sinceDate ? new Date(s.sinceDate) : undefined,
              onMail: async (m) => {
                report.mails += 1;
                await this.handleMail(m.raw, `${folder}:${m.uidValidity}:${m.uid}`, report);
              },
              onAdvance: (next) => this.index.setFolder(folder, next),
              onProgress: (done, total) => onProgress?.({ message: `处理 ${folder} 的新邮件`, current: done, total }),
            });
            await this.index.save();
          }
        });
      } catch (err) {
        report.errors.push(err instanceof Error ? err.message : String(err));
      }
    }

    onProgress?.({ message: "检查导入文件夹…" });
    await this.processImportFolder(report);
    await this.index.save();
    return report;
  }

  /**
   * 处理一封邮件。force=true 用于重试：即使记录为已处理也重新跑一遍。
   */
  async handleMail(raw: Uint8Array, fallbackKey: string, report: SyncReport, force = false): Promise<void> {
    const s = this.getSettings();
    // 先看邮件头判断是否处理过，免得重复下载
    const key = peekMessageId(raw) ?? fallbackKey;
    const seen = this.index.getMail(key);
    if (!force && seen && seen.status !== "pending") return;
    const outcome = await processMessage(raw, { fetcher: s.followLinks ? this.fetcher : undefined });
    await this.recordOutcome(key, raw, outcome, report);
  }

  private async recordOutcome(key: string, raw: Uint8Array, outcome: MailOutcome, report: SyncReport): Promise<void> {
    const oldRaw = this.index.queue.find((q) => q.mailKey === key)?.rawFile;
    this.index.clearQueueForMail(key);

    if (outcome.ignored) {
      report.ignored += 1;
      this.index.setMail(key, "ignored");
      if (oldRaw) await this.app.vault.adapter.remove(oldRaw).catch(() => {});
      return;
    }

    const meta: WriteMeta = {
      mailKey: key,
      subject: outcome.subject,
      source: outcome.from?.split("@").pop(),
      received: outcome.date,
    };
    const numbers: string[] = [];
    for (const bundle of outcome.bundles) {
      const created = await this.writeInvoice(bundle, meta);
      numbers.push(bundle.invoice.number);
      if (created) report.created += 1;
      else report.duplicates += 1;
    }

    if (outcome.problems.length > 0) {
      const rawFile = await this.index.saveRaw(key, raw);
      for (const p of outcome.problems) {
        this.index.addQueueItem({
          mailKey: key,
          subject: outcome.subject,
          from: outcome.from,
          date: outcome.date,
          reason: p.reason,
          detail: p.detail,
          link: p.link,
          invoiceNo: p.invoiceNo,
          rawFile,
        });
      }
      report.problems += outcome.problems.length;
      this.index.setMail(key, "pending", numbers);
    } else {
      this.index.setMail(key, "done", numbers);
      if (oldRaw) await this.app.vault.adapter.remove(oldRaw).catch(() => {});
    }
  }

  private buyerMatches(inv: Invoice): boolean {
    const mine = this.getSettings().myBuyers.map((b) => b.trim()).filter(Boolean);
    if (mine.length === 0) return true;
    const taxId = inv.buyer.taxId?.toUpperCase();
    return mine.some((m) => m === inv.buyer.name || (!!taxId && m.toUpperCase() === taxId));
  }

  /** 写原始文件与笔记；已存在（按发票号码）则跳过。返回是否新建。 */
  async writeInvoice(bundle: InvoiceBundle, meta: WriteMeta): Promise<boolean> {
    const s = this.getSettings();
    const inv = bundle.invoice;
    const known = this.index.getInvoice(inv.number);
    if (known && this.app.vault.getFileByPath(known.path)) return false;

    const paths = pathsFor(bundle, s);
    // 目标路径被另一张发票占了（同日同店同金额）→ 加号码尾号区分
    const occupant = this.app.vault.getFileByPath(paths.note);
    if (occupant) {
      const fm = this.app.metadataCache.getFileCache(occupant)?.frontmatter as { invoice_no?: string } | undefined;
      if (String(fm?.invoice_no ?? "") === inv.number) {
        this.index.setInvoice(inv.number, { path: occupant.path, mailKey: meta.mailKey, syncedAt: new Date().toISOString() });
        return false;
      }
      paths.note = paths.note.replace(/\.md$/, ` (${inv.number.slice(-6)}).md`);
    }

    await this.ensureFolder(paths.filesDir);
    const writes: Array<[string | undefined, FileBlob | undefined]> = [
      [paths.xml, bundle.xml],
      [paths.pdf, bundle.pdf],
      [paths.ofd, bundle.ofd],
      ...bundle.extras.map((f, i): [string | undefined, FileBlob] => [paths.extras[i], f]),
    ];
    for (const [path, blob] of writes) {
      if (!path || !blob || this.app.vault.getAbstractFileByPath(path)) continue;
      await this.app.vault.createBinary(path, toBuffer(blob.data));
    }

    const buyerMismatch = !this.buyerMatches(inv);
    const amountIssue = checkAmounts(inv);
    await this.ensureFolder(paths.dir);
    await this.app.vault.create(
      paths.note,
      buildNote(inv, paths, {
        buyerMismatch,
        amountIssue,
        source: meta.source,
        received: meta.received,
        embedPdf: s.embedPdf,
      }),
    );
    this.index.setInvoice(inv.number, { path: paths.note, mailKey: meta.mailKey, syncedAt: new Date().toISOString() });

    const noteItem = { subject: `${inv.seller.name} ¥${inv.total.toFixed(2)}`, invoiceNo: inv.number, notePath: paths.note };
    if (buyerMismatch) {
      this.index.addQueueItem({ ...noteItem, reason: "buyer-mismatch", detail: `购买方是「${inv.buyer.name}」` });
    }
    if (amountIssue) this.index.addQueueItem({ ...noteItem, reason: "amount-mismatch", detail: amountIssue });
    return true;
  }

  /**
   * 导入文件夹：把手动下载的 XML/ZIP/PDF/OFD 丢进去，这里归组成发票。
   * 用上的文件移到系统回收站（原件已复制到附件目录），用不上的留在原处并记入待处理。
   */
  async processImportFolder(report: SyncReport): Promise<void> {
    const s = this.getSettings();
    const folder = this.app.vault.getFolderByPath(normalizePath(s.importFolder));
    if (!folder) return;
    const files = folder.children.filter((f): f is TFile => f instanceof TFile && f.extension !== "md");
    if (files.length === 0) return;

    // 记住每个叶子文件来自哪个顶层文件，好判断顶层文件是否「用完了」
    const origin = new Map<FileBlob, TFile>();
    const leaves: FileBlob[] = [];
    for (const f of files) {
      const data = new Uint8Array(await this.app.vault.readBinary(f));
      for (const leaf of expandFiles([{ name: f.name, data }])) {
        origin.set(leaf, f);
        leaves.push(leaf);
      }
    }
    let grouped = groupInvoices(leaves, "import");
    if (grouped.bundles.length === 0) grouped = await groupPdfInvoices(leaves, "import");
    const used = new Set<FileBlob>();
    for (const b of grouped.bundles) {
      await this.writeInvoice(b, { subject: `导入：${b.invoice.seller.name}`, source: "手动导入" });
      report.imported += 1;
      for (const blob of [b.xml, b.pdf, b.ofd, ...b.extras]) if (blob) used.add(blob);
    }

    for (const f of files) {
      const mine = leaves.filter((l) => origin.get(l) === f && l.kind !== "other");
      if (mine.length > 0 && mine.every((l) => used.has(l))) {
        await this.app.vault.trash(f, true);
      } else {
        const why = grouped.errors.find((e) => mine.some((m) => e.startsWith(m.name))) ?? (mine.length === 0 ? "不是 XML/PDF/OFD/ZIP" : "没有对应的发票 XML");
        this.index.addQueueItem({ subject: f.name, notePath: f.path, reason: "import-failed", detail: why });
        report.problems += 1;
      }
    }
  }

  /** 重试一条待处理：邮件类重新跑一遍（会重新下载）；导入类重扫导入文件夹。 */
  async retry(item: QueueItem): Promise<SyncReport> {
    const report = emptyReport();
    if (item.rawFile && item.mailKey) {
      const raw = await this.index.readRaw(item.rawFile);
      await this.handleMail(raw, item.mailKey, report, true);
    } else if (item.reason === "import-failed") {
      await this.index.removeQueueItem(item.id);
      await this.processImportFolder(report);
    }
    await this.index.save();
    return report;
  }

  /** 忽略一条待处理。 */
  async dismiss(item: QueueItem): Promise<void> {
    await this.index.removeQueueItem(item.id);
    if (item.mailKey && !this.index.queue.some((q) => q.mailKey === item.mailKey)) {
      const prev = this.index.getMail(item.mailKey);
      this.index.setMail(item.mailKey, prev?.invoices?.length ? "done" : "ignored", prev?.invoices);
    }
    await this.index.save();
  }

  /** 直接处理一批原始邮件（开发与测试用：不经 IMAP）。 */
  async importRawMails(mails: Array<{ key: string; raw: Uint8Array }>): Promise<SyncReport> {
    const report = emptyReport();
    await this.ensureScaffold();
    for (const m of mails) {
      report.mails += 1;
      await this.handleMail(m.raw, m.key, report);
    }
    await this.index.save();
    return report;
  }

  /** 首次使用时建好根目录、导入文件夹和 Bases 总表。 */
  async ensureScaffold(): Promise<void> {
    const s = this.getSettings();
    await this.ensureFolder(s.rootFolder);
    await this.ensureFolder(s.importFolder);
    const basePath = joinPath(s.rootFolder, "发票总表.base");
    if (!this.app.vault.getAbstractFileByPath(basePath)) {
      await this.app.vault.create(basePath, baseFileContent(s.rootFolder));
    }
  }

  get basePath(): string {
    return joinPath(this.getSettings().rootFolder, "发票总表.base");
  }

  /** 侧边栏用的统计：从 frontmatter 现算，勾选「已报销」后立刻反映。 */
  stats(): InvoiceStats {
    const s = this.getSettings();
    const month = new Date().toISOString().slice(0, 7);
    const out: InvoiceStats = { count: 0, total: 0, unreimbursed: 0, unreimbursedTotal: 0, thisMonth: 0, thisMonthTotal: 0 };
    const prefix = `${normalizePath(s.rootFolder)}/`;
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith(prefix)) continue;
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter as
        | { type?: string; total?: number; reimbursed?: boolean; status?: string; month?: string }
        | undefined;
      if (fm?.type !== "invoice") continue;
      const total = Number(fm.total) || 0;
      out.count += 1;
      out.total += total;
      if (!isReimbursed(fm.reimbursed, fm.status)) {
        out.unreimbursed += 1;
        out.unreimbursedTotal += total;
      }
      if (fm.month === month) {
        out.thisMonth += 1;
        out.thisMonthTotal += total;
      }
    }
    return out;
  }

  /** 最近的几张发票（按开票日期倒序）。 */
  recent(limit = 6): Array<{ path: string; seller: string; total: number; issued: string; reimbursed: boolean }> {
    const prefix = `${normalizePath(this.getSettings().rootFolder)}/`;
    const rows: Array<{ path: string; seller: string; total: number; issued: string; reimbursed: boolean; received: string }> = [];
    for (const f of this.app.vault.getMarkdownFiles()) {
      if (!f.path.startsWith(prefix)) continue;
      const fm = this.app.metadataCache.getFileCache(f)?.frontmatter as
        | { type?: string; seller?: string; total?: number; issued?: string; reimbursed?: boolean; status?: string; received?: string }
        | undefined;
      if (fm?.type !== "invoice") continue;
      rows.push({
        path: f.path,
        seller: fm.seller ?? f.basename,
        total: Number(fm.total) || 0,
        issued: String(fm.issued ?? ""),
        reimbursed: isReimbursed(fm.reimbursed, fm.status),
        received: String(fm.received ?? ""),
      });
    }
    return rows.sort((a, b) => (b.issued + b.received).localeCompare(a.issued + a.received)).slice(0, limit);
  }

  private async ensureFolder(dir: string): Promise<void> {
    if (!dir) return;
    const path = normalizePath(dir);
    if (this.app.vault.getFolderByPath(path)) return;
    let cur = "";
    for (const part of path.split("/")) {
      cur = cur ? `${cur}/${part}` : part;
      if (!this.app.vault.getFolderByPath(cur)) {
        try {
          await this.app.vault.createFolder(cur);
        } catch {
          // 并发或已存在时忽略
        }
      }
    }
  }
}
