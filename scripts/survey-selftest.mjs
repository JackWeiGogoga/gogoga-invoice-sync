/**
 * 摸底脚本自测：用合成邮件覆盖各种形态，走一遍完整的 --from-dir 流程，
 * 检查分类是否正确、输出里有没有漏出号码/token/税号。
 *
 * 不连网络，不需要授权码。
 */
import MailComposer from "nodemailer/lib/mail-composer";
import { zipSync, strToU8 } from "fflate";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fx = (n) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url));
const pdfInvoice = fx("fake-invoice.pdf");
const pdfTrip = fx("fake-trip.pdf");
const pdfScan = fx("fake-scan.pdf");
const INVOICE_NO = "26310000000000000001";
const xml = Buffer.from(`<?xml version="1.0" encoding="UTF-8"?><EInvoice><Header><EIid>${INVOICE_NO}</EIid></Header><EInvoiceData><SellerInformation/></EInvoiceData></EInvoice>`);
const ofd = Buffer.from(zipSync({ "OFD.xml": strToU8("<ofd:OFD/>"), "Doc_0/Document.xml": strToU8("<ofd:Document/>") }));
const zip = Buffer.from(zipSync({ "invoice.pdf": pdfInvoice, "invoice.xml": xml, "readme.txt": strToU8("hi") }));
const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 1)]);
const TO = "inbox@example.test";

function compose(opts) {
  return new Promise((res, rej) =>
    new MailComposer({ to: TO, ...opts }).compile().build((err, msg) => (err ? rej(err) : res(msg))),
  );
}

/** 手工拼一封 GBK 编码附件名的邮件——mailparser 必须能解出中文名。 */
function gbkMail() {
  const b64 = (buf) => buf.toString("base64").replace(/.{76}/g, "$&\r\n");
  return Buffer.from(
    [
      "From: fp@gbk.example.org",
      `To: ${TO}`,
      "Subject: =?GBK?B?t6LGsQ==?=",
      "MIME-Version: 1.0",
      'Content-Type: multipart/mixed; boundary="BOUND"',
      "",
      "--BOUND",
      "Content-Type: text/plain; charset=utf-8",
      "",
      "see attachment",
      "--BOUND",
      'Content-Type: application/octet-stream; name="=?GBK?B?t6LGsS5wZGY=?="',
      'Content-Disposition: attachment; filename="=?GBK?B?t6LGsS5wZGY=?="',
      "Content-Transfer-Encoding: base64",
      "",
      b64(pdfInvoice),
      "--BOUND--",
      "",
    ].join("\r\n"),
  );
}

const cases = {
  "01-direct": await compose({
    from: '"诺诺发票" <invoice@mail.nuonuo.com>',
    subject: `您收到一张【测试餐饮有限公司】开具的电子发票 ${INVOICE_NO}`,
    html: '<p>请查收</p><a href="https://nnfp.jss.com.cn/scan/abcDEF1234567890xyz?code=zzz">查看发票</a>',
    attachments: [
      { filename: "dzfp.pdf", content: pdfInvoice },
      { filename: "dzfp.xml", content: xml },
      { filename: "dzfp.ofd", content: ofd },
    ],
  }),
  "02-zip": await compose({
    from: "noreply@fapiao.baiwang.com",
    subject: "电子发票下载",
    text: "见附件",
    attachments: [{ filename: "发票.zip", content: zip }],
  }),
  "03-link-only": await compose({
    from: "fapiao@jd.com",
    subject: "您的发票已开具",
    html:
      '<p>您的发票已开具</p><a href="https://invoice.jd.com/download/ABCDEF1234567890abcdef.pdf?token=secret123&amp;id=99">点击下载电子发票</a>' +
      '<p>提取码：a1b2</p><a href="https://jd.com/unsubscribe">退订</a><a href="https://www.jd.com/">京东首页</a>',
  }),
  "04-forward-quoted": await compose({
    from: "someone@qq.com",
    subject: "转发：您的滴滴出行电子发票",
    text: '请查收\n\n-------- 转发邮件信息 --------\n发件人："滴滴出行" <didifapiao@mailgate.xiaojukeji.com>\n发送日期：2026-09-02\n主题：您的滴滴出行电子发票\n',
    attachments: [
      { filename: "滴滴电子发票.pdf", content: pdfInvoice },
      { filename: "滴滴出行行程报销单.pdf", content: pdfTrip },
    ],
  }),
  "05-forward-attached": await compose({
    from: "someone@qq.com",
    subject: "Fw: 住宿发票",
    text: "转给发票邮箱",
    attachments: [
      {
        filename: "original.eml",
        contentType: "message/rfc822",
        content: await compose({
          from: "tax@hotel.example.com.cn",
          subject: "住宿发票",
          text: "附件为发票",
          attachments: [{ filename: "invoice.pdf", content: pdfInvoice }],
        }),
      },
    ],
  }),
  "06-inline-only": await compose({
    from: "hello@news.example.com",
    subject: "感谢使用",
    html: '<img src="cid:logo1"><p>感谢使用</p>',
    attachments: [{ filename: "logo.png", content: png, cid: "logo1" }],
  }),
  "07-gbk-name": gbkMail(),
  "08-scanned": await compose({
    from: "scan@example.org",
    subject: "扫描件",
    text: "附件",
    attachments: [{ filename: "scan.pdf", content: pdfScan }],
  }),
  "09-short-link": await compose({
    from: "noreply@example.net",
    subject: "发票通知",
    html: '<a href="https://t.cn/AbCdEf12">查看发票</a><a href="https://fp.example.cn/u/Xy3kP9qLm2Z">点击下载</a>',
  }),
  "10-photo": await compose({
    from: "me@qq.com",
    subject: "纸质发票照片",
    text: "拍的",
    attachments: [{ filename: "photo.jpg", content: jpg }],
  }),
};

