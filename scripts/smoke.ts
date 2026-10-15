/**
 * 冒烟测试：纯逻辑模块 + 真实 Node 下载器（对本地 HTTP 服务）+ 整条邮件管线。
 * 不需要 Obsidian、不连外网、不需要授权码。所有数据都是合成的。
 */
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { zipSync, strToU8 } from "fflate";
import MailComposer from "nodemailer/lib/mail-composer";
import { parseXml, text } from "../src/invoice/xml";
import { categoryOf, checkAmounts, parseEInvoice } from "../src/invoice/einvoice";
import { parsePdfInvoice } from "../src/invoice/pdf";
import { expandFiles, groupInvoices, sniff } from "../src/invoice/files";
import { downloadFromLink, nodeFetcher, DownloadError } from "../src/invoice/download";
import { candidateLinks, htmlToText } from "../src/mail/links";
import { peekMessageId, processMessage } from "../src/core/pipeline";
import { buildNote, pathsFor } from "../src/core/note-builder";
import { baseFileContent } from "../src/core/base-file";
import { DEFAULT_SETTINGS } from "../src/settings";
import { isReimbursed, reimbursementLabel, toggleReimbursed } from "../src/core/status";
import { dictionaries, getLocale, setLocale, t, tn } from "../src/i18n";

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail?: unknown): void {
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`✗ ${label}${detail !== undefined ? `  → ${JSON.stringify(detail)}` : ""}`);
  }
}

// ---------- 合成数据 ----------
// 打包后脚本不在 scripts/ 下，按工作目录（项目根）找夹具
const fixture = (n: string) => new Uint8Array(readFileSync(`scripts/fixtures/${n}`));
const PDF = fixture("fake-invoice.pdf");
const TRIP = fixture("fake-trip.pdf");
const NO_A = "26110000000000000001";
const NO_B = "26110000000000000002";

/** 按真实样本的国标结构拼一份数电票 XML（值全是假的）。 */
function einvoiceXml(o: { no: string; issue?: string; blue?: "Y" | "N"; amount?: string; tax?: string; total?: string; itemName?: string; code?: string; vat?: string }): Uint8Array {
  return strToU8(`<?xml version="1.0" encoding="utf-8"?>
<EInvoice>
  <Header>
    <EIid>${o.no}</EIid><EInvoiceTag>SWEI0000</EInvoiceTag><Version>0.1</Version>
    <InherentLabel>
      <InIssuType><LabelCode>${o.blue ?? "Y"}</LabelCode><LabelName>是否蓝字发票标志</LabelName></InIssuType>
      <EInvoiceType><LabelCode>01</LabelCode><LabelName>电子发票</LabelName></EInvoiceType>
      <GeneralOrSpecialVAT><LabelCode>02</LabelCode><LabelName>${o.vat ?? "普通发票"}</LabelName></GeneralOrSpecialVAT>
      <TaxpayerType><LabelCode>1</LabelCode><LabelName>一般纳税人</LabelName></TaxpayerType>
    </InherentLabel>
  </Header>
  <EInvoiceData>
    <SellerInformation><SellerIdNum>91110000MA00TEST01</SellerIdNum><SellerName>测试餐饮有限公司</SellerName></SellerInformation>
    <BuyerInformation><BuyerIdNum>91110000MA00TEST02</BuyerIdNum><BuyerName>测试科技有限公司</BuyerName></BuyerInformation>
    <BasicInformation>
      <TotalAmWithoutTax>${o.amount ?? "94.34"}</TotalAmWithoutTax><TotalTaxAm>${o.tax ?? "5.66"}</TotalTaxAm>
      <TotalTax-includedAmount>${o.total ?? "100.00"}</TotalTax-includedAmount>
      <TotalTax-includedAmountInChinese>壹佰圆整</TotalTax-includedAmountInChinese>
      <Drawer>张三</Drawer><RequestTime>2026-09-01 12:30:00</RequestTime>
    </BasicInformation>
    <IssuItemInformation>
      <ItemName>${o.itemName ?? "*生产生活服务*餐饮服务"}</ItemName><Quantity>1</Quantity><UnPrice>${o.amount ?? "94.34"}</UnPrice>
      <Amount>${o.amount ?? "94.34"}</Amount><TaxRate>0.06</TaxRate><ComTaxAm>${o.tax ?? "5.66"}</ComTaxAm>
      <TaxClassificationCode>${o.code ?? "3070401000000000000"}</TaxClassificationCode>
    </IssuItemInformation>
  </EInvoiceData>
  <TaxSupervisionInfo><InvoiceNumber>${o.no}</InvoiceNumber><IssueTime>${o.issue ?? "2026-09-01"}</IssueTime></TaxSupervisionInfo>
</EInvoice>`);
}

