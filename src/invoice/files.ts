/**
 * 文件识别与归组：把附件/下载/导入得到的一堆文件，整理成「一张发票 + 它的 PDF/OFD」。
 *
 * 类型一律按文件头判断，扩展名只作辅助——转发和下载时文件名经常被改坏。
 */
import { unzipSync } from "fflate";
import type { FileBlob, FileKind, InvoiceBundle } from "./model";
import { InvoiceParseError, parseEInvoice } from "./einvoice";
import { parsePdfInvoice } from "./pdf";
import { t } from "../i18n";

const MAX_DEPTH = 3;
/** 随发票附带的非发票文件。 */
const SUPPLEMENT = /行程|明细|清单|报销单|对账/;
/** ZIP 里单个文件的上限，防止压缩炸弹。 */
const MAX_INNER = 25 * 1024 * 1024;

function extOf(name: string): string {
  return /\.([a-z0-9]{1,5})$/i.exec(name)?.[1]?.toLowerCase() ?? "";
}

function startsWith(data: Uint8Array, sig: number[]): boolean {
  if (data.length < sig.length) return false;
  return sig.every((b, i) => data[i] === b);
}

function hasPdfMagic(data: Uint8Array): boolean {
  // 规范允许 %PDF 出现在前 1KB 内
  const head = data.subarray(0, 1024);
  for (let i = 0; i + 3 < head.length; i += 1) {
    if (head[i] === 0x25 && head[i + 1] === 0x50 && head[i + 2] === 0x44 && head[i + 3] === 0x46) return true;
  }
  return false;
}

function zipNames(data: Uint8Array): string[] | null {
  const names: string[] = [];
  try {
    unzipSync(data, {
      filter: (f) => {
        names.push(f.name);
        return false;
      },
    });
    return names;
  } catch {
    return null;
  }
}

export function sniff(data: Uint8Array, name: string): FileKind {
  const ext = extOf(name);
  if (hasPdfMagic(data)) return "pdf";
  if (startsWith(data, [0x50, 0x4b, 0x03, 0x04])) {
    if (ext === "ofd") return "ofd";
    // OFD 本身也是 ZIP，根目录有 OFD.xml
    return zipNames(data)?.some((n) => /^OFD\.xml$/i.test(n)) ? "ofd" : "zip";
  }
  if (startsWith(data, [0x89, 0x50, 0x4e, 0x47]) || startsWith(data, [0xff, 0xd8, 0xff])) return "img";
  const lead = new TextDecoder("latin1").decode(data.subarray(0, 256)).replace(/^\xEF\xBB\xBF/, "").trimStart();
  if (lead.startsWith("<?xml") || (ext === "xml" && lead.startsWith("<"))) return "xml";
  return "other";
}

/** 识别类型并展开 ZIP（可嵌套），返回叶子文件。 */
export function expandFiles(files: Array<{ name: string; data: Uint8Array }>, depth = 0): FileBlob[] {
  const out: FileBlob[] = [];
  for (const f of files) {
    const kind = sniff(f.data, f.name);
    if (kind !== "zip") {
      out.push({ kind, name: f.name, data: f.data });
      continue;
    }
    if (depth >= MAX_DEPTH) continue;
    let entries: Record<string, Uint8Array> = {};
    try {
      entries = unzipSync(f.data, {
        filter: (e) => !e.name.endsWith("/") && e.originalSize <= MAX_INNER && /\.(xml|pdf|ofd|zip)$/i.test(e.name),
      });
    } catch {
      out.push({ kind: "other", name: f.name, data: f.data });
      continue;
    }
    const inner = Object.entries(entries).map(([name, data]) => ({ name: name.split("/").pop() ?? name, data }));
    out.push(...expandFiles(inner, depth + 1));
  }
  return out;
}

export interface Grouped {
  bundles: InvoiceBundle[];
  /** 找不到归属的 PDF/OFD（多张发票且文件名里没有号码时）。 */
  orphans: FileBlob[];
  /** 解析失败的 XML 及原因。 */
  errors: string[];
}

/**
 * 按发票号码归组：每个 XML 是一张发票；PDF/OFD 按文件名里的号码对上，
 * 只有一张发票时直接归给它。
 */
export function groupInvoices(files: FileBlob[], via: InvoiceBundle["via"]): Grouped {
  const bundles: InvoiceBundle[] = [];
  const errors: string[] = [];
  for (const f of files.filter((x) => x.kind === "xml")) {
    try {
      const invoice = parseEInvoice(f.data);
      if (bundles.some((b) => b.invoice.number === invoice.number)) continue;
      bundles.push({ invoice, xml: f, extras: [], via });
    } catch (err) {
      errors.push(t("parse.fileError", { name: f.name, message: err instanceof InvoiceParseError ? err.message : String(err) }));
    }
  }

  const orphans: FileBlob[] = [];
  // 行程单、明细之类排在后面，免得抢占发票本身的 PDF 位置
  const docs = files
    .filter((x) => x.kind === "pdf" || x.kind === "ofd")
    .sort((a, b) => Number(SUPPLEMENT.test(a.name)) - Number(SUPPLEMENT.test(b.name)));
  for (const f of docs) {
    const slot = f.kind as "pdf" | "ofd";
    const byName = bundles.find((b) => f.name.includes(b.invoice.number) && !b[slot]);
    const only = bundles.length === 1 ? bundles[0] : undefined;
    const target = byName ?? (only && !only[slot] && !SUPPLEMENT.test(f.name) ? only : undefined);
    if (target) target[slot] = f;
    else if (only) only.extras.push(f);
    else orphans.push(f);
  }
  return { bundles, orphans, errors };
}

/** XML 缺失时，尝试从带文字层的 PDF 恢复结构化发票。 */
export async function groupPdfInvoices(files: FileBlob[], via: InvoiceBundle["via"]): Promise<Grouped> {
  const bundles: InvoiceBundle[] = [];
  const errors: string[] = [];
  const failed: FileBlob[] = [];
  for (const file of files.filter((entry) => entry.kind === "pdf")) {
    try {
      const invoice = await parsePdfInvoice(file.data);
      if (bundles.some((bundle) => bundle.invoice.number === invoice.number)) continue;
      bundles.push({ invoice, pdf: file, extras: [], via });
    } catch (error) {
      failed.push(file);
      errors.push(t("parse.fileError", { name: file.name, message: error instanceof InvoiceParseError ? error.message : String(error) }));
    }
  }

  const orphans: FileBlob[] = [];
  for (const file of files.filter((entry) => entry.kind === "ofd")) {
    const byName = bundles.find((bundle) => file.name.includes(bundle.invoice.number) && !bundle.ofd);
    const only = bundles.length === 1 ? bundles[0] : undefined;
    const target = byName ?? (only && !only.ofd ? only : undefined);
    if (target) target.ofd = file;
    else orphans.push(file);
  }
  for (const file of failed) {
    if (bundles.length === 1 && SUPPLEMENT.test(file.name)) bundles[0].extras.push(file);
    else orphans.push(file);
  }
  return { bundles, orphans, errors };
}
