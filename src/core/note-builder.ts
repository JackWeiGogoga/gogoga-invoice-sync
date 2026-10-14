/**
 * 发票笔记：路径与内容。
 *
 * 沿用 fav-sync 的约定：机器区在 %% invoice-sync:start/end %% 之间，
 * 标记之外（包括 reimbursed 等你自己改的字段）永不覆盖。
 * 发票内容一经开出就不会变，所以 v0.1 只新建、不改写已有笔记。
 */
import type { Invoice, InvoiceBundle, InvoiceItem } from "../invoice/model";
import type { InvoiceSyncSettings } from "../settings";
import { applyTemplate, joinPath, money, sanitizeName, toDateTimeStr, yamlList, yamlString } from "./util";

// 用 Obsidian 注释而不是 HTML 注释：实时预览里不显示
const START = "%% invoice-sync:start %%";
const END = "%% invoice-sync:end %%";
export const USER_SECTION = "备注";

function vars(inv: Invoice): Record<string, string> {
  return {
    date: inv.issued,
    year: inv.issued.slice(0, 4),
    month: inv.issued.slice(5, 7),
    seller: inv.seller.name,
    buyer: inv.buyer.name,
    total: money(inv.total),
    number: inv.number,
    category: inv.category,
    kind: inv.kind,
  };
}

function renderDir(template: string, v: Record<string, string>): string {
  return template
    .split("/")
    .map((seg) => applyTemplate(seg, v).trim())
    .filter(Boolean)
    .join("/");
}

export interface NotePaths {
  dir: string;
  note: string;
  filesDir: string;
  /** 各原始文件的目标路径。 */
  xml?: string;
  pdf?: string;
  ofd?: string;
  extras: string[];
}

export function pathsFor(bundle: InvoiceBundle, s: InvoiceSyncSettings): NotePaths {
  const inv = bundle.invoice;
  const v = vars(inv);
  const dir = joinPath(s.rootFolder, renderDir(s.dirTemplate, v));
  const base = sanitizeName(applyTemplate(s.fileTemplate, v).trim() || inv.number, 100);
  const filesDir = joinPath(s.filesFolder, v.year);
  // 原始文件用发票号码命名：唯一且稳定，不受文件名模板变化影响
  const file = (ext: string, suffix = "") => joinPath(filesDir, `${inv.number}${suffix}.${ext}`);
  return {
    dir,
    note: joinPath(dir, `${base}.md`),
    filesDir,
    xml: bundle.xml ? file("xml") : undefined,
    pdf: bundle.pdf ? file("pdf") : undefined,
    ofd: bundle.ofd ? file("ofd") : undefined,
    extras: bundle.extras.map((f, i) => file(f.kind === "other" ? "bin" : f.kind, `-附件${i + 1}`)),
  };
}

/** Markdown 表格单元格：项目名里的 `*分类*` 会被当成斜体，要转义。 */
function cell(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\*/g, "\\*").replace(/\s+/g, " ");
}

function rate(r?: number): string {
  if (r === undefined) return "";
  return `${Math.round(r * 10000) / 100}%`;
}

/** 数量原样；单价在 XML 里常带十几位小数，展示时保留两位。 */
function fmtNum(v?: number, digits?: number): string {
  if (v === undefined) return "";
  if (Number.isInteger(v)) return String(v);
  return digits === undefined ? String(Math.round(v * 1e6) / 1e6) : v.toFixed(digits);
}

export interface NoteFlags {
  /** 抬头与设置里的不符。 */
  buyerMismatch?: boolean;
  /** 金额不自洽的说明。 */
  amountIssue?: string | null;
  source?: string;
  received?: string;
  embedPdf: boolean;
}

