/**
 * 把逐封分析结果汇总成一份 Markdown 报告。
 * 回答的问题：邮件都长什么样、先做哪条路、哪些平台值得写适配器。
 */

function countBy(items, keyFn) {
  const map = new Map();
  for (const it of items) {
    const k = keyFn(it);
    if (k === undefined || k === null) continue;
    map.set(k, (map.get(k) ?? 0) + 1);
  }
  return [...map.entries()].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])));
}

function pct(n, total) {
  return total ? `${Math.round((n / total) * 100)}%` : "-";
}

/** 表格单元格里不能有竖线和换行。 */
function cell(s) {
  return String(s ?? "").replace(/\|/g, "／").replace(/\s+/g, " ").trim() || " ";
}

function table(headers, rows) {
  if (rows.length === 0) return "_（无）_\n";
  const head = `| ${headers.join(" | ")} |\n| ${headers.map(() => "---").join(" | ")} |\n`;
  return head + rows.map((r) => `| ${r.map(cell).join(" | ")} |`).join("\n") + "\n";
}

/** 展开 ZIP，拿到所有文件（含 ZIP 内部的）。 */
function flatFiles(files) {
  const out = [];
  for (const f of files) {
    out.push(f);
    if (f.inner) out.push(...flatFiles(f.inner));
  }
  return out;
}

const NON_INVOICE_KINDS = new Set(["行程单(非发票)", "收据/回单", "无文本层", "未识别"]);

