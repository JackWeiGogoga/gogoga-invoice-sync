/**
 * 跟随邮件里的下载链接拿到发票文件。
 *
 * 为什么不用 Obsidian 的 requestUrl：它自动跟随跳转且不暴露中间地址，
 * 而样本里（百望金赋）真正的文件地址恰恰藏在跳转落地页的 URL 参数里：
 *   短链 → 302 → 落地页?xmlUrl=…&pdfUrl=…&ofdUrl=…
 * 所以这里用 Node 的 http(s) 手动逐跳处理。插件本来就只能在桌面端运行。
 */
import * as http from "http";
import * as https from "https";
import { sniff } from "./files";
import { decodeEntities } from "../mail/links";
import { t, tn } from "../i18n";

export interface FetchResult {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Uint8Array;
}

/** 单次 GET，不跟随跳转。可替换，方便测试。 */
export type Fetcher = (url: string, headers: Record<string, string>) => Promise<FetchResult>;

export interface DownloadedFile {
  name: string;
  data: Uint8Array;
}

export class DownloadError extends Error {}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";
const MAX_HOPS = 8;
const MAX_BYTES = 25 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
/** 一个链接最多再下载几个文件（XML / PDF / OFD）。 */
const MAX_FILES = 4;

export const nodeFetcher: Fetcher = (url, headers) =>
  new Promise((resolve, reject) => {
    const u = new URL(url);
    const mod = u.protocol === "http:" ? http : https;
    const req = mod.request(
      u,
      {
        method: "GET",
        timeout: TIMEOUT_MS,
        // 不要压缩，省得自己解 gzip
        headers: { "User-Agent": UA, Accept: "*/*", "Accept-Encoding": "identity", ...headers },
      },
      (res) => {
        const chunks: Buffer[] = [];
        let size = 0;
        res.on("data", (c: Buffer) => {
          size += c.length;
          if (size > MAX_BYTES) {
            req.destroy(new DownloadError(t("download.tooLarge")));
            return;
          }
          chunks.push(c);
        });
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: new Uint8Array(Buffer.concat(chunks)) }));
        res.on("error", reject);
      },
    );
    req.on("timeout", () => req.destroy(new DownloadError(t("download.timeout"))));
    req.on("error", reject);
    req.end();
  });

function header(res: FetchResult, name: string): string {
  const v = res.headers[name.toLowerCase()];
  return Array.isArray(v) ? v.join(", ") : v ?? "";
}

/** 从 Content-Disposition 取文件名，兼容 filename*=UTF-8''… 写法。 */
function dispositionName(res: FetchResult): string | undefined {
  const cd = header(res, "content-disposition");
  const star = /filename\*\s*=\s*[\w-]*''([^;]+)/i.exec(cd)?.[1];
  const plain = /filename\s*=\s*"?([^";]+)"?/i.exec(cd)?.[1];
  const raw = star ?? plain;
  if (!raw) return undefined;
  try {
    return decodeURIComponent(raw.trim());
  } catch {
    return raw.trim();
  }
}

/** 文件地址的优先级：XML 最有用，其次 ZIP、PDF、OFD。 */
function rankOf(hint: string): number {
  if (/xml/i.test(hint)) return 0;
  if (/zip/i.test(hint)) return 1;
  if (/pdf/i.test(hint)) return 2;
  if (/ofd/i.test(hint)) return 3;
  return 4;
}

interface FileUrl {
  url: string;
  rank: number;
}

/** URL 参数里藏着的文件地址，如 ?xmlUrl=https://… */
function fileUrlsInParams(url: string): FileUrl[] {
  const out: FileUrl[] = [];
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return out;
  }
  for (const [k, v] of u.searchParams) {
    if (!/^https?:\/\//i.test(v)) continue;
    if (/xml|pdf|ofd|zip|file|down/i.test(k) || /\.(xml|pdf|ofd|zip)(\?|$)/i.test(v)) {
      // 参数名比地址更可信：pdfUrl 指向的地址里也可能带着 xml 字样
      out.push({ url: v, rank: /xml|zip|pdf|ofd/i.test(k) ? rankOf(k) : rankOf(v) });
    }
  }
  return out;
}

/**
 * 百望的全电票落地页是 Vue 单页应用：初始 HTML 只有脚本标签，真正的下载地址
 * 要等浏览器执行 JS 后，才会根据 param 拼出 downloadFormat 请求。因此 Node 侧
 * 不能只找静态链接，需要复现页面公开的下载动作。
 */
function baiwangFileUrls(url: string): FileUrl[] {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return [];
  }
  if (u.hostname !== "pis.baiwang.com" || u.pathname !== "/smkp-vue/previewInvoiceAllEle") return [];
  const param = u.searchParams.get("param") ?? "";
  // 真实页面使用十六进制密文；限制格式，避免把任意输入带入平台接口。
  if (!/^[0-9a-f]{32,512}$/i.test(param)) return [];
  return ["XML", "PDF", "OFD"].map((format) => ({
    url: `${u.origin}/bwmg/mix/bw/downloadFormat?param=${encodeURIComponent(param)}&formatType=${format}`,
    rank: rankOf(format),
  }));
}

