/**
 * 同步索引：发票号码 → 笔记、邮件处理状态、文件夹水位、待处理队列。
 *
 * 存在插件目录下的 index.json；待处理邮件的原文另存为 .eml，
 * 这样「重试」不用重新登录邮箱。
 */
import type { App } from "obsidian";
import { normalizePath } from "obsidian";
import type { ProblemReason } from "./pipeline";

export interface InvoiceEntry {
  path: string;
  mailKey?: string;
  syncedAt: string;
}

export type MailStatus = "done" | "ignored" | "pending";

export interface MailEntry {
  status: MailStatus;
  invoices?: string[];
  at: string;
}

/** IMAP 增量水位：UIDVALIDITY 变了就要重扫。 */
export interface FolderMark {
  uidValidity: string;
  lastUid: number;
}

export interface QueueItem {
  id: string;
  mailKey?: string;
  subject: string;
  from?: string;
  date?: string;
  reason: ProblemReason;
  detail: string;
  link?: string;
  invoiceNo?: string;
  notePath?: string;
  /** 插件目录下保存的邮件原文，用于重试。 */
  rawFile?: string;
  createdAt: string;
}

interface IndexData {
  version: 1;
  invoices: Record<string, InvoiceEntry>;
  mails: Record<string, MailEntry>;
  folders: Record<string, FolderMark>;
  queue: QueueItem[];
}

function empty(): IndexData {
  return { version: 1, invoices: {}, mails: {}, folders: {}, queue: [] };
}

/** FNV-1a，给邮件原文起个稳定的文件名。 */
function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i += 1) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

export class IndexStore {
  private data: IndexData = empty();

  constructor(
    private readonly app: App,
    private readonly dir: string,
  ) {}

  private get file(): string {
    return normalizePath(`${this.dir}/index.json`);
  }

  private get pendingDir(): string {
    return normalizePath(`${this.dir}/pending`);
  }

  async load(): Promise<void> {
    try {
      if (await this.app.vault.adapter.exists(this.file)) {
        const parsed = JSON.parse(await this.app.vault.adapter.read(this.file)) as Partial<IndexData>;
        this.data = { ...empty(), ...parsed, version: 1 };
      }
    } catch {
      // 索引损坏不该阻塞插件启动；最坏情况是重新处理一遍，靠发票号码去重
      this.data = empty();
    }
  }

  async save(): Promise<void> {
    if (!(await this.app.vault.adapter.exists(this.dir))) await this.app.vault.adapter.mkdir(this.dir);
    await this.app.vault.adapter.write(this.file, JSON.stringify(this.data));
  }

  // ---- 发票 ----
  getInvoice(no: string): InvoiceEntry | undefined {
    return this.data.invoices[no];
  }
  setInvoice(no: string, entry: InvoiceEntry): void {
    this.data.invoices[no] = entry;
  }
  get invoiceCount(): number {
    return Object.keys(this.data.invoices).length;
  }

  // ---- 邮件 ----
  getMail(key: string): MailEntry | undefined {
    return this.data.mails[key];
  }
  setMail(key: string, status: MailStatus, invoices?: string[]): void {
    this.data.mails[key] = { status, at: new Date().toISOString(), ...(invoices?.length ? { invoices } : {}) };
  }

  // ---- 水位 ----
  getFolder(path: string): FolderMark | undefined {
    return this.data.folders[path];
  }
  setFolder(path: string, mark: FolderMark): void {
    this.data.folders[path] = mark;
  }
  /** 清空水位与邮件记录：下次同步重扫全部邮件（发票仍按号码去重，不会重复建笔记）。 */
  resetMailState(): void {
    this.data.folders = {};
    this.data.mails = {};
  }

  // ---- 待处理队列 ----
  get queue(): readonly QueueItem[] {
    return this.data.queue;
  }
  addQueueItem(item: Omit<QueueItem, "id" | "createdAt">): void {
    const id = `${item.mailKey ?? item.notePath ?? ""}#${item.reason}#${item.invoiceNo ?? ""}`;
    const existing = this.data.queue.findIndex((q) => q.id === id);
    const full: QueueItem = { ...item, id, createdAt: new Date().toISOString() };
    if (existing >= 0) this.data.queue[existing] = full;
    else this.data.queue.push(full);
  }
  async removeQueueItem(id: string): Promise<void> {
    const item = this.data.queue.find((q) => q.id === id);
    this.data.queue = this.data.queue.filter((q) => q.id !== id);
    // 同一封邮件的最后一个问题处理完，原文也删掉
    if (item?.rawFile && !this.data.queue.some((q) => q.rawFile === item.rawFile)) {
      await this.app.vault.adapter.remove(item.rawFile).catch(() => {});
    }
  }
  /** 某封邮件重新处理前，先清掉它的旧问题（原文保留，由调用方决定）。 */
  clearQueueForMail(mailKey: string): void {
    this.data.queue = this.data.queue.filter((q) => q.mailKey !== mailKey);
  }

  /** 保存待处理邮件的原文，返回 vault 相对路径。 */
  async saveRaw(mailKey: string, raw: Uint8Array): Promise<string> {
    if (!(await this.app.vault.adapter.exists(this.pendingDir))) await this.app.vault.adapter.mkdir(this.pendingDir);
    const path = normalizePath(`${this.pendingDir}/${hash(mailKey)}.eml`);
    await this.app.vault.adapter.writeBinary(path, raw.slice().buffer);
    return path;
  }

  async readRaw(path: string): Promise<Uint8Array> {
    return new Uint8Array(await this.app.vault.adapter.readBinary(path));
  }
}
