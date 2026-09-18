/**
 * PDF 形态分析：有没有文本层、是什么票种、关键字段能不能用正则直接抓到。
 *
 * 只输出结构特征（布尔值、计数、票种名），不输出发票号码、金额等具体值。
 */
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

const require = createRequire(import.meta.url);
const pdfjsEntry = require.resolve("pdfjs-dist/legacy/build/pdf.mjs");
const pdfjsRoot = dirname(dirname(dirname(pdfjsEntry)));
const pdfjs = await import(pdfjsEntry);

/** 只看前几页就够判断形态了。 */
const MAX_PAGES = 3;

/**
 * 票种识别，按从具体到笼统的顺序匹配（规范化、去空白后的文本）。
 * 「行程单」要排在航空行程单之后，否则会被它抢先命中。
 */
const KINDS = [
  [/电子发票\(普通发票\)/, "数电普票"],
  [/电子发票\(增值税专用发票\)/, "数电专票"],
  [/电子发票\(铁路电子客票\)/, "铁路电子客票"],
  [/电子发票\(航空运输电子客票行程单\)/, "航空电子行程单"],
  [/增值税电子普通发票/, "增值税电子普票(旧版)"],
  [/增值税电子专用发票/, "增值税电子专票(旧版)"],
  [/增值税普通发票/, "增值税普票"],
  [/增值税专用发票/, "增值税专票"],
  [/通行费/, "通行费发票"],
  [/行程单/, "行程单(非发票)"],
  [/收据|回单|小票/, "收据/回单"],
];

/** 18 位统一社会信用代码（不含 I O S V Z）。 */
// 两侧不能再接字母数字，否则 20 位数电发票号码里会截出一段假税号
const TAX_ID = /(?<![0-9A-Z])[0-9A-HJ-NPQRTUWXY]{2}\d{6}[0-9A-HJ-NPQRTUWXY]{10}(?![0-9A-Z])/g;

/** 康熙部首与 CJK 部首补充区：长得像汉字，编码不同，会让正则失配。 */
const RADICALS = /[\u2E80-\u2EFF\u2F00-\u2FDF]/g;

/**
 * 中文 PDF 抽出的文字常见两类「形似字」问题：
 * 1. 字体的 ToUnicode 把「子」「日」映射成康熙部首 ⼦ ⽇
 * 2. 全角标点 ：（）￥
 * NFKC 能把两者都归一，之后正则只需写半角形式。
 */
export function normalizeText(raw) {
  return raw.normalize("NFKC");
}

export async function analyzePdf(buf) {
  const task = pdfjs.getDocument({
    data: new Uint8Array(buf),
    cMapUrl: join(pdfjsRoot, "cmaps") + "/",
    cMapPacked: true,
    standardFontDataUrl: join(pdfjsRoot, "standard_fonts") + "/",
    isEvalSupported: false,
    verbosity: 0,
  });
  try {
    const doc = await task.promise;
    let raw = "";
    const pages = Math.min(doc.numPages, MAX_PAGES);
    for (let p = 1; p <= pages; p += 1) {
      const page = await doc.getPage(p);
      const tc = await page.getTextContent();
      raw += tc.items.map((it) => it.str ?? "").join(" ") + "\n";
    }

    const text = normalizeText(raw);
    const compact = text.replace(/\s+/g, "");
    const kind = KINDS.find(([re]) => re.test(compact))?.[1];
    const cjk = (compact.match(/[\u4E00-\u9FFF]/g) ?? []).length;

    return {
      pages: doc.numPages,
      textLen: compact.length,
      hasText: compact.length > 20,
      kind: kind ?? (compact.length > 20 ? "未识别" : "无文本层"),
      // 原始文本里的部首字符数：>0 说明必须先规范化再匹配
      radicals: (raw.match(RADICALS) ?? []).length,
      cjk,
      // 标签与号码紧挨着 → 正则一步到位；只找得到裸号码 → 文本顺序被打乱，需要按坐标取
      invoiceNoAdjacent: /发票号码:?\d{8,20}/.test(compact),
      has20Digits: /(?<!\d)\d{20}(?!\d)/.test(text),
      hasTotal: /价税合计/.test(compact),
      // 在保留空格的文本上匹配：去掉空白后税号可能和相邻数字粘在一起
      hasTaxIdCount: new Set(text.match(TAX_ID) ?? []).size,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { error: msg.slice(0, 120), encrypted: /password/i.test(msg) };
  } finally {
    await task.destroy().catch(() => {});
  }
}
