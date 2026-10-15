/**
 * 界面文案的中英文字典。只管界面：写进 vault 的笔记属性、正文标签、总表定义等数据保持中文，不经过这里。
 *
 * `en` 是唯一的键来源；`zh` 必须逐键覆盖，漏译会在 typecheck 时报错。
 * 不引用 obsidian，冒烟测试可以直接在 Node 里加载。
 */

const en = {
  // ---- 命令与入口 ----
  "ribbon.open": "Invoices",
  "command.openPanel": "Open invoice panel",
  "command.sync": "Sync invoice mailbox",
  "command.openBase": "Open invoice overview",
  "command.toggleStatus": "Toggle reimbursement status of current invoice",

  // ---- 通知 ----
  "notice.syncing": "Syncing invoices…",
  "notice.syncProgress": "Invoice sync: {message}",
  "notice.syncFailed": "Invoice sync failed: {error}",
  "notice.syncDone.one": "Invoice sync complete: {n} new invoice",
  "notice.syncDone.other": "Invoice sync complete: {n} new invoices",
  "notice.syncDoneProblems.one": ", {n} needs attention",
  "notice.syncDoneProblems.other": ", {n} need attention",
  "notice.notInvoice": "The current file is not an invoice note",
  "notice.markedReimbursed": "Marked as reimbursed",
  "notice.markedPending": "Marked as not reimbursed",

  // ---- 报销状态 ----
  "status.reimbursed": "Reimbursed",
  "status.pending": "Not reimbursed",

  // ---- 侧边栏 ----
  "view.title": "Invoices",
  "view.settings": "Settings",
  "view.sync": "Sync",
  "view.syncing": "Syncing…",
  "view.syncFailed": "Sync failed",
  "view.neverSynced": "Not synced yet",
  "view.justSynced": "Synced just now",
  "view.syncedMinutes.one": "Synced {n} minute ago",
  "view.syncedMinutes.other": "Synced {n} minutes ago",
  "view.syncedHours.one": "Synced {n} hour ago",
  "view.syncedHours.other": "Synced {n} hours ago",
  "view.syncedDays.one": "Synced {n} day ago",
  "view.syncedDays.other": "Synced {n} days ago",
  "view.setupTitle": "Mailbox not configured",
  "view.setupDesc": "Enter your email address and IMAP authorization code to start syncing.",
  "view.goToSettings": "Open settings",
  "view.tileUnreimbursed": "Not reimbursed",
  "view.tileThisMonth": "This month",
  "view.tileAll": "All",
  "view.tileCount.one": "{n} invoice",
  "view.tileCount.other": "{n} invoices",
  "view.queueTitle": "Needs attention · {n}",
  "view.recent": "Recent",
  "view.toggleHint": "Click to toggle reimbursement status",
  "view.toggleAria": "{seller}: {status}, click to toggle",
  "view.empty": "No invoices yet. Select Sync to fetch them from your mailbox.",
  "report.checked.one": "Checked {n} new email",
  "report.checked.other": "Checked {n} new emails",
  "report.created": "{n} new",
  "report.imported": "{n} imported",
  "report.problems.one": "{n} needs attention",
  "report.problems.other": "{n} need attention",

  // ---- 待处理队列 ----
  "reason.no-xml": "Unreadable file",
  "reason.link-failed": "Download link failed",
  "reason.xml-invalid": "Invalid XML",
  "reason.unmatched-files": "Unmatched files",
  "reason.amount-mismatch": "Amount mismatch",
  "reason.buyer-mismatch": "Buyer mismatch",
  "reason.import-failed": "Import failed",
  "queue.openNote": "Open note",
  "queue.openLink": "Open link",
  "queue.retry": "Retry",
  "queue.acknowledge": "Got it",
  "queue.ignore": "Ignore",
  "queue.retrySuccess.one": "Created {n} invoice",
  "queue.retrySuccess.other": "Created {n} invoices",
  "queue.retryFailed": "Still failing. See Needs attention for details.",
  "queue.buyerIs": "Buyer is \"{name}\"",
  "queue.importSubject": "Import: {seller}",
  "queue.unsupportedFile": "Not an XML, PDF, OFD, or ZIP file",
  "queue.noMatchingXml": "No matching invoice XML",

  // ---- 设置 ----
  "settings.mailbox": "Mailbox",
  "settings.email.name": "Email address",
  "settings.email.desc": "The mailbox dedicated to receiving invoices.",
  "settings.authCode.name": "Authorization code",
  "settings.authCode.desc":
    "Select or create a secret that holds your IMAP authorization code. It's kept in the system keychain, never written to the plugin's settings file, and not synced through iCloud. Generate it in 163 Mail on the web after enabling IMAP under Settings → POP3/SMTP/IMAP.",
  "settings.test.name": "Test connection",
  "settings.test.desc": "Sign in and list folders without reading any email.",
  "settings.test.button": "Test",
  "settings.test.connecting": "Connecting…",
  "settings.test.success": "Connected: {folders}",
  "settings.test.failed": "Connection failed: {error}",
  "settings.host.name": "IMAP server",
  "settings.host.desc": "No need to change this for 163 Mail.",
  "settings.sync": "Sync",
  "settings.folders.name": "Folders to scan",
  "settings.folders.desc": "Comma-separated. Defaults to INBOX only.",
  "settings.junk.name": "Also scan junk folder",
  "settings.junk.desc": "163 Mail occasionally marks invoice emails as junk.",
  "settings.since.name": "First sync start date",
  "settings.since.desc": "Only applies to the first sync. Use the format 2025-01-01, or leave empty to include all email.",
  "settings.since.placeholder": "All",
  "settings.follow.name": "Follow download links",
  "settings.follow.desc": "When an email has no XML attached, open the download links in its body to fetch it.",
  "settings.auto.name": "Auto sync",
  "settings.auto.30": "Every 30 minutes",
  "settings.auto.60": "Every hour",
  "settings.auto.180": "Every 3 hours",
  "settings.auto.720": "Every 12 hours",
  "settings.startup.name": "Sync on startup",
  "settings.startup.desc": "Sync once after Obsidian starts.",
  "settings.storage": "Notes and files",
  "settings.root.name": "Root folder",
  "settings.root.desc": "Invoice notes and the overview table are stored here.",
  "settings.dirTemplate.name": "Folder template",
  "settings.dirTemplate.desc": "Available placeholders: {year} {month} {category} {seller}.",
  "settings.fileTemplate.name": "File name template",
  "settings.fileTemplate.desc": "Available placeholders: {date} {seller} {total} {number} {category} {kind}.",
  "settings.filesFolder.name": "Original files folder",
  "settings.filesFolder.desc": "PDF, OFD, and XML files are stored here by year, named after the invoice number.",
  "settings.importFolder.name": "Import folder",
  "settings.importFolder.desc": "Drop manually downloaded XML, ZIP, PDF, or OFD files here. They're processed on the next sync.",
  "settings.embedPdf.name": "Embed PDF preview",
  "settings.buyers": "Buyer check",
  "settings.myBuyers.name": "My buyer names",
  "settings.myBuyers.desc":
    "One per line, either a name or a tax ID. When set, invoices whose buyer isn't listed go to Needs attention, marked as Buyer mismatch.",
  "settings.maintenance": "Maintenance",
  "settings.rescan.name": "Rescan mailbox",
  "settings.rescan.desc":
    "Forget which emails have been processed, so the next sync scans everything again. Existing invoices are deduplicated by number and won't be created twice.",
  "settings.rescan.button": "Reset",
  "settings.rescan.done": "Reset. The next sync will rescan all email.",

  // ---- 同步过程 ----
  "progress.checkingFolder": "Checking {folder}…",
  "progress.processingFolder": "Processing new emails in {folder}",
  "progress.checkingImport": "Checking import folder…",
  "error.needCredentials": "Enter your email address and select an authorization code first",
  "error.notConfigured": "Email address or authorization code not configured",

  // ---- 邮件与下载 ----
  "mail.noSubject": "(no subject)",
  "mail.noInvoiceInDownload": "The downloaded files contain no readable invoice XML or PDF",
  "mail.downloadFailed": "Download failed",
  "mail.attachmentsOnly": "Attachments only include {kinds}, with no readable XML. PDFs need a selectable text layer.",
  "mail.followLinksOff": "Following download links is turned off",
  "mail.unassignedFiles.one": "{n} file couldn't be matched to an invoice: {names}",
  "mail.unassignedFiles.other": "{n} files couldn't be matched to an invoice: {names}",
  "mail.unmatchedNumbers.one": "{n} file doesn't match any invoice number: {names}",
  "mail.unmatchedNumbers.other": "{n} files don't match any invoice number: {names}",
  "imap.unsafeLogin": "163 Mail rejected this client (Unsafe Login). Please report the full error to the developer.",
  "imap.authFailed":
    "Sign-in failed. Make sure you're using the authorization code, not your web password, and that IMAP is enabled in 163 Mail on the web under Settings → POP3/SMTP/IMAP.",
  "imap.unreachable": "Can't connect to {host}. Check your network connection.",
  "download.tooLarge": "File exceeds 25 MB",
  "download.timeout": "Request timed out",
  "download.tooManyRedirects": "Too many redirects",
  "download.noFileOnLanding": "No file URL found on the landing page",
  "download.notInvoiceFile": "The response isn't an invoice file",
  "download.failed.one": "Followed {n} hop to {host}: {why}{extra}",
  "download.failed.other": "Followed {n} hops to {host}: {why}{extra}",

  // ---- 解析错误 ----
  "parse.fileError": "{name}: {message}",
  "parse.detail": " ({detail})",
  "parse.listSeparator": ", ",
  "parse.notEInvoice": "Not an e-invoice XML (root element: {root})",
  "parse.none": "none",
  "parse.xmlNoNumber": "No valid invoice number in the XML",
  "parse.xmlNoSeller": "No seller name in the XML",
  "parse.pdfNoText": "The PDF has no usable text layer (scanned PDFs aren't supported yet)",
  "parse.pdfNotInvoice": "The PDF isn't a recognizable invoice",
  "parse.pdfNoNumber": "No valid invoice number in the PDF",
  "parse.pdfNoDate": "No valid issue date in the PDF",
  "parse.pdfTable": "Couldn't recognize the invoice table in the PDF",
  "parse.pdfNoAmounts": "The PDF is missing the amount or tax",
  "parse.pdfNoParties": "The PDF is missing the buyer or seller name",
  "parse.pdfEncrypted": "The PDF is encrypted and can't be read",
  "parse.pdfFailed": "PDF parsing failed: {message}",
} as const;