function frontmatter(inv: Invoice, p: NotePaths, flags: NoteFlags): string {
  const files = [p.pdf, p.ofd, p.xml, ...p.extras].filter((x): x is string => !!x).map((x) => `[[${x}]]`);
  const lines = [
    "---",
    "type: invoice",
    // 20 位号码必须加引号，否则会被当成数字丢精度
    `invoice_no: ${yamlString(inv.number)}`,
    `kind: ${yamlString(inv.red ? `${inv.kind}（红字）` : inv.kind)}`,
    `issued: ${inv.issued}`,
    `month: ${yamlString(inv.issued.slice(0, 7))}`,
    `seller: ${yamlString(inv.seller.name)}`,
  ];
  if (inv.seller.taxId) lines.push(`seller_tax_id: ${yamlString(inv.seller.taxId)}`);
  lines.push(`buyer: ${yamlString(inv.buyer.name)}`);
  if (inv.buyer.taxId) lines.push(`buyer_tax_id: ${yamlString(inv.buyer.taxId)}`);
  lines.push(`amount: ${money(inv.amount)}`, `tax: ${money(inv.tax)}`, `total: ${money(inv.total)}`);
  lines.push(`category: ${yamlString(inv.category)}`);
  if (flags.source) lines.push(`source: ${yamlString(flags.source)}`);
  if (flags.received) lines.push(`received: ${toDateTimeStr(flags.received)}`);
  if (flags.buyerMismatch) lines.push(`check: ${yamlString("抬头不符")}`);
  else if (flags.amountIssue) lines.push(`check: ${yamlString("金额异常")}`);
  lines.push(`files: ${yamlList(files)}`);
  lines.push(`tags: ${yamlList(["invoice", `invoice/${inv.category}`])}`);
  // 原生 Checkbox：未勾选表示未报销，只在新建时写一次。
  lines.push("reimbursed: false");
  lines.push("---");
  return lines.join("\n");
}

function machineBody(inv: Invoice, p: NotePaths, flags: NoteFlags): string {
  const out: string[] = [];
  out.push(`# ${inv.seller.name} ¥${money(inv.total)}`);
  out.push("");
  if (flags.buyerMismatch) {
    out.push(`> [!warning] 抬头不符：购买方是「${inv.buyer.name}」，不在你设置的抬头里`);
    out.push("");
  }
  if (flags.amountIssue) {
    out.push(`> [!warning] 金额异常：${flags.amountIssue}`);
    out.push("");
  }
  if (inv.red) {
    out.push("> [!note] 这是一张红字发票（冲红），金额为负");
    out.push("");
  }

  out.push("> [!info] 发票信息");
  out.push(`> - 发票号码：${inv.number}`);
  out.push(`> - 票种：${inv.kind}　开票日期：${inv.issued}`);
  out.push(`> - 销售方：${inv.seller.name}${inv.seller.taxId ? `（${inv.seller.taxId}）` : ""}`);
  out.push(`> - 购买方：${inv.buyer.name}${inv.buyer.taxId ? `（${inv.buyer.taxId}）` : ""}`);
  out.push(`> - 金额 ${money(inv.amount)} + 税额 ${money(inv.tax)} = **价税合计 ¥${money(inv.total)}**`);
  out.push("");

  if (inv.items.length > 0) {
    // 全空的列（很多发票没有规格、单位）不画，免得表格撑出页面
    const all: Array<{ head: string; align: string; get: (it: InvoiceItem) => string }> = [
      { head: "项目", align: "---", get: (it) => cell(it.name) },
      { head: "规格", align: "---", get: (it) => cell(it.spec ?? "") },
      { head: "单位", align: "---", get: (it) => cell(it.unit ?? "") },
      { head: "数量", align: "---:", get: (it) => fmtNum(it.quantity) },
      { head: "单价", align: "---:", get: (it) => fmtNum(it.unitPrice, 2) },
      { head: "金额", align: "---:", get: (it) => money(it.amount) },
      { head: "税率", align: "---:", get: (it) => rate(it.taxRate) },
      { head: "税额", align: "---:", get: (it) => money(it.tax) },
    ];
    const cols = all.filter((c) => inv.items.some((it) => c.get(it) !== ""));
    out.push(`| ${cols.map((c) => c.head).join(" | ")} |`);
    out.push(`| ${cols.map((c) => c.align).join(" | ")} |`);
    for (const it of inv.items) out.push(`| ${cols.map((c) => c.get(it)).join(" | ")} |`);
    out.push("");
  }

  if (p.pdf && flags.embedPdf) {
    // 发票是横版 A5，450 高刚好放下一页
    out.push(`![[${p.pdf}#height=450]]`);
    out.push("");
  }
  const links = [
    p.pdf ? `[[${p.pdf}|PDF]]` : "",
    p.ofd ? `[[${p.ofd}|OFD]]` : "",
    p.xml ? `[[${p.xml}|XML]]` : "",
    ...p.extras.map((x, i) => `[[${x}|附件${i + 1}]]`),
  ].filter(Boolean);
  out.push(`原始文件：${links.join(" · ")}`);
  return out.join("\n");
}

export function buildNote(inv: Invoice, p: NotePaths, flags: NoteFlags): string {
  return [frontmatter(inv, p, flags), "", START, machineBody(inv, p, flags), END, "", `## ${USER_SECTION}`, "", ""].join("\n");
}
