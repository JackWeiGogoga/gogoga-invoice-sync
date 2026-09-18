/**
 * 数电票 XML（国标 EInvoice 结构）→ Invoice。
 *
 * 字段路径来自真实样本（票通、百望、美团等平台开出的数电普票），
 * 只依赖国标字段，不依赖平台差异。
 */
import type { Invoice, InvoiceItem } from "./model";
import { child, children, decodeXmlBytes, parseXml, text, type XmlNode } from "./xml";

export class InvoiceParseError extends Error {}

/**
 * 税收分类编码 → 类别（最长前缀匹配）。
 * 只收录核实过的编码；其余退回项目名的 `*分类*` 前缀，宁可粗也不分错。
 */
const TAX_CODE_CATEGORIES: Array<[string, string]> = [
  ["3070401", "餐饮"],
  ["3070402", "住宿"],
];

/** 项目名前缀太笼统时不拿来当类别。 */
const GENERIC_PREFIXES = new Set(["生产生活服务", "现代服务", "生活服务"]);

function num(s: string): number {
  const v = Number.parseFloat(s);
  return Number.isFinite(v) ? v : 0;
}

function optNum(s: string): number | undefined {
  if (!s.trim()) return undefined;
  const v = Number.parseFloat(s);
  return Number.isFinite(v) ? v : undefined;
}

function opt(s: string): string | undefined {
  return s.trim() || undefined;
}

/** `*餐饮服务*餐费` → `餐饮服务`。 */
export function itemPrefix(name: string): string | undefined {
  return /^\*([^*]+)\*/.exec(name.trim())?.[1];
}

export function categoryOf(items: InvoiceItem[]): string {
  for (const item of items) {
    const code = item.taxCode ?? "";
    const hit = TAX_CODE_CATEGORIES.filter(([p]) => code.startsWith(p)).sort((a, b) => b[0].length - a[0].length)[0];
    if (hit) return hit[1];
  }
  for (const item of items) {
    const p = itemPrefix(item.name);
    if (p && !GENERIC_PREFIXES.has(p)) return p;
  }
  const generic = items.map((i) => itemPrefix(i.name)).find(Boolean);
  return generic ?? "其他";
}

/** `电子发票` + `普通发票` → 数电普票；其余照原文拼出来。 */
function kindOf(root: XmlNode): string {
  const labels = child(root, "Header/InherentLabel");
  const type = text(labels, "EInvoiceType/LabelName");
  const vat = text(labels, "GeneralOrSpecialVAT/LabelName");
  if (type === "电子发票" && vat === "普通发票") return "数电普票";
  if (type === "电子发票" && vat === "专用发票") return "数电专票";
  return `${type}${vat}` || "电子发票";
}

/** IssueTime 有的平台带时分秒、有的只有日期，统一取日期。 */
function dateOf(s: string): string {
  const m = /(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : "";
}

function itemOf(node: XmlNode): InvoiceItem {
  return {
    name: text(node, "ItemName"),
    spec: opt(text(node, "SpecMod")),
    unit: opt(text(node, "MeaUnits")),
    quantity: optNum(text(node, "Quantity")),
    unitPrice: optNum(text(node, "UnPrice")),
    amount: num(text(node, "Amount")),
    taxRate: optNum(text(node, "TaxRate")),
    tax: num(text(node, "ComTaxAm")),
    taxCode: opt(text(node, "TaxClassificationCode")),
  };
}

export function parseEInvoice(data: Uint8Array): Invoice {
  const root = parseXml(decodeXmlBytes(data));
  if (!root || root.name !== "EInvoice") {
    throw new InvoiceParseError(`不是数电票 XML（根节点 ${root?.name ?? "无"}）`);
  }
  const body = child(root, "EInvoiceData");
  const basic = child(body, "BasicInformation");

  const number = text(root, "TaxSupervisionInfo/InvoiceNumber") || text(root, "Header/EIid");
  if (!/^\d{8,20}$/.test(number)) throw new InvoiceParseError("XML 里没有有效的发票号码");

  const items = children(body, "IssuItemInformation").map(itemOf);
  const invoice: Invoice = {
    number,
    kind: kindOf(root),
    // 蓝字发票标志：Y 为正常发票，N 为红字（冲红）
    red: text(root, "Header/InherentLabel/InIssuType/LabelCode") === "N",
    issued: dateOf(text(root, "TaxSupervisionInfo/IssueTime") || text(basic, "RequestTime")),
    seller: {
      name: text(body, "SellerInformation/SellerName"),
      taxId: opt(text(body, "SellerInformation/SellerIdNum")),
    },
    buyer: {
      name: text(body, "BuyerInformation/BuyerName"),
      taxId: opt(text(body, "BuyerInformation/BuyerIdNum")),
    },
    amount: num(text(basic, "TotalAmWithoutTax")),
    tax: num(text(basic, "TotalTaxAm")),
    total: num(text(basic, "TotalTax-includedAmount")),
    items,
    category: categoryOf(items),
    drawer: opt(text(basic, "Drawer")),
  };
  if (!invoice.seller.name) throw new InvoiceParseError("XML 里没有销售方名称");
  return invoice;
}

/**
 * 金额自洽校验：金额 + 税额 = 价税合计，明细合计 = 金额。
 * 返回问题描述，没问题返回 null。
 */
export function checkAmounts(inv: Invoice): string | null {
  const cents = (v: number) => Math.round(v * 100);
  if (cents(inv.amount) + cents(inv.tax) !== cents(inv.total)) {
    return `金额 ${inv.amount} + 税额 ${inv.tax} ≠ 价税合计 ${inv.total}`;
  }
  if (inv.items.length > 0) {
    const sum = inv.items.reduce((s, i) => s + cents(i.amount), 0);
    if (sum !== cents(inv.amount)) return `明细金额合计 ${sum / 100} ≠ 金额 ${inv.amount}`;
  }
  return null;
}
