/** 一张发票的结构化内容，来自数电票 XML。 */
export interface Invoice {
  /** 20 位数电发票号码；旧版发票为「代码+号码」。 */
  number: string;
  /** 票种，如「数电普票」「数电专票」。 */
  kind: string;
  /** 红字发票（冲红）金额为负。 */
  red: boolean;
  /** 开票日期 YYYY-MM-DD。 */
  issued: string;
  seller: Party;
  buyer: Party;
  /** 合计金额（不含税）。 */
  amount: number;
  /** 合计税额。 */
  tax: number;
  /** 价税合计。 */
  total: number;
  items: InvoiceItem[];
  /** 类别：由税收分类编码或项目名前缀推出。 */
  category: string;
  drawer?: string;
}

export interface Party {
  name: string;
  taxId?: string;
}

export interface InvoiceItem {
  /** 原始项目名，含 `*分类*` 前缀。 */
  name: string;
  spec?: string;
  unit?: string;
  quantity?: number;
  unitPrice?: number;
  amount: number;
  taxRate?: number;
  tax: number;
  /** 19 位税收分类编码。 */
  taxCode?: string;
}

/** 一张发票连同它的原始文件。 */
export interface InvoiceBundle {
  invoice: Invoice;
  /** XML 优先；只有 PDF 的转发邮件允许没有 XML。 */
  xml?: FileBlob;
  pdf?: FileBlob;
  ofd?: FileBlob;
  /** 同一封邮件里的其它随附文件，如滴滴的行程单 PDF。 */
  extras: FileBlob[];
  /** 从附件拿到，还是跟随链接下载。 */
  via: "attachment" | "link" | "import";
}

export type FileKind = "xml" | "pdf" | "ofd" | "zip" | "img" | "other";

export interface FileBlob {
  kind: FileKind;
  name: string;
  data: Uint8Array;
}
