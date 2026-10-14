/**
 * 带文字层的中国电子发票 PDF → Invoice。
 *
 * PDF 的文本读取顺序并不可靠，所以这里同时使用文字和坐标：标题区取号码与日期，
 * 买卖方按页面左右半区识别，表格按表头坐标分列。扫描件暂不做 OCR。
 */
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { categoryOf, InvoiceParseError } from "./einvoice";
import type { Invoice, InvoiceItem } from "./model";

type PdfWorkerGlobal = typeof globalThis & { pdfjsWorker?: { WorkerMessageHandler: unknown } };

// PDF.js 的 fake worker 会读写 globalThis.pdfjsWorker，而 Obsidian 自己的 PDF 查看器
// 也使用这个全局名。静态导入 worker 会在插件加载时覆盖 Obsidian 的 worker，造成所有
// 内嵌 PDF 显示 0 / 0。只在解析纯 PDF 发票的短暂窗口内装入 worker，并完整恢复现场。
// 串行化可避免两封纯 PDF 邮件同时解析时互相恢复错全局值。
let pdfWorkerQueue: Promise<void> = Promise.resolve();

async function withIsolatedPdfWorker<T>(run: () => Promise<T>): Promise<T> {
  let unlock!: () => void;
  const turn = pdfWorkerQueue;
  pdfWorkerQueue = new Promise<void>((resolve) => {
    unlock = resolve;
  });
  await turn;

  const root = globalThis as PdfWorkerGlobal;
  const hadWorker = Object.prototype.hasOwnProperty.call(root, "pdfjsWorker");
  const previousWorker = root.pdfjsWorker;
  try {
    // 动态导入很重要：该模块自身会设置 globalThis.pdfjsWorker。
    const { WorkerMessageHandler } = await import("pdfjs-dist/legacy/build/pdf.worker.mjs");
    root.pdfjsWorker = { WorkerMessageHandler };
    return await run();
  } finally {
    if (hadWorker) root.pdfjsWorker = previousWorker;
    else delete root.pdfjsWorker;
    unlock();
  }
}

