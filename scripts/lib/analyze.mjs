/**
 * 单封邮件的形态分析：纯函数，不碰网络，方便离线自测。
 *
 * 只记录结构特征——附件类型、票种、链接模式、是否转发——
 * 不记录发票号码、金额、税号、下载 token 等具体值。
 */
import { simpleParser } from "mailparser";
import { unzipSync } from "fflate";
import { analyzePdf } from "./pdf.mjs";
import { extractLinks, mentionsCode, stripTags } from "./links.mjs";

/** 转发套转发最多拆几层。 */
const MAX_DEPTH = 3;
/** ZIP 里只解压这些，且单个不超过 20MB。 */
const ZIP_INNER = /\.(pdf|ofd|xml|zip)$/i;
const ZIP_INNER_MAX = 20 * 1024 * 1024;

/** 签名排序：文档类在前，杂项在后。 */
const KIND_ORDER = ["pdf", "ofd", "xml", "zip", "img", "archive", "other"];

/** 取可注册域名：a.b.example.com → example.com，x.example.com.cn → example.com.cn。 */
export function baseDomain(addr) {
  if (!addr) return undefined;
  const host = String(addr).toLowerCase().split("@").pop() ?? "";
  const parts = host.split(".").filter(Boolean);
  if (parts.length <= 2) return parts.join(".");
  const [sld, tld] = parts.slice(-2);
  if (tld === "cn" && ["com", "net", "org", "gov", "edu", "ac"].includes(sld)) {
    return parts.slice(-3).join(".");
  }
  return parts.slice(-2).join(".");
}

/** 长数字（号码、金额以外的 id）打码，截断。 */
export function mask(s, max = 60) {
  return String(s ?? "").replace(/\d{6,}/g, "#").slice(0, max);
}

function extOf(name) {
  return /\.([a-z0-9]{1,5})$/i.exec(name ?? "")?.[1]?.toLowerCase();
}

function startsWith(buf, sig) {
  if (buf.length < sig.length) return false;
  for (let i = 0; i < sig.length; i += 1) if (buf[i] !== sig[i]) return false;
  return true;
}

/** 列出 ZIP 里的文件名，不解压。 */
function listZip(buf) {
  const names = [];
  try {
    unzipSync(buf, {
      filter: (f) => {
        names.push(f.name);
        return false;
      },
    });
  } catch {
    return null;
  }
  return names;
}

/** XML 的根节点与前几个子节点名，用来认出数电票 XML 的结构。 */
function xmlShape(buf) {
  const head = new TextDecoder("utf-8", { fatal: false }).decode(buf.subarray(0, 64 * 1024));
  const body = head.replace(/<\?[\s\S]*?\?>/g, "").replace(/<!--[\s\S]*?-->/g, "");
  const tags = [...body.matchAll(/<([\p{L}_][\p{L}\p{N}_:.-]*)/gu)].map((m) => m[1]);
  if (tags.length === 0) return null;
  return { root: tags[0], children: [...new Set(tags.slice(1))].slice(0, 6) };
}

/** 按文件头判断类型，扩展名只作辅助——转发时文件名常被改坏。 */
function sniff(buf, name, contentType) {
  const ext = extOf(name);
  // 少数 PDF 在 %PDF 前面有垃圾字节，规范允许出现在前 1KB 内
  if (buf.subarray(0, 1024).includes(Buffer.from("%PDF"))) return "pdf";
  if (startsWith(buf, [0x50, 0x4b, 0x03, 0x04])) return ext === "ofd" ? "ofd" : "zip-like";
  if (startsWith(buf, [0x89, 0x50, 0x4e, 0x47]) || startsWith(buf, [0xff, 0xd8, 0xff]) || startsWith(buf, [0x47, 0x49, 0x46])) return "img";
  if (contentType?.startsWith("image/")) return "img";
  const lead = buf.subarray(0, 256).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  if (lead.startsWith("<?xml") || (ext === "xml" && lead.startsWith("<"))) return "xml";
  if (ext === "rar" || ext === "7z" || startsWith(buf, [0x52, 0x61, 0x72, 0x21])) return "archive";
  return "other";
}

async function analyzeFile(buf, name, contentType, depth) {
  const rec = { kind: sniff(buf, name, contentType), ext: extOf(name), size: buf.length, name: mask(name, 40) };

  if (rec.kind === "zip-like") {
    const names = listZip(buf) ?? [];
    // OFD 本身也是 ZIP，根目录有 OFD.xml
    if (names.some((n) => /^OFD\.xml$/i.test(n))) {
      rec.kind = "ofd";
      return rec;
    }
    rec.kind = "zip";
    rec.inner = [];
    if (depth >= MAX_DEPTH) return rec;
    let files = {};
    try {
      files = unzipSync(buf, { filter: (f) => ZIP_INNER.test(f.name) && f.originalSize <= ZIP_INNER_MAX });
    } catch {
      rec.zipError = true;
    }
    for (const n of names) {
      const data = files[n];
      if (data) rec.inner.push(await analyzeFile(Buffer.from(data), n, undefined, depth + 1));
      else if (!n.endsWith("/")) rec.inner.push({ kind: "other", ext: extOf(n), name: mask(n, 40), skipped: true });
    }
    return rec;
  }
  if (rec.kind === "pdf") rec.pdf = await analyzePdf(buf);
  if (rec.kind === "xml") rec.xml = xmlShape(buf);
  if (rec.kind === "other") rec.contentType = contentType;
  return rec;
}