const dir = await mkdtemp(join(tmpdir(), "invoice-survey-"));
for (const [name, raw] of Object.entries(cases)) await writeFile(join(dir, `${name}.eml`), raw);
const out = join(dir, "out");
execFileSync(process.execPath, [new URL("./survey.mjs", import.meta.url).pathname, "--from-dir", dir, "--out", out], {
  stdio: "ignore",
});

const json = await readFile(join(out, "messages.json"), "utf8");
const report = await readFile(join(out, "report.md"), "utf8");
const { records, meta } = JSON.parse(json);
const byCase = Object.fromEntries(records.map((r) => [r.uid.replace(/\.eml$/, ""), r]));

let pass = 0;
let fail = 0;
function check(label, ok, detail) {
  if (ok) pass += 1;
  else {
    fail += 1;
    console.log(`✗ ${label}${detail !== undefined ? `  → ${JSON.stringify(detail)}` : ""}`);
  }
}
const kinds = (r) => r.files.map((f) => f.pdf?.kind).filter(Boolean).sort();

check("全部解析成功", meta.errors.length === 0 && records.length === 10, meta.errors);

const d = byCase["01-direct"];
check("直发：形态 pdf+ofd+xml", d.shape === "pdf+ofd+xml", d.shape);
check("直发：平台为 nuonuo.com", d.platform === "nuonuo.com", d.platform);
check("直发：票种为数电普票", kinds(d)[0] === "数电普票", kinds(d));
check("直发：检测到康熙部首", d.files[0].pdf.radicals > 0, d.files[0].pdf);
check("直发：规范化后号码与标签相邻", d.files[0].pdf.invoiceNoAdjacent === true);
check("直发：税号识别 2 个", d.files[0].pdf.hasTaxIdCount === 2, d.files[0].pdf.hasTaxIdCount);
check("直发：XML 根节点", d.files[1].xml?.root === "EInvoice", d.files[1].xml);
check("直发：主题里的号码被打码", d.subject.includes("#") && !d.subject.includes(INVOICE_NO), d.subject);

const z = byCase["02-zip"];
check("ZIP：形态 zip(pdf+xml+other)", z.shape === "zip(pdf+xml+other)", z.shape);
check("ZIP：内部 PDF 也做了票种分析", z.files[0].inner.find((f) => f.kind === "pdf")?.pdf?.kind === "数电普票");

const l = byCase["03-link-only"];
check("仅链接：形态", l.shape === "仅链接", l.shape);
check("仅链接：提到提取码", l.mentionsCode === true);
const dl = l.links.find((x) => x.host === "invoice.jd.com");
check("仅链接：路径模式去掉 id 与参数值", dl?.pattern === "invoice.jd.com/download/:id.pdf?[token,id]", dl?.pattern);
check("仅链接：下载链接是候选", dl?.candidate === true);
check("仅链接：退订与首页不是候选", l.links.filter((x) => x.candidate).length === 1, l.links);

const fq = byCase["04-forward-quoted"];
check("正文转发：识别方式", fq.forwardVia === "正文转发", fq.forwardVia);
check("正文转发：原始平台 xiaojukeji.com", fq.platform === "xiaojukeji.com", fq.platform);
check("正文转发：发票 + 行程单", JSON.stringify(kinds(fq)) === JSON.stringify(["数电普票", "行程单(非发票)"]), kinds(fq));

const fa = byCase["05-forward-attached"];
check("附件转发：识别方式", fa.forwardVia === "附件转发", fa.forwardVia);
check("附件转发：原始平台 example.com.cn", fa.platform === "example.com.cn", fa.platform);
check("附件转发：拆出内层 PDF", fa.shape === "pdf", fa.shape);

const io = byCase["06-inline-only"];
check("内嵌图：不算附件", io.shape === "无附件无链接" && io.inlineImages === 1, [io.shape, io.inlineImages]);

const g = byCase["07-gbk-name"];
check("GBK 附件名解码", g.files[0]?.name === "发票.pdf", g.files[0]?.name);
check("octet-stream 按文件头认出 PDF", g.files[0]?.kind === "pdf", g.files[0]?.kind);

check("扫描件：无文本层", kinds(byCase["08-scanned"])[0] === "无文本层", kinds(byCase["08-scanned"]));
const sl = byCase["09-short-link"];
check("短链：标记为短链", sl.shape === "仅链接" && sl.links[0]?.short === true, sl.links);
check("平台短码打码", sl.links.some((x) => x.pattern === "fp.example.cn/u/:id"), sl.links.map((x) => x.pattern));
check("照片：形态 img", byCase["10-photo"].shape === "img", byCase["10-photo"].shape);

// 隐私：这些具体值都不应出现在任何输出里
for (const secret of [INVOICE_NO, "secret123", "ABCDEF1234567890abcdef", "a1b2", "91310000MA1FL00000", "didifapiao@", "someone@qq.com", "tax@hotel", "abcDEF1234567890xyz", "zzz", "AbCdEf12", "Xy3kP9qLm2Z"]) {
  check(`输出不含「${secret}」`, !json.includes(secret) && !report.includes(secret));
}

for (const s of ["# 发票邮箱摸底报告", "## 五、只有下载链接的邮件", "invoice.jd.com", "nuonuo.com", "康熙部首"]) {
  check(`报告含「${s}」`, report.includes(s));
}

console.log(`${fail === 0 ? "✓" : "✗"} ${pass} 通过，${fail} 失败`);
if (fail === 0) console.log(`报告样例：${join(out, "report.md")}`);
process.exit(fail === 0 ? 0 : 1);