function compose(opts: Record<string, unknown>): Promise<Uint8Array> {
  return new Promise((res, rej) =>
    new MailComposer({ to: "inbox@example.test", ...opts }).compile().build((err, msg) => (err ? rej(err) : res(new Uint8Array(msg)))),
  );
}

// ---------- XML ----------
{
  const root = parseXml(`<?xml version="1.0"?><!-- c --><a:Root x="1>2"><b:Item>A &amp; B</b:Item><C><![CDATA[<raw>]]></C><E/></a:Root>`);
  check("XML 根节点去前缀", root?.name === "Root", root?.name);
  check("XML 实体解码", text(root ?? undefined, "Item") === "A & B");
  check("XML CDATA", text(root ?? undefined, "C") === "<raw>");
  check("XML 属性里的 > 不截断", root?.children.length === 3, root?.children.map((c) => c.name));
}

// ---------- 报销状态 ----------
{
  check("状态：未勾选 → 已报销", toggleReimbursed(false) === true);
  check("状态：已勾选 → 未报销", toggleReimbursed(true) === false);
  check("状态：兼容旧的已报销文本", isReimbursed(undefined, "已报销") === true);
  check("状态：布尔值优先于旧文本", isReimbursed(false, "已报销") === false);
  setLocale("zh-TW");
  check("状态：界面文案（中文）", reimbursementLabel(true) === "已报销" && reimbursementLabel(false) === "未报销");
  setLocale("en");
  check("状态：界面文案（英文）", reimbursementLabel(true) === "Reimbursed" && reimbursementLabel(false) === "Not reimbursed");
}

// ---------- 界面语言 ----------
{
  check("语言：zh 开头 → 中文", setLocale("zh") === "zh" && setLocale("zh-TW") === "zh");
  check("语言：其他 → 英文", setLocale("ja") === "en" && setLocale("") === "en" && setLocale(undefined) === "en");
  setLocale("en");
  check("语言：默认英文", getLocale() === "en" && t("view.sync") === "Sync");
  check("语言：插值", t("view.queueTitle", { n: 3 }) === "Needs attention · 3");
  check("语言：未传的占位符原样保留", t("settings.dirTemplate.desc").includes("{year}"));
  check("语言：复数", tn("view.tileCount", 1) === "1 invoice" && tn("view.tileCount", 2) === "2 invoices");
  const missing = Object.keys(dictionaries.en).filter((k) => !(dictionaries.zh as Record<string, string>)[k]);
  check("语言：中文字典无空缺", missing.length === 0, missing);
}