export function buildReport(records, meta) {
  const total = records.length;
  const dates = records.map((r) => r.date).filter(Boolean).sort();
  const lines = [];
  const p = (s = "") => lines.push(s);

  p("# 发票邮箱摸底报告");
  p();
  p(`生成于 ${meta.generatedAt}；来源：${meta.source}${meta.since ? `；起始日期 ${meta.since}` : ""}${meta.limit ? `；每个文件夹最多 ${meta.limit} 封` : ""}`);
  p();
  p(`共分析 **${total}** 封邮件${dates.length ? `（${dates[0]} ~ ${dates[dates.length - 1]}）` : ""}` +
    `${meta.duplicates ? `，跨文件夹重复 ${meta.duplicates} 封已去重` : ""}` +
    `${meta.errors?.length ? `，**${meta.errors.length} 封解析失败**（见文末）` : ""}。`);
  p();
  p("> 报告只含结构特征：发票号码、金额、税号、下载链接里的 token 都没有记录，长数字已打码成 `#`。");
  p();

  // ---- 文件夹 ----
  if (meta.folders?.length) {
    p("## 文件夹");
    p();
    const docShapes = /pdf|ofd|xml|zip/;
    const rows = meta.folders.map((f) => {
      const inFolder = records.filter((r) => r.folder === f.path);
      const withDocs = inFolder.filter((r) => docShapes.test(r.shape)).length;
      return [f.path + (f.specialUse ? ` (${f.specialUse})` : ""), f.total ?? "-", f.scanned ?? 0, withDocs];
    });
    p(table(["文件夹", "邮件总数", "本次扫描", "其中带发票类附件"], rows));
    const junk = meta.folders.filter((f) => /junk|spam/i.test(f.specialUse ?? "") || /垃圾|广告|订阅/.test(f.path));
    const junkHits = junk.flatMap((f) => records.filter((r) => r.folder === f.path && docShapes.test(r.shape)));
    if (junkHits.length) p(`⚠️ 垃圾/广告/订阅类文件夹里有 ${junkHits.length} 封带发票附件，插件不能只扫收件箱。\n`);
  }

  // ---- 形态 ----
  p("## 一、邮件形态");
  p();
  p(table(["形态", "封数", "占比"], countBy(records, (r) => r.shape).map(([k, n]) => [k, n, pct(n, total)])));
  p("说明：`zip(...)` 是压缩包及其内容；`仅链接` 是没有附件、但正文有疑似下载链接；多种文件用 `+` 连接。");
  p();

  // ---- 平台 ----
  p("## 二、来源平台");
  p();
  const direct = records.filter((r) => !r.forwardVia).length;
  const quoted = records.filter((r) => r.forwardVia === "正文转发");
  const attached = records.filter((r) => r.forwardVia === "附件转发");
  p(`- 直接发到这个邮箱：${direct} 封`);
  p(`- 正文转发：${quoted.length} 封，其中认出原始发件人 ${quoted.filter((r) => r.origin).length} 封`);
  p(`- 作为附件转发（.eml）：${attached.length} 封`);
  const fwdDomains = countBy(records.filter((r) => r.forwardVia), (r) => r.from);
  if (fwdDomains.length) p(`- 转发者所用邮箱：${fwdDomains.map(([d, n]) => `${d}×${n}`).join("，")}`);
  p();
  const byPlatform = new Map();
  for (const r of records) {
    const list = byPlatform.get(r.platform) ?? [];
    list.push(r);
    byPlatform.set(r.platform, list);
  }
  const platformRows = [...byPlatform.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .map(([platform, rs]) => [
      platform,
      rs.length,
      countBy(rs, (r) => r.shape).map(([s, n]) => `${s}×${n}`).join("，"),
      [...new Set(rs.map((r) => r.subject))].slice(0, 2).join(" ／ "),
    ]);
  p(table(["平台（原始发件域名）", "封数", "形态", "主题样例"], platformRows));

  // ---- PDF ----
  const pdfs = records.flatMap((r) => flatFiles(r.files)).filter((f) => f.kind === "pdf");
  p("## 三、PDF");
  p();
  if (pdfs.length === 0) {
    p("_没有 PDF。_");
    p();
  } else {
    const ok = pdfs.filter((f) => f.pdf && !f.pdf.error);
    const failed = pdfs.filter((f) => f.pdf?.error);
    const textual = ok.filter((f) => f.pdf.hasText);
    p(`- 共 ${pdfs.length} 个 PDF：有文本层 ${textual.length}，无文本层（扫描件/图片）${ok.length - textual.length}，打不开 ${failed.length}` +
      `${failed.some((f) => f.pdf.encrypted) ? "（含加密）" : ""}`);
    p(`- 抽出的文字里含康熙部首等「形似字」的 PDF：${ok.filter((f) => f.pdf.radicals > 0).length} 个（必须先做 NFKC 规范化才能匹配）`);
    p();
    p(table(["票种", "个数"], countBy(ok, (f) => f.pdf.kind)));
    const invoices = ok.filter((f) => !NON_INVOICE_KINDS.has(f.pdf.kind));
    if (invoices.length) {
      p(`发票类 PDF（${invoices.length} 个）的字段可抽取性：`);
      p();
      p(`- 「发票号码」标签后直接跟号码（正则一步到位）：${invoices.filter((f) => f.pdf.invoiceNoAdjacent).length}`);
      p(`- 标签与号码被拆开、但能找到 20 位数电号码：${invoices.filter((f) => !f.pdf.invoiceNoAdjacent && f.pdf.has20Digits).length}`);
      p(`- 两者都找不到：${invoices.filter((f) => !f.pdf.invoiceNoAdjacent && !f.pdf.has20Digits).length}`);
      p(`- 含「价税合计」：${invoices.filter((f) => f.pdf.hasTotal).length}`);
      p(`- 识别到的税号个数分布：${countBy(invoices, (f) => `${f.pdf.hasTaxIdCount} 个`).map(([k, n]) => `${k}×${n}`).join("，")}（正常应为购买方+销售方 2 个；个人抬头只有 1 个）`);
      p();
    }
    if (failed.length) {
      p(table(["打不开的原因", "个数"], countBy(failed, (f) => f.pdf.error)));
    }
    p(table(["每页数", "个数"], countBy(ok, (f) => `${f.pdf.pages} 页`)));
  }

  // ---- XML / OFD / ZIP ----
  const all = records.flatMap((r) => flatFiles(r.files));
  const xmls = all.filter((f) => f.kind === "xml");
  const ofds = all.filter((f) => f.kind === "ofd");
  const zips = all.filter((f) => f.kind === "zip");
  p("## 四、XML / OFD / ZIP");
  p();
  p(`XML ${xmls.length} 个，OFD ${ofds.length} 个，ZIP ${zips.length} 个。`);
  p();
  if (xmls.length) {
    p(table(["XML 根节点", "前几个子节点", "个数"],
      countBy(xmls, (f) => JSON.stringify([f.xml?.root ?? "(解析失败)", (f.xml?.children ?? []).join(", ")]))
        .map(([k, n]) => [...JSON.parse(k), n])));
  }
  if (zips.length) {
    p(table(["ZIP 里的文件", "个数"],
      countBy(zips, (f) => (f.inner ?? []).map((x) => x.kind === "other" ? `.${x.ext ?? "?"}` : x.kind).sort().join(" + ") || "空")));
  }

  // ---- 仅链接 ----
  const linkOnly = records.filter((r) => r.shape === "仅链接");
  p("## 五、只有下载链接的邮件");
  p();
  p(`共 ${linkOnly.length} 封（占 ${pct(linkOnly.length, total)}），其中正文提到提取码/验证码的 ${linkOnly.filter((r) => r.mentionsCode).length} 封。`);
  p();
  if (linkOnly.length) {
    const byHost = new Map();
    for (const r of linkOnly) {
      for (const l of r.links.filter((x) => x.candidate)) {
        const e = byHost.get(l.host) ?? { mails: new Set(), patterns: new Set(), texts: new Set(), short: l.short, platforms: new Set() };
        e.mails.add(r.messageId ?? `${r.folder}:${r.uid}`);
        e.patterns.add(l.pattern);
        if (l.text) e.texts.add(l.text);
        e.platforms.add(r.platform);
        byHost.set(l.host, e);
      }
    }
    const rows = [...byHost.entries()]
      .sort((a, b) => b[1].mails.size - a[1].mails.size)
      .map(([host, e]) => [
        host + (e.short ? "（短链）" : ""),
        e.mails.size,
        [...e.platforms].slice(0, 3).join("，"),
        [...e.patterns].slice(0, 3).join("<br>"),
        [...e.texts].slice(0, 3).join(" ／ "),
      ]);
    p(table(["链接域名", "封数", "来自平台", "路径模式（id 与参数值已去掉）", "链接文字"], rows));
  }
  const both = records.filter((r) => r.shape !== "仅链接" && r.files.length > 0 && r.candidateLinks > 0).length;
  p(`另有 ${both} 封既有附件、正文里也带下载链接（附件优先，链接可作兜底）。`);
  p();

  // ---- 其它 ----
  p("## 六、其它");
  p();
  const imgs = records.filter((r) => /img/.test(r.shape));
  p(`- 带图片附件的邮件：${imgs.length} 封（可能是拍照的纸质发票，需要 OCR 或视觉模型）`);
  const others = all.filter((f) => f.kind === "other" && !f.skipped);
  if (others.length) {
    p(`- 其它类型附件：${countBy(others, (f) => `.${f.ext ?? "?"} ${f.contentType ?? ""}`.trim()).map(([k, n]) => `${k}×${n}`).join("，")}`);
  }
  const archives = all.filter((f) => f.kind === "archive");
  if (archives.length) p(`- RAR/7z 压缩包：${archives.length} 个（纯 JS 不好解，需要单独考虑）`);
  const bare = records.filter((r) => r.shape.startsWith("无附件"));
  if (bare.length) {
    p(`- 没附件也没下载链接的 ${bare.length} 封，主题样例：`);
    for (const r of bare.slice(0, 10)) p(`  - ${r.platform}：${r.subject}`);
  }
  p();

  if (meta.errors?.length) {
    p("## 解析失败");
    p();
    p(table(["文件夹", "UID", "错误"], meta.errors.slice(0, 30).map((e) => [e.folder, e.uid, e.error])));
  }

  p("---");
  p("逐封明细见同目录的 `messages.json`。");
  return lines.join("\n");
}
