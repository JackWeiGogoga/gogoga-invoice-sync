/**
 * 从邮件正文里找发票下载入口。
 * 规则来自摸底样本：链接文字写「点击下载」，或地址本身指向发票文件。
 */

/** 链接文字或地址里出现这些词才算候选。 */
const CANDIDATE = /发票|下载|invoice|fapiao|\.pdf|\.ofd|\.xml|\.zip|领取|获取|电子票/i;
/** 明显不是发票的链接：退订、官网、公众号推广之类。 */
const NOISE = /退订|unsubscribe|隐私|privacy|帮助|客服|投诉|举报|官网|产品介绍|资源中心|试用|app下载|下载app|下载客户端|续费|安全/i;
const NOISE_HOSTS = /(^|\.)(mp\.weixin\.qq\.com|count\.mail\.163\.com|id\.163\.com)$/i;

export interface MailLink {
  url: string;
  text: string;
}

export function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)));
}

/** HTML → 纯文本，保留段落换行。 */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
      .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n")
      .replace(/<[^>]*>/g, " "),
  )
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{2,}/g, "\n")
    .trim();
}

function isHttp(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

/** 按可能性排序的候选下载链接。 */
export function candidateLinks(html: string, text: string): MailLink[] {
  const found = new Map<string, MailLink>();
  const add = (href: string, label: string) => {
    const url = decodeEntities(href.trim());
    if (!isHttp(url) || found.has(url)) return;
    const host = new URL(url).hostname;
    if (NOISE_HOSTS.test(host) || NOISE.test(label)) return;
    if (!CANDIDATE.test(`${label} ${url}`)) return;
    found.set(url, { url, text: label });
  };

  for (const m of html.matchAll(/<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi)) {
    add(m[2] ?? "", htmlToText(m[3] ?? ""));
  }
  // 裸 URL 在中文正文里常紧跟全角标点，遇到就截断
  for (const m of text.matchAll(/https?:\/\/[^\s<>"'，。；、）)】\]]+/g)) add(m[0], "");

  // 文字里明确写着「下载」的排前面
  return [...found.values()].sort((a, b) => Number(/下载/.test(b.text)) - Number(/下载/.test(a.text)));
}