// ---------- 数电票解析 ----------
{
  const inv = parseEInvoice(einvoiceXml({ no: NO_A }));
  check("号码", inv.number === NO_A);
  check("票种 数电普票", inv.kind === "数电普票", inv.kind);
  check("开票日期", inv.issued === "2026-09-01", inv.issued);
  check("金额", inv.amount === 94.34 && inv.tax === 5.66 && inv.total === 100, [inv.amount, inv.tax, inv.total]);
  check("买卖方", inv.seller.name === "测试餐饮有限公司" && inv.buyer.taxId === "91110000MA00TEST02");
  check("类别按税收编码 → 餐饮", inv.category === "餐饮", inv.category);
  check("明细", inv.items.length === 1 && inv.items[0]?.taxRate === 0.06);
  check("蓝字", inv.red === false);
  check("金额自洽", checkAmounts(inv) === null, checkAmounts(inv));

  const withTime = parseEInvoice(einvoiceXml({ no: NO_A, issue: "2026-09-02 08:15:00" }));
  check("带时分秒的开票时间取日期", withTime.issued === "2026-09-02", withTime.issued);
  check("红字", parseEInvoice(einvoiceXml({ no: NO_A, blue: "N" })).red === true);
  check("专票", parseEInvoice(einvoiceXml({ no: NO_A, vat: "专用发票" })).kind === "数电专票");
  const bad = parseEInvoice(einvoiceXml({ no: NO_A, total: "101.00" }));
  check("金额不自洽能发现", checkAmounts(bad)?.includes("≠") === true, checkAmounts(bad));

  check("类别：非笼统前缀", categoryOf([{ name: "*日用杂品*牙刷", amount: 1, tax: 0, taxCode: "1060000000000000000" }]) === "日用杂品");
  check("类别：只有笼统前缀时兜底", categoryOf([{ name: "*生产生活服务*洗衣", amount: 1, tax: 0, taxCode: "3070500000000000000" }]) === "生产生活服务");
  check("类别：什么都没有", categoryOf([{ name: "服务费", amount: 1, tax: 0 }]) === "其他");

  let threw = false;
  try {
    parseEInvoice(strToU8("<Other><x/></Other>"));
  } catch {
    threw = true;
  }
  check("非数电票 XML 报错", threw);
}

// ---------- 文件识别与归组 ----------
{
  const xmlA = einvoiceXml({ no: NO_A });
  const xmlB = einvoiceXml({ no: NO_B });
  const ofd = zipSync({ "OFD.xml": strToU8("<ofd:OFD/>"), "Doc_0/Document.xml": strToU8("<x/>") });
  check("识别 PDF", sniff(PDF, "x.bin") === "pdf");
  check("识别 OFD（ZIP 结构）", sniff(ofd, "x.zip") === "ofd");
  check("识别 XML", sniff(xmlA, "noext") === "xml");

  const nested = zipSync({ "inner.zip": zipSync({ "a.xml": xmlA, "a.pdf": PDF }), "readme.txt": strToU8("hi") });
  const leaves = expandFiles([{ name: "发票.zip", data: nested }]);
  check("嵌套 ZIP 展开", leaves.map((l) => l.kind).sort().join(",") === "pdf,xml", leaves.map((l) => l.kind));

  const one = groupInvoices(
    expandFiles([
      { name: "滴滴出行行程报销单.pdf", data: TRIP },
      { name: "滴滴电子发票.pdf", data: PDF },
      { name: "invoice.xml", data: xmlA },
      { name: "invoice.ofd", data: ofd },
    ]),
    "attachment",
  );
  const b = one.bundles[0];
  check("单张：发票 PDF 归位（行程单不抢位）", b?.pdf?.name === "滴滴电子发票.pdf", b?.pdf?.name);
  check("单张：行程单进随附文件", b?.extras.map((e) => e.name).join() === "滴滴出行行程报销单.pdf", b?.extras.map((e) => e.name));
  check("单张：OFD 归位", !!b?.ofd);

  const two = groupInvoices(
    expandFiles([
      { name: `${NO_A}.xml`, data: xmlA },
      { name: `${NO_B}.xml`, data: xmlB },
      { name: `dzfp_${NO_B}_店.pdf`, data: PDF },
      { name: `${NO_A}_店.pdf`, data: PDF },
      { name: "无号码.pdf", data: PDF },
    ]),
    "attachment",
  );
  check("多张：按文件名号码配对", two.bundles.find((x) => x.invoice.number === NO_B)?.pdf?.name === `dzfp_${NO_B}_店.pdf`);
  check("多张：对不上的进 orphans", two.orphans.length === 1 && two.orphans[0]?.name === "无号码.pdf");
  check("同一号码去重", groupInvoices(expandFiles([{ name: "a.xml", data: xmlA }, { name: "b.xml", data: xmlA }]), "import").bundles.length === 1);
}

