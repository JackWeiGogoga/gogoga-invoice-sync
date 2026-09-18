#!/usr/bin/env node
/**
 * 发票邮箱摸底：以只读方式连上 163 IMAP，逐封分析邮件形态，生成报告。
 *
 * 只读保证：文件夹用 EXAMINE（readOnly）打开，不会改已读状态、不移动不删除。
 * 授权码只从环境变量或隐藏输入读取，不落盘、不打印。
 */
import { ImapFlow } from "imapflow";
import { parseArgs } from "node:util";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import readline from "node:readline";
import { analyzeMessage } from "./lib/analyze.mjs";
import { buildReport } from "./lib/report.mjs";

const HELP = `用法：
  node scripts/survey.mjs --user <邮箱地址> [选项]
  node scripts/survey.mjs --from-dir <.eml 目录> [选项]

选项：
  --user <地址>       IMAP 登录邮箱
  --since <日期>      只看这天之后的邮件，如 2025-01-01
  --limit <数量>      每个文件夹最多看最近 N 封
  --folders <a,b>     只扫这些文件夹（默认扫全部，跳过已发送/草稿/已删除）
  --save              把原始邮件存成 .eml，供以后离线反复分析、做解析器样本
  --from-dir <目录>   不连邮箱，直接分析目录里的 .eml 文件
  --out <目录>        输出目录，默认 survey-output

授权码：优先读环境变量 INVOICE_IMAP_PASS，没有则提示输入（不回显）。`;

const { values: args } = parseArgs({
  options: {
    user: { type: "string" },
    host: { type: "string", default: "imap.163.com" },
    port: { type: "string", default: "993" },
    since: { type: "string" },
    limit: { type: "string" },
    folders: { type: "string" },
    save: { type: "boolean", default: false },
    "from-dir": { type: "string" },
    out: { type: "string", default: "survey-output" },
    help: { type: "boolean", short: "h", default: false },
  },
});

/** 一次抓多少封，控制内存。 */
const BATCH = 30;
/** 不扫这些特殊文件夹。 */
const SKIP_SPECIAL = new Set(["\\Sent", "\\Drafts", "\\Trash"]);

function ask(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((res) => rl.question(prompt, (a) => { rl.close(); res(a.trim()); }));
}

/** 不回显地读一行（授权码）。 */
function askHidden(prompt) {
  const { stdin, stdout } = process;
  if (!stdin.isTTY) return ask(prompt);
  return new Promise((res) => {
    stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let buf = "";
    const cleanup = () => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
    };
    const onData = (chunk) => {
      for (const ch of chunk) {
        const code = ch.charCodeAt(0);
        if (code === 13 || code === 10 || code === 4) {
          cleanup();
          stdout.write("\n");
          res(buf.trim());
          return;
        }
        if (code === 3) {
          cleanup();
          stdout.write("\n");
          process.exit(130);
        }
        if (code === 127 || code === 8) buf = buf.slice(0, -1);
        else buf += ch;
      }
    };
    stdin.on("data", onData);
  });
}

function progress(msg) {
  if (process.stdout.isTTY) process.stdout.write(`\r\x1b[K${msg}`);
}

/** 把常见失败翻译成人话。 */
function explain(err) {
  const text = `${err?.message ?? err} ${err?.responseText ?? ""}`;
  if (/unsafe login/i.test(text)) {
    return "163 拒绝了这个客户端（Unsafe Login）。通常是没发 IMAP ID 命令，脚本已经发了；如果仍出现，把完整报错发给我。";
  }
  if (err?.authenticationFailed || /authenticat|LOGIN failed|password/i.test(text)) {
    return "登录失败。请确认：1) 用的是「授权码」而不是网页登录密码；2) 163 网页版 设置 → POP3/SMTP/IMAP 里已开启 IMAP 服务。";
  }
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET/.test(text)) return `网络连不上 ${args.host}：${err.message}`;
  return err?.message ?? String(err);
}

