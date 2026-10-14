export interface InvoiceSyncSettings {
  /** IMAP 登录邮箱。 */
  email: string;
  /**
   * 授权码在 Obsidian 钥匙串里的名字（不是授权码本身）。
   * 授权码存在系统钥匙串，不写进会随 iCloud 同步的 data.json。
   */
  secretId: string;
  host: string;
  port: number;
  /** 要扫的文件夹，默认只有收件箱。 */
  folders: string[];
  /** 同时扫垃圾邮件文件夹：发票通知偶尔会被误判。 */
  includeJunk: boolean;
  /** 首次同步从哪天开始（YYYY-MM-DD），留空为全部。 */
  sinceDate: string;
  /** 邮件里没有 XML 时，跟随正文里的下载链接去拿。 */
  followLinks: boolean;

  /** 发票笔记根目录。 */
  rootFolder: string;
  /** 目录模板，可用 {year} {month} {category} {seller}。 */
  dirTemplate: string;
  /** 文件名模板，可用 {date} {seller} {total} {number} {category} {kind}。 */
  fileTemplate: string;
  /** 原始 PDF/OFD/XML 存放目录。 */
  filesFolder: string;
  /** 手动导入：把 XML/ZIP 丢进这个目录，同步时自动处理。 */
  importFolder: string;
  /** 在笔记里内嵌 PDF 预览。 */
  embedPdf: boolean;

  /** 你的抬头（名称或税号，每行一个）；设置后，抬头不符的发票会进待处理。 */
  myBuyers: string[];

  autoSyncEnabled: boolean;
  autoSyncIntervalMinutes: number;
  /** 启动 Obsidian 后自动同步一次。 */
  syncOnStartup: boolean;
  lastSyncAt?: string;
}

export const DEFAULT_SETTINGS: InvoiceSyncSettings = {
  email: "",
  secretId: "",
  host: "imap.163.com",
  port: 993,
  folders: ["INBOX"],
  includeJunk: true,
  sinceDate: "",
  followLinks: true,

  rootFolder: "invoices",
  dirTemplate: "{year}/{month}",
  fileTemplate: "{date} {seller} {total}",
  // 放在笔记目录之外：否则文件列表类插件会把 PDF 和笔记混在一起显示
  filesFolder: "attachments/invoices",
  importFolder: "invoices/import",
  embedPdf: true,

  myBuyers: [],

  autoSyncEnabled: true,
  autoSyncIntervalMinutes: 60,
  syncOnStartup: true,
};

export function mergeSettings(saved: unknown): InvoiceSyncSettings {
  // initialStatus 是旧版文本状态设置；新版固定使用 reimbursed: false。
  const { initialStatus: _legacy, ...s } = (saved ?? {}) as Partial<InvoiceSyncSettings> & { initialStatus?: unknown };
  return { ...DEFAULT_SETTINGS, ...s };
}
