/**
 * 单封邮件 → 发票。不碰 vault、不碰 IMAP，方便在 Node 里测试。
 *
 * 顺序：附件里的 XML → 正文下载链接 → 实在不行就交给待处理队列。
 */
import { simpleParser } from "mailparser";
import type { FileBlob, InvoiceBundle } from "../invoice/model";
import { expandFiles, groupInvoices, groupPdfInvoices } from "../invoice/files";
import { downloadFromLink, type Fetcher } from "../invoice/download";
import { candidateLinks, htmlToText } from "../mail/links";
import { t, tn } from "../i18n";

/** 邮箱服务商自己的通知（欢迎信、安全提醒、续费广告）。 */
const SYSTEM_SENDERS = /(^|\.)netease\.com$/i;

export type ProblemReason =
  | "no-xml" // 有 PDF/OFD，但没有 XML，也没能从链接拿到
  | "link-failed" // 有下载链接，但跟不下去
  | "xml-invalid" // XML 解析失败
  | "unmatched-files" // 多张发票时有文件对不上号
  | "amount-mismatch" // 金额不自洽
  | "buyer-mismatch" // 抬头不是自己
  | "import-failed"; // 导入文件夹里的文件处理失败

export interface Problem {
  reason: ProblemReason;
  detail: string;
  /** 让用户手动打开的链接。 */
  link?: string;
  invoiceNo?: string;
}

export interface MailOutcome {
  messageId?: string;
  subject: string;
  from?: string;
  /** 邮件日期 ISO。 */
  date?: string;
  bundles: InvoiceBundle[];
  problems: Problem[];
  /** 不含发票内容、直接忽略的原因。 */
  ignored?: "system" | "no-invoice";
}

export interface PipelineDeps {
  /** 跟随下载链接；不传则不跟随。 */
  fetcher?: Fetcher;
}

/**
 * 不做完整解析，只从邮件头里取 Message-ID。
 * 用于在处理（可能要下载）之前先判断是否处理过。
 */
export function peekMessageId(raw: Uint8Array): string | undefined {
  const head = new TextDecoder("latin1").decode(raw.subarray(0, 64 * 1024));
  const end = head.search(/\r?\n\r?\n/);
  // 折行的头字段先展开
  const headers = (end === -1 ? head : head.slice(0, end)).replace(/\r?\n[ \t]+/g, " ");
  return /^message-id:\s*(\S+)/im.exec(headers)?.[1];
}

function domainOf(addr?: string): string | undefined {
  return addr?.split("@").pop()?.toLowerCase();
}

export async function processMessage(raw: Uint8Array, deps: PipelineDeps = {}): Promise<MailOutcome> {
  const mail = await simpleParser(Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength), {
    skipImageLinks: true,
    skipTextToHtml: true,
    skipTextLinks: true,
  });
  const from = mail.from?.value?.[0]?.address;
  const outcome: MailOutcome = {
    messageId: mail.messageId,
    subject: mail.subject ?? t("mail.noSubject"),
    from,
    date: mail.date?.toISOString(),
    bundles: [],
    problems: [],
  };

  if (SYSTEM_SENDERS.test(domainOf(from) ?? "")) {
    outcome.ignored = "system";
    return outcome;
  }

  const html = typeof mail.html === "string" ? mail.html : "";
  // 很多平台的 text/plain 部分是空的，正文只在 HTML 里
  const text = mail.text?.trim() ? mail.text : htmlToText(html);

  // 1. 附件（mailparser 已经把作为附件转发的 .eml 展开并入）
  const attached = expandFiles(
    (mail.attachments ?? [])
      .filter((a) => !(a.related && a.contentType?.startsWith("image/")))
      .map((a) => ({ name: a.filename ?? "attachment", data: new Uint8Array(a.content) })),
  );
  let grouped = groupInvoices(attached, "attachment");
  collect(outcome, grouped);
  let pdfErrors: string[] = [];
  if (outcome.bundles.length === 0) {
    const pdfGrouped = await groupPdfInvoices(attached, "attachment");
    pdfErrors = pdfGrouped.errors;
    collectPdf(outcome, pdfGrouped);
  }

  // 2. 附件里没有 XML → 跟随下载链接
  const links = candidateLinks(html, text);
  if (outcome.bundles.length === 0 && links.length > 0 && deps.fetcher) {
    const errors: string[] = [];
    for (const link of links.slice(0, 3)) {
      try {
        const files = expandFiles(await downloadFromLink(link.url, deps.fetcher));
        // 附件里已有的 PDF/OFD 也一起参与归组
        grouped = groupInvoices([...files, ...attached.filter((f) => f.kind !== "xml")], "link");
        if (grouped.bundles.length === 0) {
          const pdfGrouped = await groupPdfInvoices([...files, ...attached], "link");
          pdfErrors = pdfGrouped.errors;
          if (pdfGrouped.bundles.length > 0) {
            outcome.problems = outcome.problems.filter((p) => p.reason !== "xml-invalid");
            collectPdf(outcome, pdfGrouped);
            break;
          }
        }
        if (grouped.bundles.length > 0) {
          outcome.problems = outcome.problems.filter((p) => p.reason !== "xml-invalid");
          collect(outcome, grouped);
          break;
        }
        errors.push(pdfErrors[0] ?? t("mail.noInvoiceInDownload"));
      } catch (err) {
        errors.push(err instanceof Error ? err.message : String(err));
      }
    }
    if (outcome.bundles.length === 0) {
      outcome.problems.push({ reason: "link-failed", detail: errors[0] ?? t("mail.downloadFailed"), link: links[0]?.url });
    }
  }

  // 3. 仍然没有发票
  if (outcome.bundles.length === 0 && outcome.problems.length === 0) {
    const docs = attached.filter((f) => f.kind === "pdf" || f.kind === "ofd");
    if (docs.length > 0) {
      outcome.problems.push({
        reason: "no-xml",
        detail: pdfErrors[0] ?? t("mail.attachmentsOnly", { kinds: docs.map((d) => d.kind.toUpperCase()).join(t("parse.listSeparator")) }),
        link: links[0]?.url,
      });
    } else if (links.length > 0) {
      outcome.problems.push({ reason: "link-failed", detail: t("mail.followLinksOff"), link: links[0]?.url });
    } else {
      outcome.ignored = "no-invoice";
    }
  }
  return outcome;
}

function collectPdf(outcome: MailOutcome, grouped: ReturnType<typeof groupInvoices>): void {
  outcome.bundles.push(...grouped.bundles);
  if (grouped.orphans.length > 0 && grouped.bundles.length > 0) {
    outcome.problems.push({
      reason: "unmatched-files",
      detail: tn("mail.unassignedFiles", grouped.orphans.length, {
        names: grouped.orphans.map((file) => file.name).join(t("parse.listSeparator")),
      }),
    });
  }
}

function collect(outcome: MailOutcome, grouped: ReturnType<typeof groupInvoices>): void {
  outcome.bundles.push(...grouped.bundles);
  for (const e of grouped.errors) outcome.problems.push({ reason: "xml-invalid", detail: e });
  // 一张发票都没有时，文件对不上号不是问题本身（缺 XML 才是），交给后面的判断
  if (grouped.orphans.length > 0 && grouped.bundles.length > 0) {
    outcome.problems.push({
      reason: "unmatched-files",
      detail: tn("mail.unmatchedNumbers", grouped.orphans.length, {
        names: grouped.orphans.map((o: FileBlob) => o.name).join(t("parse.listSeparator")),
      }),
    });
  }
}
