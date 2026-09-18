/**
 * 从邮件正文里找「可能是发票下载」的链接，并脱敏成模式。
 *
 * 下载链接里的 token、文件 id 本身就是取票凭证，所以只保留：
 * 域名 + 路径模式（长 id 替换成 :id）+ 查询参数的名字（不要值）。
 */

/** 链接文字或地址里出现这些词，才算候选。 */
const CANDIDATE = /发票|下载|invoice|fapiao|\.pdf|\.ofd|\.xml|\.zip|查看|领取|获取|电子票|凭证|开票/i;
/** 明显不是发票的链接。 */
const NOISE = /退订|unsubscribe|隐私|privacy|帮助中心|客服|投诉|举报|app下载|下载app|下载客户端/i;
/** 常见短链域名：真实地址要跟一次跳转才知道。 */
const SHORT_HOSTS = new Set(["t.cn", "url.cn", "dwz.cn", "suo.im", "3.cn", "u.jd.com", "bit.ly", "j.mp", "tb.cn", "m.tb.cn", "c.tb.cn", "s.click.taobao.com"]);

/** 形似 id 的路径段：够长且含数字，或纯数字。 */
function looksLikeId(seg) {
  const base = seg.replace(/\.[a-z0-9]{2,4}$/i, "");
  if (/^\d{6,}$/.test(base)) return true;
  // 平台自带的短码（如 /u/ 后面 11 位字母数字）同样能换到下载地址
  if (/^[A-Za-z0-9_-]{6,}$/.test(base) && /\d/.test(base) && /[A-Za-z]/.test(base)) return true;
  return base.length >= 12 && /\d/.test(base) && /^[\w\-.=%~]+$/.test(base);
}

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)));
}

export function stripTags(s) {
  return decodeEntities(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

/** 链接文字也可能带号码，长数字统一打码。 */
function maskText(s) {
  return s.replace(/\d{6,}/g, "#").slice(0, 24);
}

export function normalizeUrl(href) {
  let url;
  try {
    url = new URL(href);
  } catch {
    return null;
  }
  if (!/^https?:$/.test(url.protocol)) return null;
  const host = url.hostname.toLowerCase();
  // 短链的短码本身就能换到下载地址，等同凭证，整段抹掉
  if (SHORT_HOSTS.has(host)) return { host, pattern: `${host}/:短码`, ext: undefined, short: true };
  const segs = url.pathname.split("/").map((seg) => {
    if (!looksLikeId(seg)) return seg;
    const ext = /\.([a-z0-9]{2,4})$/i.exec(seg)?.[1];
    return ext ? `:id.${ext.toLowerCase()}` : ":id";
  });
  const params = [...new Set(url.searchParams.keys())];
  const ext = /\.([a-z0-9]{2,4})$/i.exec(url.pathname)?.[1]?.toLowerCase();
  return {
    host,
    pattern: host + segs.join("/") + (params.length ? `?[${params.join(",")}]` : ""),
    ext,
    short: SHORT_HOSTS.has(host),
  };
}

/**
 * 抽取链接：HTML 的 <a> 与纯文本里的裸 URL 都算。
 * 返回去重后的列表，candidate 表示像是发票下载入口。
 */
export function extractLinks(html, text) {
  const found = new Map();
  const add = (href, label) => {
    const norm = normalizeUrl(decodeEntities(href.trim()));
    if (!norm) return;
    const probe = `${label} ${norm.pattern}`;
    const candidate = CANDIDATE.test(probe) && !NOISE.test(label);
    const prev = found.get(norm.pattern);
    if (prev) {
      prev.candidate ||= candidate;
      if (!prev.text && label) prev.text = maskText(label);
      return;
    }
    found.set(norm.pattern, { ...norm, text: maskText(label), candidate });
  };

  if (html) {
    const re = /<a\b[^>]*?href\s*=\s*(["'])(.*?)\1[^>]*>([\s\S]*?)<\/a>/gi;
    for (const m of html.matchAll(re)) add(m[2] ?? "", stripTags(m[3] ?? ""));
  }
  if (text) {
    // 裸 URL 在中文正文里常紧跟全角标点，遇到就截断
    const re = /https?:\/\/[^\s<>"'，。；、）)】\]]+/g;
    for (const m of text.matchAll(re)) add(m[0], "");
  }
  return [...found.values()];
}

/** 正文里提到提取码之类的东西（只记有没有，不记值）。 */
export function mentionsCode(text) {
  return /(提取码|验证码|取票码|查询码|提取密码|下载码)\s*[:：为是]?\s*[A-Za-z0-9]{4,10}/.test(text ?? "");
}
