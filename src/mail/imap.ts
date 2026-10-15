/**
 * 只读 IMAP：以 EXAMINE 打开文件夹，按 UID 增量拉取原文。
 * 不改已读状态、不移动、不删除。
 */
import { ImapFlow } from "imapflow";
import { t } from "../i18n";

export interface ImapConfig {
  host: string;
  port: number;
  user: string;
  pass: string;
}

export interface FolderInfo {
  path: string;
  specialUse?: string;
  messages?: number;
}

export interface FetchedMail {
  folder: string;
  uid: number;
  uidValidity: string;
  raw: Uint8Array;
}

/** 一次抓多少封：先整批收完再处理，imapflow 不允许在 fetch 迭代中穿插别的命令。 */
const BATCH = 20;

export class ImapError extends Error {}

/** 把常见失败翻译成人话。 */
export function explainImapError(err: unknown, host: string): string {
  const e = err as { message?: string; responseText?: string; authenticationFailed?: boolean; code?: string };
  const text = `${e?.message ?? String(err)} ${e?.responseText ?? ""}`;
  if (/unsafe login/i.test(text)) return t("imap.unsafeLogin");
  if (e?.authenticationFailed || /authenticat|LOGIN failed|password/i.test(text)) {
    return t("imap.authFailed");
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN/.test(`${text} ${e?.code ?? ""}`)) {
    return t("imap.unreachable", { host });
  }
  return e?.message ?? String(err);
}

export async function withImap<T>(cfg: ImapConfig, fn: (client: ImapFlow) => Promise<T>): Promise<T> {
  const client = new ImapFlow({
    host: cfg.host,
    port: cfg.port,
    secure: true,
    auth: { user: cfg.user, pass: cfg.pass },
    logger: false,
    // 163 要求客户端用 ID 命令自报家门，否则打开文件夹时报 Unsafe Login
    clientInfo: { name: "obsidian-invoice-sync", version: "0.1.0", vendor: "obsidian-invoice-sync" },
  });
  // 连接层错误会以事件形式抛出，不接住会变成未捕获异常
  client.on("error", () => {});
  try {
    await client.connect();
  } catch (err) {
    throw new ImapError(explainImapError(err, cfg.host));
  }
  try {
    // imapflow 只在登录前的 ID 响应不完整时才补发，163 需要登录后再发一次
    const runner = client as unknown as { run(cmd: string, info: unknown): Promise<unknown>; clientInfo: unknown };
    await runner.run("ID", runner.clientInfo).catch(() => {});
    return await fn(client);
  } catch (err) {
    if (err instanceof ImapError) throw err;
    throw new ImapError(explainImapError(err, cfg.host));
  } finally {
    await client.logout().catch(() => {});
  }
}

export async function listFolders(client: ImapFlow): Promise<FolderInfo[]> {
  const list = await client.list({ statusQuery: { messages: true } });
  return list
    .filter((f) => !f.flags?.has("\\Noselect"))
    .map((f) => ({ path: f.path, specialUse: f.specialUse, messages: f.status?.messages }));
}

export interface FetchOptions {
  /** 上次处理到的 UID；UIDVALIDITY 变了会被忽略。 */
  lastUid: number;
  uidValidity?: string;
  since?: Date;
  onMail: (mail: FetchedMail) => Promise<void>;
  /** 每处理完一封就回调新水位，调用方据此保存进度，中途断开也不会重复处理。 */
  onAdvance?: (mark: { uidValidity: string; lastUid: number }) => void;
  onProgress?: (done: number, total: number) => void;
}

/**
 * 拉取某文件夹里 UID 大于水位的新邮件，按 UID 升序逐封回调。
 * 返回新的水位。
 */
export async function fetchNew(client: ImapFlow, folder: string, opts: FetchOptions): Promise<{ uidValidity: string; lastUid: number }> {
  const lock = await client.getMailboxLock(folder, { readOnly: true });
  try {
    const mailbox = client.mailbox;
    const uidValidity = mailbox && typeof mailbox === "object" ? String(mailbox.uidValidity) : "";
    // UIDVALIDITY 变了，旧 UID 全部作废，从头扫（靠邮件记录和发票号码去重）
    const from = opts.uidValidity && opts.uidValidity !== uidValidity ? 0 : opts.lastUid;

    const query: Record<string, unknown> = { uid: `${from + 1}:*` };
    if (opts.since) query.since = opts.since;
    const found = (await client.search(query, { uid: true })) || [];
    // `N:*` 在没有新邮件时也会返回最后一封，要再过滤一次
    const uids = found.filter((u) => u > from).sort((a, b) => a - b);

    let last = from;
    for (let i = 0; i < uids.length; i += BATCH) {
      const batch = uids.slice(i, i + BATCH);
      const got: FetchedMail[] = [];
      for await (const m of client.fetch(batch, { uid: true, source: true }, { uid: true })) {
        if (m.source) got.push({ folder, uid: m.uid, uidValidity, raw: new Uint8Array(m.source) });
      }
      got.sort((a, b) => a.uid - b.uid);
      for (const mail of got) {
        await opts.onMail(mail);
        last = Math.max(last, mail.uid);
        opts.onAdvance?.({ uidValidity, lastUid: last });
        opts.onProgress?.(i + got.indexOf(mail) + 1, uids.length);
      }
    }
    return { uidValidity, lastUid: last };
  } finally {
    lock.release();
  }
}