/** 落地页 HTML 里指向文件的链接。 */
function fileUrlsInHtml(html: string, base: string): FileUrl[] {
  const out: FileUrl[] = [];
  for (const m of html.matchAll(/(?:href|src)\s*=\s*(["'])(.*?)\1/gi)) {
    const raw = decodeEntities(m[2] ?? "");
    if (!/\.(xml|pdf|ofd|zip)(\?|$)|download|xiazai/i.test(raw)) continue;
    try {
      const abs = new URL(raw, base).toString();
      out.push({ url: abs, rank: rankOf(raw) });
    } catch {
      // 相对地址解析失败就跳过
    }
  }
  return out;
}

/**
 * 一次会话里的简易 Cookie 罐：落地页种下的 Cookie，后续下载时带上。
 * 只记名值，不区分域——一个链接的会话很短，够用。
 */
class CookieJar {
  private readonly map = new Map<string, string>();
  absorb(res: FetchResult): void {
    const raw = res.headers["set-cookie"];
    for (const line of Array.isArray(raw) ? raw : raw ? [raw] : []) {
      const pair = line.split(";")[0] ?? "";
      const i = pair.indexOf("=");
      if (i > 0) this.map.set(pair.slice(0, i).trim(), pair.slice(i + 1).trim());
    }
  }
  header(): Record<string, string> {
    if (this.map.size === 0) return {};
    return { Cookie: [...this.map].map(([k, v]) => `${k}=${v}`).join("; ") };
  }
}

/** 逐跳请求直到拿到非跳转响应，返回沿途地址与最终响应。 */
async function walk(url: string, fetcher: Fetcher, jar: CookieJar): Promise<{ trail: string[]; res: FetchResult; finalUrl: string }> {
  const trail: string[] = [];
  let cur = url;
  for (let hop = 0; hop < MAX_HOPS; hop += 1) {
    trail.push(cur);
    const res = await fetcher(cur, jar.header());
    jar.absorb(res);
    const loc = header(res, "location");
    if (res.status >= 300 && res.status < 400 && loc) {
      cur = new URL(loc, cur).toString();
      continue;
    }
    return { trail, res, finalUrl: cur };
  }
  throw new DownloadError(t("download.tooManyRedirects"));
}

function nameFor(res: FetchResult, url: string, kind: string): string {
  const fromHeader = dispositionName(res);
  if (fromHeader) return fromHeader;
  const tail = new URL(url).pathname.split("/").pop() ?? "";
  return /\.\w{2,4}$/.test(tail) ? tail : `download.${kind === "other" ? "bin" : kind}`;
}

function isFile(kind: string): boolean {
  return kind === "xml" || kind === "pdf" || kind === "ofd" || kind === "zip";
}

/**
 * 跟随一个下载链接，尽量拿到 XML/PDF/OFD。
 * 找不到任何文件时抛出 DownloadError，说明卡在哪一步。
 */
export async function downloadFromLink(url: string, fetcher: Fetcher = nodeFetcher): Promise<DownloadedFile[]> {
  const jar = new CookieJar();
  const { trail, res, finalUrl } = await walk(url, fetcher, jar);
  const files: DownloadedFile[] = [];

  if (res.status === 200) {
    const name = nameFor(res, finalUrl, "bin");
    const kind = sniff(res.body, name);
    if (isFile(kind)) files.push({ name: nameFor(res, finalUrl, kind), data: res.body });
  }

  // 沿途地址参数里的文件地址 + 落地页里的文件链接
  const candidates = trail.flatMap((u) => [...fileUrlsInParams(u), ...baiwangFileUrls(u)]);
  const ctype = header(res, "content-type");
  if (res.status === 200 && /html/i.test(ctype)) {
    candidates.push(...fileUrlsInHtml(new TextDecoder("utf-8").decode(res.body), finalUrl));
  }
  const seen = new Set<string>();
  const ordered = candidates
    .sort((a, b) => a.rank - b.rank)
    .filter((c) => (seen.has(c.url) ? false : (seen.add(c.url), true)))
    .slice(0, MAX_FILES);

  const errors: string[] = [];
  for (const c of ordered) {
    try {
      const got = await walk(c.url, fetcher, jar);
      if (got.res.status !== 200) {
        errors.push(`HTTP ${got.res.status}`);
        continue;
      }
      const kind = sniff(got.res.body, nameFor(got.res, got.finalUrl, "bin"));
      if (isFile(kind)) files.push({ name: nameFor(got.res, got.finalUrl, kind), data: got.res.body });
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  if (files.length === 0) {
    const host = (() => {
      try {
        return new URL(finalUrl).host;
      } catch {
        return "?";
      }
    })();
    const why = res.status !== 200 ? `HTTP ${res.status}` : /html/i.test(ctype) ? t("download.noFileOnLanding") : t("download.notInvoiceFile");
    const extra = errors[0] ? t("parse.detail", { detail: errors[0] }) : "";
    throw new DownloadError(tn("download.failed", trail.length, { host, why, extra }));
  }
  return files;
}