// ---------- 只有 PDF 的发票 ----------
{
  const workerRoot = globalThis as typeof globalThis & { pdfjsWorker?: unknown };
  const hadWorker = Object.prototype.hasOwnProperty.call(workerRoot, "pdfjsWorker");
  const previousWorker = workerRoot.pdfjsWorker;
  const inv = await parsePdfInvoice(PDF);
  check("PDF：号码", inv.number === "26310000000000000001", inv.number);
  check("PDF：日期", inv.issued === "2026-09-01", inv.issued);
  check("PDF：买卖方", inv.buyer.name === "测试个人" && inv.seller.name === "测试餐饮有限公司", [inv.buyer.name, inv.seller.name]);
  check("PDF：金额", inv.amount === 94.34 && inv.tax === 5.66 && inv.total === 100, [inv.amount, inv.tax, inv.total]);
  check("PDF：明细和类别", inv.items[0]?.name === "*餐饮服务*餐费" && inv.category === "餐饮", inv.items);
  check(
    "PDF：解析后恢复全局 worker，不干扰 Obsidian 查看器",
    hadWorker ? workerRoot.pdfjsWorker === previousWorker : !Object.prototype.hasOwnProperty.call(workerRoot, "pdfjsWorker"),
  );
}

// ---------- 链接提取 ----------
{
  const html =
    '<a href="https://fp.example.cn/u/Ab12Cd34">点击下载</a><a href="https://mp.weixin.qq.com/s/x">云票 —— 让开票更简单</a>' +
    '<a href="https://www.example.cn/">旺企云官网</a><a href="https://count.mail.163.com/x.do">查看安全活动</a>';
  const links = candidateLinks(html, htmlToText(html));
  check("候选链接只剩下载入口", links.length === 1 && links[0]?.url === "https://fp.example.cn/u/Ab12Cd34", links);
  check("HTML 转文字", htmlToText("<p>发票&amp;下载</p><div>第二行</div>") === "发票&下载\n第二行");
}

// ---------- 本地 HTTP：模拟「短链 → 落地页 → 带 Cookie 下载」 ----------
const xmlZip = zipSync({ [`dzfp_${NO_A}.xml`]: einvoiceXml({ no: NO_A }) });
const ofdFile = zipSync({ "OFD.xml": strToU8("<ofd:OFD/>") });
function startServer(): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer((req, res) => {
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
      const hasCookie = /session=ok/.test(req.headers.cookie ?? "");
      if (url.pathname === "/u/Ab12Cd34") {
        res.writeHead(302, { Location: `/landing?xmlUrl=${encodeURIComponent(`${base}/f/x?t=1`)}&pdfUrl=${encodeURIComponent(`${base}/f/p?t=1`)}&ofdUrl=${encodeURIComponent(`${base}/f/o?t=1`)}` });
        res.end();
      } else if (url.pathname === "/landing") {
        res.writeHead(200, { "Content-Type": "text/html", "Set-Cookie": "session=ok; Path=/" });
        res.end("<html><body>发票下载</body></html>");
      } else if (url.pathname === "/bw-page") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end('<html><body><div id="app"></div><script src="app.js"></script></body></html>');
      } else if (url.pathname === "/bwmg/mix/bw/downloadFormat") {
        const format = url.searchParams.get("formatType");
        const body = format === "XML" ? einvoiceXml({ no: NO_A }) : format === "PDF" ? PDF : ofdFile;
        const ext = format?.toLowerCase() ?? "bin";
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment;fileName=dzfp_${NO_A}.${ext}` });
        res.end(Buffer.from(body));
      } else if (url.pathname.startsWith("/f/")) {
        // 文件接口要求带着落地页种下的 Cookie
        if (!hasCookie) {
          res.writeHead(403);
          res.end();
          return;
        }
        const kind = url.pathname.slice(3);
        const body = kind === "x" ? xmlZip : kind === "p" ? PDF : ofdFile;
        const ext = kind === "x" ? "zip" : kind === "p" ? "pdf" : "ofd";
        res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment;filename=dzfp_${NO_A}.${ext}` });
        res.end(Buffer.from(body));
      } else if (url.pathname === "/direct.pdf") {
        res.writeHead(200, { "Content-Type": "application/pdf" });
        res.end(Buffer.from(PDF));
      } else if (url.pathname === "/dead") {
        res.writeHead(200, { "Content-Type": "text/html" });
        res.end("<html>请输入验证码</html>");
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, base: `http://127.0.0.1:${(server.address() as { port: number }).port}` }));
  });
}