function safeName(s) {
  return String(s).replace(/[\\/:*?"<>|\s]+/g, "_");
}

async function surveyImap(records, meta, onRaw) {
  const user = args.user || (await ask("邮箱地址："));
  const pass = process.env.INVOICE_IMAP_PASS || (await askHidden("授权码（输入不显示）："));
  if (!user || !pass) throw new Error("邮箱地址和授权码都不能为空");

  const client = new ImapFlow({
    host: args.host,
    port: Number(args.port),
    secure: true,
    auth: { user, pass },
    logger: false,
    // 163 要求客户端用 ID 命令自报家门，否则打开文件夹时报 Unsafe Login
    clientInfo: { name: "obsidian-invoice-sync", version: "0.0.0", vendor: "obsidian-invoice-sync" },
  });
  client.on("error", () => {});

  console.log(`连接 ${args.host} …`);
  await client.connect();
  // imapflow 只在登录前的 ID 响应不完整时才补发，163 需要登录后也发一次，这里显式补上
  try {
    await client.run("ID", client.clientInfo);
  } catch {
    // 服务器不支持就算了，后面打开文件夹时会暴露问题
  }

  try {
    const list = await client.list({ statusQuery: { messages: true } });
    const wanted = args.folders?.split(",").map((s) => s.trim()).filter(Boolean);
    const folders = list.filter((f) => {
      if (f.flags?.has?.("\\Noselect")) return false;
      if (wanted) return wanted.includes(f.path) || wanted.includes(f.name);
      return !SKIP_SPECIAL.has(f.specialUse);
    });
    meta.folders = list.map((f) => ({
      path: f.path,
      specialUse: f.specialUse,
      total: f.status?.messages,
      scanned: 0,
    }));
    console.log(`文件夹：${list.map((f) => `${f.path}(${f.status?.messages ?? "?"})`).join("  ")}`);

    for (const folder of folders) {
      const fm = meta.folders.find((x) => x.path === folder.path);
      const lock = await client.getMailboxLock(folder.path, { readOnly: true });
      try {
        let uids = (await client.search(args.since ? { since: new Date(args.since) } : { all: true }, { uid: true })) || [];
        uids.sort((a, b) => a - b);
        if (args.limit) uids = uids.slice(-Number(args.limit));
        for (let i = 0; i < uids.length; i += BATCH) {
          const batch = uids.slice(i, i + BATCH);
          // 先把这一批收完再分析：imapflow 不允许在 fetch 迭代过程中插入别的操作
          const msgs = [];
          for await (const m of client.fetch(batch, { uid: true, source: true, internalDate: true }, { uid: true })) {
            msgs.push(m);
          }
          for (const m of msgs) {
            progress(`${folder.path} ${i + msgs.indexOf(m) + 1}/${uids.length}`);
            await onRaw(m.source, { folder: folder.path, uid: m.uid, internalDate: m.internalDate });
            if (fm) fm.scanned += 1;
          }
        }
      } finally {
        lock.release();
      }
    }
    progress("");
  } finally {
    await client.logout().catch(() => {});
  }
}

async function surveyDir(dir, onRaw) {
  const names = (await readdir(dir)).filter((n) => n.toLowerCase().endsWith(".eml")).sort();
  for (let i = 0; i < names.length; i += 1) {
    progress(`${i + 1}/${names.length}`);
    await onRaw(await readFile(join(dir, names[i])), { folder: "(本地)", uid: names[i] });
  }
  progress("");
}

export async function main() {
  if (args.help) {
    console.log(HELP);
    return;
  }
  const outDir = resolve(args.out);
  const sampleDir = join(outDir, "samples");
  await mkdir(outDir, { recursive: true });
  if (args.save) await mkdir(sampleDir, { recursive: true });

  const records = [];
  const seen = new Set();
  const meta = {
    generatedAt: new Date().toISOString().replace("T", " ").slice(0, 19),
    source: args["from-dir"] ? `本地目录 ${args["from-dir"]}` : `IMAP ${args.host}`,
    since: args.since,
    limit: args.limit,
    folders: [],
    errors: [],
    duplicates: 0,
  };

  const onRaw = async (raw, ctx) => {
    if (args.save && !args["from-dir"]) {
      await writeFile(join(sampleDir, `${safeName(ctx.folder)}-${ctx.uid}.eml`), raw);
    }
    try {
      const rec = await analyzeMessage(raw, ctx);
      // 同一封邮件可能同时在多个文件夹（比如被规则复制过）
      if (rec.messageId && seen.has(rec.messageId)) {
        meta.duplicates += 1;
        return;
      }
      if (rec.messageId) seen.add(rec.messageId);
      records.push(rec);
    } catch (err) {
      meta.errors.push({ folder: ctx.folder, uid: ctx.uid, error: String(err?.message ?? err).slice(0, 120) });
    }
  };

  if (args["from-dir"]) await surveyDir(resolve(args["from-dir"]), onRaw);
  else await surveyImap(records, meta, onRaw);

  const report = buildReport(records, meta);
  await writeFile(join(outDir, "report.md"), report);
  await writeFile(join(outDir, "messages.json"), JSON.stringify({ meta, records }, null, 2));

  const shapes = new Map();
  for (const r of records) shapes.set(r.shape, (shapes.get(r.shape) ?? 0) + 1);
  console.log(`\n完成：分析 ${records.length} 封，失败 ${meta.errors.length} 封`);
  for (const [s, n] of [...shapes.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(4)}  ${s}`);
  console.log(`\n报告：${join(outDir, "report.md")}`);
  if (args.save && !args["from-dir"]) console.log(`原始邮件：${sampleDir}`);
  return { records, meta, outDir };
}

// 被自测脚本 import 时不自动运行
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(`\n✗ ${explain(err)}`);
    process.exit(1);
  });
}