interface PdfText {
  text: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface PdfRow {
  y: number;
  items: PdfText[];
}

interface Cluster {
  text: string;
  x: number;
  width: number;
}

const TAX_ID = /(?<![0-9A-Z])[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}(?![0-9A-Z])/;
const MONEY = /[-−]?\d[\d,]*(?:\.\d+)?/g;

function normalizeText(value: string): string {
  return value.normalize("NFKC").replace(/−/g, "-").replace(/[：]/g, ":").trim();
}

function compact(value: string): string {
  return normalizeText(value).replace(/\s+/g, "");
}

function rowsOf(items: PdfText[]): PdfRow[] {
  const rows: PdfRow[] = [];
  for (const item of [...items].sort((a, b) => b.y - a.y || a.x - b.x)) {
    let row = rows.find((candidate) => Math.abs(candidate.y - item.y) <= Math.max(2.2, item.height * 0.16));
    if (!row) {
      row = { y: item.y, items: [] };
      rows.push(row);
    }
    row.items.push(item);
    row.items.sort((a, b) => a.x - b.x);
  }
  return rows.sort((a, b) => b.y - a.y);
}

function rowText(row: PdfRow, predicate?: (item: PdfText) => boolean): string {
  return row.items.filter((item) => !predicate || predicate(item)).map((item) => item.text).join("");
}

function clustersOf(row: PdfRow): Cluster[] {
  const clusters: Cluster[] = [];
  for (const item of row.items) {
    const prev = clusters.at(-1);
    const gap = prev ? item.x - (prev.x + prev.width) : Number.POSITIVE_INFINITY;
    if (prev && gap <= Math.max(10.5, item.height * 0.8)) {
      prev.text += item.text;
      prev.width = Math.max(prev.width, item.x + item.width - prev.x);
    } else {
      clusters.push({ text: item.text, x: item.x, width: item.width });
    }
  }
  return clusters;
}

function nums(value: string): number[] {
  return (normalizeText(value).match(MONEY) ?? [])
    .map((part) => Number(part.replace(/,/g, "")))
    .filter(Number.isFinite);
}

function firstMatch(rows: PdfRow[], label: RegExp, value: RegExp): string | undefined {
  for (const row of rows) {
    const text = compact(rowText(row));
    if (!label.test(text)) continue;
    const hit = value.exec(text);
    if (hit?.[1]) return hit[1];
  }
  return undefined;
}

function partyName(rows: PdfRow[], side: "left" | "right", pageWidth: number, tableY: number): string {
  const mid = pageWidth / 2;
  const inSide = (item: PdfText) => (side === "left" ? item.x < mid : item.x >= mid);
  for (const row of rows) {
    if (row.y <= tableY || row.y > tableY + 150) continue;
    const text = compact(rowText(row, inSide));
    if (!text.includes("名称")) continue;
    const value = text.replace(/^.*?名称:?/, "").trim();
    if (value) return value;
  }
  return "";
}

function partyTaxId(items: PdfText[], side: "left" | "right", pageWidth: number, tableY: number): string | undefined {
  const mid = pageWidth / 2;
  const selected = items
    .filter((item) => item.y > tableY && item.y <= tableY + 150 && (side === "left" ? item.x < mid : item.x >= mid))
    .map((item) => compact(item.text))
    .join("");
  return TAX_ID.exec(selected)?.[0];
}

type ItemField = "name" | "spec" | "unit" | "quantity" | "unitPrice" | "amount" | "taxRate" | "tax";

function headerField(label: string): ItemField | undefined {
  const value = compact(label);
  if (value.includes("项目名称")) return "name";
  if (value.includes("规格型号")) return "spec";
  if (value === "单位") return "unit";
  if (value === "数量") return "quantity";
  if (value === "单价") return "unitPrice";
  if (value === "金额") return "amount";
  if (value.includes("税率") || value.includes("征收率")) return "taxRate";
  if (value === "税额") return "tax";
  return undefined;
}

function setNumeric(item: InvoiceItem, field: ItemField, value: number): void {
  if (field === "quantity") item.quantity = value;
  else if (field === "unitPrice") item.unitPrice = value;
  else if (field === "amount") item.amount = value;
  else if (field === "taxRate") item.taxRate = value / 100;
  else if (field === "tax") item.tax = value;
}

function parseItems(rows: PdfRow[], header: PdfRow, total: PdfRow): InvoiceItem[] {
  const anchors = clustersOf(header)
    .map((cluster) => ({ field: headerField(cluster.text), x: cluster.x }))
    .filter((entry): entry is { field: ItemField; x: number } => !!entry.field)
    .sort((a, b) => a.x - b.x);
  if (!anchors.some((entry) => entry.field === "name") || !anchors.some((entry) => entry.field === "amount")) return [];

  const itemRows = rows.filter((row) => row.y < header.y - 2 && row.y > total.y + 2);
  const parsed: InvoiceItem[] = [];
  for (const row of itemRows) {
    const item: InvoiceItem = { name: "", amount: 0, tax: 0 };
    let meaningful = false;
    for (const cluster of clustersOf(row)) {
      const anchorIndex = anchors.reduce((best, candidate, index) =>
        Math.abs(candidate.x - cluster.x) < Math.abs(anchors[best]!.x - cluster.x) ? index : best, 0);
      const anchor = anchors[anchorIndex]!;
      const value = normalizeText(cluster.text);
      if (anchor.field === "name") {
        item.name += value;
        meaningful ||= !!value;
      } else if (anchor.field === "spec") {
        item.spec = `${item.spec ?? ""}${value}` || undefined;
      } else if (anchor.field === "unit") {
        item.unit = `${item.unit ?? ""}${value}` || undefined;
      } else {
        const values = nums(value);
        for (let i = 0; i < values.length; i += 1) {
          const target = anchors[anchorIndex + i]?.field;
          if (target) setNumeric(item, target, values[i]!);
        }
        meaningful ||= values.length > 0;
      }
    }
    if (meaningful && item.name && (item.amount !== 0 || item.tax !== 0 || item.taxRate !== undefined)) parsed.push(item);
  }
  return parsed;
}

function kindOf(text: string): string {
  if (/电子发票\(增值税专用发票\)/.test(text)) return "数电专票";
  if (/电子发票\(普通发票\)/.test(text)) return "数电普票";
  if (/增值税电子专用发票/.test(text)) return "增值税电子专票(旧版)";
  if (/增值税电子普通发票/.test(text)) return "增值税电子普票(旧版)";
  return "电子发票";
}

export async function parsePdfInvoice(data: Uint8Array): Promise<Invoice> {
  return withIsolatedPdfWorker(async () => {
    const task = pdfjs.getDocument({ data: data.slice(), verbosity: 0 });
    try {
      const doc = await task.promise;
    const page = await doc.getPage(1);
    const viewport = page.getViewport({ scale: 1 });
    const content = await page.getTextContent();
    const items: PdfText[] = content.items.flatMap((raw) => {
      if (!("str" in raw)) return [];
      const text = normalizeText(raw.str);
      if (!text) return [];
      return [{ text, x: raw.transform[4], y: raw.transform[5], width: raw.width, height: raw.height }];
    });
    if (items.length < 10) throw new InvoiceParseError("PDF 没有可用文字层（扫描件暂不支持）");

    const rows = rowsOf(items);
    const all = compact(items.map((item) => item.text).join(""));
    if (!/发票/.test(all)) throw new InvoiceParseError("PDF 不是可识别的发票");

    const number = firstMatch(rows, /发票号码/, /发票号码:?(\d{8,20})/);
    if (!number) throw new InvoiceParseError("PDF 里没有有效的发票号码");
    const dateRow = rows.find((row) => /开票日期/.test(compact(rowText(row))));
    const issuedMatch = dateRow ? /开票日期:?(\d{4})年?(\d{2})月?(\d{2})日?/.exec(compact(rowText(dateRow))) : undefined;
    const issued = issuedMatch ? `${issuedMatch[1]}-${issuedMatch[2]}-${issuedMatch[3]}` : "";
    if (!issued) throw new InvoiceParseError("PDF 里没有有效的开票日期");

    const header = rows.find((row) => /项目名称/.test(compact(rowText(row))));
    const totalRow = rows.find((row) => /合计/.test(compact(rowText(row))) && !/价税合计/.test(compact(rowText(row))));
    const grandRow = rows.find((row) => /价税合计/.test(compact(rowText(row))));
    if (!header || !totalRow || !grandRow) throw new InvoiceParseError("PDF 发票表格结构无法识别");

    const totals = nums(rowText(totalRow));
    const grand = nums(rowText(grandRow)).at(-1);
    if (totals.length < 2 || grand === undefined) throw new InvoiceParseError("PDF 里没有完整的金额与税额");

    const buyer = partyName(rows, "left", viewport.width, header.y);
    const seller = partyName(rows, "right", viewport.width, header.y);
    if (!buyer || !seller) throw new InvoiceParseError("PDF 里没有完整的购买方或销售方名称");

    const itemsParsed = parseItems(rows, header, totalRow);
    const invoice: Invoice = {
      number,
      kind: kindOf(all),
      red: grand < 0 || /红字发票/.test(all),
      issued,
      seller: { name: seller, taxId: partyTaxId(items, "right", viewport.width, header.y) },
      buyer: { name: buyer, taxId: partyTaxId(items, "left", viewport.width, header.y) },
      amount: totals[0]!,
      tax: totals.at(-1)!,
      total: grand,
      items: itemsParsed,
      category: itemsParsed.some((item) => /餐饮|餐费/.test(item.name)) ? "餐饮" : categoryOf(itemsParsed),
    };
      return invoice;
    } catch (error) {
      if (error instanceof InvoiceParseError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      if (/password/i.test(message)) throw new InvoiceParseError("PDF 已加密，无法读取");
      throw new InvoiceParseError(`PDF 解析失败：${message}`);
    } finally {
      await task.destroy().catch(() => {});
    }
  });
}