const { server, base } = await startServer();
try {
  const files = await downloadFromLink(`${base}/u/Ab12Cd34`, nodeFetcher);
  const kinds = expandFiles(files).map((f) => f.kind).sort().join(",");
  check("链接：跟随跳转 + 落地页参数 + Cookie，拿到 XML/PDF/OFD", kinds === "ofd,pdf,xml", kinds);
  check("链接：文件名取自 Content-Disposition", files.some((f) => f.name === `dzfp_${NO_A}.pdf`), files.map((f) => f.name));

  const direct = await downloadFromLink(`${base}/direct.pdf`, nodeFetcher);
  check("链接：直接返回 PDF", direct.length === 1 && sniff(direct[0]!.data, "") === "pdf");

  const baiwangParam = "45E162425C41320DD4794A2D16CC5A06";
  const bwFetcher = (url: string, headers: Record<string, string>) => {
    const u = new URL(url);
    if (u.hostname === "pis.baiwang.com") {
      const local = new URL(u.pathname === "/smkp-vue/previewInvoiceAllEle" ? "/bw-page" : u.pathname, base);
      local.search = u.search;
      return nodeFetcher(local.toString(), headers);
    }
    return nodeFetcher(url, headers);
  };
  const baiwang = await downloadFromLink(`https://pis.baiwang.com/smkp-vue/previewInvoiceAllEle?param=${baiwangParam}`, bwFetcher);
  check("链接：百望动态页面 → downloadFormat 拿到 XML/PDF/OFD", expandFiles(baiwang).map((f) => f.kind).sort().join(",") === "ofd,pdf,xml");

  let err = "";
  try {
    await downloadFromLink(`${base}/dead`, nodeFetcher);
  } catch (e) {
    err = e instanceof DownloadError ? e.message : `非预期错误 ${String(e)}`;
  }
  check("链接：拿不到文件时说明原因", /No file URL found on the landing page/.test(err), err);
  setLocale("zh");
  try {
    await downloadFromLink(`${base}/dead`, nodeFetcher);
  } catch (e) {
    err = e instanceof DownloadError ? e.message : `非预期错误 ${String(e)}`;
  }
  setLocale("en");
  check("链接：拿不到文件时说明原因（中文）", /落地页里没找到文件地址/.test(err), err);

  // ---------- 整条管线 ----------
  const attached = await processMessage(
    await compose({
      from: '"票通" <noreply@vpiaotong.example>',
      subject: "您收到一张电子发票",
      html: '<p>请查收</p><a href="https://mp.weixin.qq.com/s/x">云票 —— 让开票更简单</a>',
      attachments: [
        { filename: `${NO_A}_店.pdf`, content: Buffer.from(PDF) },
        { filename: `${NO_A}_店.ofd`, content: Buffer.from(ofdFile) },
        { filename: `${NO_A}_店.xml`, content: Buffer.from(einvoiceXml({ no: NO_A })) },
      ],
    }),
    { fetcher: nodeFetcher },
  );
  check("管线：附件 → 1 张发票，文件齐全", attached.bundles.length === 1 && !!attached.bundles[0]?.pdf && !!attached.bundles[0]?.ofd, attached);
  check("管线：附件场景无问题", attached.problems.length === 0, attached.problems);

  const viaLink = await processMessage(
    await compose({ from: "fp@bwjf.example", subject: "电子发票", html: `<a href="${base}/u/Ab12Cd34">点击下载</a><a href="https://www.example.cn/">官网</a>` }),
    { fetcher: nodeFetcher },
  );
  check("管线：仅链接 → 下载得到发票", viaLink.bundles.length === 1 && viaLink.bundles[0]?.via === "link", viaLink.problems);
  check("管线：链接场景 PDF/OFD 也归位", !!viaLink.bundles[0]?.pdf && !!viaLink.bundles[0]?.ofd);

  const system = await processMessage(await compose({ from: "mail@service.netease.com", subject: "欢迎", html: '<a href="https://count.mail.163.com/a">查看</a>' }));
  check("管线：邮箱系统通知忽略", system.ignored === "system");

  const pdfOnly = await processMessage(await compose({ from: "a@b.example", subject: "发票", text: "见附件", attachments: [{ filename: "发票.pdf", content: Buffer.from(PDF) }] }), { fetcher: nodeFetcher });
  check("管线：只有 PDF → 直接生成发票", pdfOnly.bundles.length === 1 && pdfOnly.problems.length === 0, pdfOnly.problems);

  const dead = await processMessage(await compose({ from: "a@b.example", subject: "发票", html: `<a href="${base}/dead">下载发票</a>` }), { fetcher: nodeFetcher });
  check("管线：链接失败 → link-failed 并保留链接", dead.problems[0]?.reason === "link-failed" && dead.problems[0]?.link === `${base}/dead`, dead.problems);

  const withId = await compose({ from: "a@b.example", subject: "x", text: "y", messageId: "<abc.123@example.test>" });
  check("邮件头取 Message-ID", peekMessageId(withId) === "<abc.123@example.test>", peekMessageId(withId));
  check("Message-ID 折行也能取", peekMessageId(strToU8("Subject: x\r\nMessage-ID:\r\n <fold@x>\r\n\r\nbody")) === "<fold@x>");

  const nothing = await processMessage(await compose({ from: "a@b.example", subject: "你好", text: "吃了吗" }));
  check("管线：无关邮件忽略", nothing.ignored === "no-invoice");

  // ---------- 笔记 ----------
  const bundle = attached.bundles[0]!;
  const paths = pathsFor(bundle, DEFAULT_SETTINGS);
  check("笔记路径", paths.note === "invoices/2026/09/2026-09-01 测试餐饮有限公司 100.00.md", paths.note);
  check("原始文件按号码命名", paths.pdf === `attachments/invoices/2026/${NO_A}.pdf`, paths.pdf);
  const note = buildNote(bundle.invoice, paths, { embedPdf: true, source: "vpiaotong.example", received: "2026-09-01T04:30:00.000Z" });
  check("号码加引号防丢精度", note.includes(`invoice_no: "${NO_A}"`));
  check("金额是数字", /\ntotal: 100\.00\n/.test(note));
  check("reimbursed 初始为未勾选", note.includes("reimbursed: false") && !note.includes("\nstatus:"));
  check("表格里的 *分类* 已转义", note.includes("\\*生产生活服务\\*餐饮服务"));
  check("内嵌 PDF", note.includes(`![[attachments/invoices/2026/${NO_A}.pdf#height=450]]`));
  check("机器区标记", note.includes("%% invoice-sync:start %%") && note.includes("%% invoice-sync:end %%"));
  check("空列不画", note.includes("| 项目 | 数量 | 单价 | 金额 | 税率 | 税额 |"), note.split("\n").find((l) => l.startsWith("| 项目")));
  const flagged = buildNote(bundle.invoice, paths, { embedPdf: false, buyerMismatch: true });
  check("抬头不符标注", flagged.includes('check: "抬头不符"') && flagged.includes("[!warning] 抬头不符"));

  const baseFile = baseFileContent("invoices");
  check("总表过滤根目录", baseFile.includes('file.inFolder("invoices")') && baseFile.includes("'reimbursed != true'") && baseFile.includes("note.reimbursed"));
} finally {
  server.close();
}

console.log(`${fail === 0 ? "✓" : "✗"} ${pass} 通过，${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