export type Key = keyof typeof en;
/** 有 `.one` / `.other` 两种形式的键，去掉后缀。 */
type StripOne<K> = K extends `${infer B}.one` ? B : never;
export type PluralKey = StripOne<Key>;

const zh: Record<Key, string> = {
  "ribbon.open": "发票",
  "command.openPanel": "打开发票面板",
  "command.sync": "同步发票邮箱",
  "command.openBase": "打开发票总表",
  "command.toggleStatus": "切换当前发票报销状态",

  "notice.syncing": "发票同步中…",
  "notice.syncProgress": "发票同步：{message}",
  "notice.syncFailed": "发票同步失败：{error}",
  "notice.syncDone.one": "发票同步完成：新增 {n} 张",
  "notice.syncDone.other": "发票同步完成：新增 {n} 张",
  "notice.syncDoneProblems.one": "，{n} 个待处理",
  "notice.syncDoneProblems.other": "，{n} 个待处理",
  "notice.notInvoice": "当前文件不是发票笔记",
  "notice.markedReimbursed": "已标记为已报销",
  "notice.markedPending": "已标记为未报销",

  "status.reimbursed": "已报销",
  "status.pending": "未报销",

  "view.title": "发票",
  "view.settings": "设置",
  "view.sync": "同步",
  "view.syncing": "同步中…",
  "view.syncFailed": "同步失败",
  "view.neverSynced": "尚未同步",
  "view.justSynced": "刚刚同步",
  "view.syncedMinutes.one": "{n} 分钟前同步",
  "view.syncedMinutes.other": "{n} 分钟前同步",
  "view.syncedHours.one": "{n} 小时前同步",
  "view.syncedHours.other": "{n} 小时前同步",
  "view.syncedDays.one": "{n} 天前同步",
  "view.syncedDays.other": "{n} 天前同步",
  "view.setupTitle": "还没有配置邮箱",
  "view.setupDesc": "填好邮箱地址和 IMAP 授权码后就能同步。",
  "view.goToSettings": "去设置",
  "view.tileUnreimbursed": "未报销",
  "view.tileThisMonth": "本月",
  "view.tileAll": "全部",
  "view.tileCount.one": "{n} 张",
  "view.tileCount.other": "{n} 张",
  "view.queueTitle": "待处理 · {n}",
  "view.recent": "最近",
  "view.toggleHint": "点击切换报销状态",
  "view.toggleAria": "{seller}：{status}，点击切换",
  "view.empty": "还没有发票，点「同步」拉取邮箱。",
  "report.checked.one": "检查 {n} 封新邮件",
  "report.checked.other": "检查 {n} 封新邮件",
  "report.created": "新增 {n} 张",
  "report.imported": "导入 {n} 张",
  "report.problems.one": "{n} 个待处理",
  "report.problems.other": "{n} 个待处理",

  "reason.no-xml": "文件无法解析",
  "reason.link-failed": "链接下载失败",
  "reason.xml-invalid": "XML 无法解析",
  "reason.unmatched-files": "文件对不上",
  "reason.amount-mismatch": "金额异常",
  "reason.buyer-mismatch": "抬头不符",
  "reason.import-failed": "导入失败",
  "queue.openNote": "打开笔记",
  "queue.openLink": "打开链接",
  "queue.retry": "重试",
  "queue.acknowledge": "知道了",
  "queue.ignore": "忽略",
  "queue.retrySuccess.one": "已生成 {n} 张发票",
  "queue.retrySuccess.other": "已生成 {n} 张发票",
  "queue.retryFailed": "仍未成功，详情见待处理",
  "queue.buyerIs": "购买方是「{name}」",
  "queue.importSubject": "导入：{seller}",
  "queue.unsupportedFile": "不是 XML/PDF/OFD/ZIP",
  "queue.noMatchingXml": "没有对应的发票 XML",

  "settings.mailbox": "邮箱",
  "settings.email.name": "邮箱地址",
  "settings.email.desc": "专门收发票的邮箱。",
  "settings.authCode.name": "授权码",
  "settings.authCode.desc":
    "选择或新建一个存放 IMAP 授权码的密钥。授权码保存在系统钥匙串里，不会写进插件设置文件，也不随 iCloud 同步。在 163 网页版 设置 → POP3/SMTP/IMAP 里开启 IMAP 后生成。",
  "settings.test.name": "测试连接",
  "settings.test.desc": "登录邮箱并列出文件夹，不读取邮件内容。",
  "settings.test.button": "测试",
  "settings.test.connecting": "连接中…",
  "settings.test.success": "连接成功：{folders}",
  "settings.test.failed": "连接失败：{error}",
  "settings.host.name": "IMAP 服务器",
  "settings.host.desc": "163 邮箱不用改。",
  "settings.sync": "同步",
  "settings.folders.name": "扫描的文件夹",
  "settings.folders.desc": "逗号分隔，默认只有 INBOX。",
  "settings.junk.name": "同时扫描垃圾邮件",
  "settings.junk.desc": "发票通知偶尔会被 163 当成垃圾邮件。",
  "settings.since.name": "首次同步起始日期",
  "settings.since.desc": "只在第一次同步时生效，格式 2025-01-01；留空为全部邮件。",
  "settings.since.placeholder": "全部",
  "settings.follow.name": "跟随下载链接",
  "settings.follow.desc": "邮件没有附带 XML 时，打开正文里的下载链接去取。",
  "settings.auto.name": "自动同步",
  "settings.auto.30": "每 30 分钟",
  "settings.auto.60": "每小时",
  "settings.auto.180": "每 3 小时",
  "settings.auto.720": "每 12 小时",
  "settings.startup.name": "启动时同步",
  "settings.startup.desc": "打开 Obsidian 后自动同步一次。",
  "settings.storage": "笔记与文件",
  "settings.root.name": "根目录",
  "settings.root.desc": "发票笔记和总表放在这里。",
  "settings.dirTemplate.name": "目录模板",
  "settings.dirTemplate.desc": "可用 {year} {month} {category} {seller}。",
  "settings.fileTemplate.name": "文件名模板",
  "settings.fileTemplate.desc": "可用 {date} {seller} {total} {number} {category} {kind}。",
  "settings.filesFolder.name": "原始文件目录",
  "settings.filesFolder.desc": "PDF / OFD / XML 按年份存在这里，以发票号码命名。",
  "settings.importFolder.name": "导入文件夹",
  "settings.importFolder.desc": "手动下载的 XML / ZIP / PDF / OFD 丢进来，同步时自动处理。",
  "settings.embedPdf.name": "内嵌 PDF 预览",
  "settings.buyers": "抬头校验",
  "settings.myBuyers.name": "我的抬头",
  "settings.myBuyers.desc": "每行一个，名称或税号均可。设置后，购买方不在列表里的发票会进待处理并标注「抬头不符」。",
  "settings.maintenance": "维护",
  "settings.rescan.name": "重新扫描邮箱",
  "settings.rescan.desc": "忘掉已处理过的邮件，下次同步从头扫一遍。已有的发票按号码去重，不会重复生成。",
  "settings.rescan.button": "重置",
  "settings.rescan.done": "已重置，下次同步会重新扫描全部邮件",

  "progress.checkingFolder": "检查 {folder}…",
  "progress.processingFolder": "处理 {folder} 的新邮件",
  "progress.checkingImport": "检查导入文件夹…",
  "error.needCredentials": "请先填写邮箱地址并选择授权码",
  "error.notConfigured": "尚未配置邮箱地址或授权码",

  "mail.noSubject": "(无主题)",
  "mail.noInvoiceInDownload": "下载到的文件里没有可解析的发票 XML/PDF",
  "mail.downloadFailed": "下载失败",
  "mail.attachmentsOnly": "附件只有 {kinds}，没有可解析的 XML；PDF 需要带可复制的文字层",
  "mail.followLinksOff": "未启用跟随下载链接",
  "mail.unassignedFiles.one": "有 {n} 个文件无法归入发票：{names}",
  "mail.unassignedFiles.other": "有 {n} 个文件无法归入发票：{names}",
  "mail.unmatchedNumbers.one": "有 {n} 个文件对不上发票号码：{names}",
  "mail.unmatchedNumbers.other": "有 {n} 个文件对不上发票号码：{names}",
  "imap.unsafeLogin": "163 拒绝了这个客户端（Unsafe Login），请把完整报错反馈给开发者。",
  "imap.authFailed": "登录失败：请确认用的是「授权码」而不是网页登录密码，并且 163 网页版 设置 → POP3/SMTP/IMAP 里已开启 IMAP。",
  "imap.unreachable": "连不上 {host}，请检查网络。",
  "download.tooLarge": "文件超过 25MB",
  "download.timeout": "请求超时",
  "download.tooManyRedirects": "跳转次数过多",
  "download.noFileOnLanding": "落地页里没找到文件地址",
  "download.notInvoiceFile": "返回的不是发票文件",
  "download.failed.one": "跳转 {n} 次到 {host}：{why}{extra}",
  "download.failed.other": "跳转 {n} 次到 {host}：{why}{extra}",

  "parse.fileError": "{name}：{message}",
  "parse.detail": "（{detail}）",
  "parse.listSeparator": "、",
  "parse.notEInvoice": "不是数电票 XML（根节点 {root}）",
  "parse.none": "无",
  "parse.xmlNoNumber": "XML 里没有有效的发票号码",
  "parse.xmlNoSeller": "XML 里没有销售方名称",
  "parse.pdfNoText": "PDF 没有可用文字层（扫描件暂不支持）",
  "parse.pdfNotInvoice": "PDF 不是可识别的发票",
  "parse.pdfNoNumber": "PDF 里没有有效的发票号码",
  "parse.pdfNoDate": "PDF 里没有有效的开票日期",
  "parse.pdfTable": "PDF 发票表格结构无法识别",
  "parse.pdfNoAmounts": "PDF 里没有完整的金额与税额",
  "parse.pdfNoParties": "PDF 里没有完整的购买方或销售方名称",
  "parse.pdfEncrypted": "PDF 已加密，无法读取",
  "parse.pdfFailed": "PDF 解析失败：{message}",
};

export const dictionaries = { en, zh } as const;
export type Locale = keyof typeof dictionaries;

let current: Locale = "en";

/** 按 Obsidian 的语言代码选字典：zh 开头用简体中文，其他一律英文。 */
export function setLocale(lang: string | null | undefined): Locale {
  current = lang?.toLowerCase().startsWith("zh") ? "zh" : "en";
  return current;
}

export function getLocale(): Locale {
  return current;
}

type Vars = Record<string, string | number>;

/** 只替换传入了的 `{name}`；设置说明里的 `{year}` 之类模板占位符原样保留。 */
function format(template: string, vars?: Vars): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

export function t(key: Key, vars?: Vars): string {
  const dict: Record<Key, string> = dictionaries[current];
  return format(dict[key] ?? en[key], vars);
}

/** 带数量的文案：按 n 选 `.one` / `.other`，并把 n 填进 `{n}`。 */
export function tn(key: PluralKey, n: number, vars?: Vars): string {
  return t(`${key}.${n === 1 ? "one" : "other"}` as Key, { ...vars, n });
}