/** 转发正文里引用的原始发件人：取第一个「发件人/From:」行里的邮箱。 */
function quotedSender(text) {
  const m = /(?:^|\n)[\s>*]*(?:发件人|From)\s*[:：][^\n]*?([\w.+-]+@[\w-]+(?:\.[\w-]+)+)/i.exec(text ?? "");
  return m?.[1];
}

/**
 * 邮箱服务商自己的通知（欢迎信、安全提醒、续费广告）的发件域。
 * 不含 163.com/126.com：那是个人邮箱，可能是你自己转发过来的。
 */
const SYSTEM_SENDERS = new Set(["netease.com"]);
const subjectOf = (mail) => mail.subject ?? "";

const FWD_SUBJECT = /^\s*(fw|fwd|转发|trans)\s*[:：]/i;
const FWD_MARKER = /转发邮件信息|原始邮件|Forwarded message|Begin forwarded message|转发的邮件|Original Message/i;

function fileSig(f) {
  if (f.kind !== "zip") return f.kind;
  const inner = [...new Set((f.inner ?? []).map(fileSig))].sort(byKind);
  return `zip(${inner.join("+") || "空"})`;
}

function byKind(a, b) {
  const ia = KIND_ORDER.indexOf(a.replace(/\(.*$/, ""));
  const ib = KIND_ORDER.indexOf(b.replace(/\(.*$/, ""));
  return ia - ib || a.localeCompare(b);
}

/**
 * 分析一封邮件的原始 RFC822 内容。
 * ctx 里放来源信息（文件夹、UID），原样带进结果。
 */
export async function analyzeMessage(raw, ctx = {}, depth = 0) {
  const mail = await simpleParser(raw, { skipImageLinks: true, skipTextToHtml: true, skipTextLinks: true });
  const fromAddr = mail.from?.value?.[0]?.address;

  const files = [];
  const nested = [];
  let inlineImages = 0;

  for (const att of mail.attachments ?? []) {
    const isEml = att.contentType === "message/rfc822" || extOf(att.filename) === "eml";
    if (isEml) {
      if (depth < MAX_DEPTH) nested.push(await analyzeMessage(att.content, ctx, depth + 1));
      continue;
    }
    // 正文里内嵌的图（logo、二维码图）不算附件
    if (att.related && att.contentType?.startsWith("image/")) {
      inlineImages += 1;
      continue;
    }
    files.push(await analyzeFile(att.content, att.filename, att.contentType, 0));
  }

  const html = typeof mail.html === "string" ? mail.html : "";
  // 很多平台的 text/plain 部分是空的，正文只在 HTML 里
  const text = mail.text?.trim() ? mail.text : stripTags(html.replace(/<br\s*\/?>|<\/(p|div|tr|li)>/gi, "\n"));
  const links = extractLinks(html, text);

  // 作为附件转发的原邮件，内容并进来
  for (const n of nested) {
    files.push(...n.files);
    inlineImages += n.inlineImages;
    for (const l of n.links) if (!links.some((x) => x.pattern === l.pattern)) links.push(l);
  }

  const subject = mail.subject ?? "";
  let forwardVia;
  let originAddr;
  // mailparser 会自动展开 message/rfc822：内层附件并入外层，内层邮件头渲染进正文，
  // 所以这里只需识别出「是附件转发」，原始发件人照样从正文里取
  const embedsMessage = /^content-type:\s*message\/rfc822/im.test(Buffer.isBuffer(raw) ? raw.toString("latin1") : String(raw));
  if (nested.length > 0) {
    // 只有 mailparser 不认的（比如以 octet-stream 发来的 .eml）才会走到这里
    forwardVia = "附件转发";
    originAddr = nested[0].fromAddr;
  } else if (embedsMessage) {
    forwardVia = "附件转发";
    originAddr = quotedSender(text);
  } else if (FWD_SUBJECT.test(subject) || FWD_MARKER.test(text)) {
    forwardVia = "正文转发";
    originAddr = quotedSender(text);
  }

  const candidateLinks = links.filter((l) => l.candidate);
  const sigs = [...new Set(files.map(fileSig))].sort(byKind);
  let shape = sigs.join("+");
  if (!shape && SYSTEM_SENDERS.has(baseDomain(fromAddr)) && !FWD_SUBJECT.test(subjectOf(mail))) shape = "邮箱系统通知";
  if (!shape) {
    if (candidateLinks.length > 0) shape = "仅链接";
    else if (links.length > 0) shape = "无附件(只有无关链接)";
    else shape = "无附件无链接";
  }

  const from = baseDomain(fromAddr);
  const origin = baseDomain(originAddr);
  const { internalDate, ...meta } = ctx;
  return {
    ...meta,
    messageId: mail.messageId,
    date: (mail.date ?? internalDate)?.toISOString?.().slice(0, 10),
    subject: mask(subject),
    from,
    fromAddr: depth > 0 ? fromAddr : undefined,
    forwardVia,
    origin,
    // 转发了却认不出原始发件人时，平台记为未知，避免把自己的邮箱当成开票平台
    platform: forwardVia ? origin ?? "(转发·来源未知)" : from ?? "(无发件人)",
    shape,
    files,
    inlineImages,
    links,
    candidateLinks: candidateLinks.length,
    mentionsCode: mentionsCode(text) || nested.some((n) => n.mentionsCode),
    textLen: text.length,
  };
}
