/**
 * 生成 scripts/fixtures/fake-cmap-invoice.pdf：所有文字都用未嵌入的
 * STSong-Light + UniGB-UCS2-H（数电票里真实出现过的写法），内容全是假数据。
 * pdf.js 拿不到 CMap 时这些文字会整段丢失，用来回归「PDF 里没有有效的发票号码」。
 *
 *   node scripts/make-cmap-fixture.mjs
 */
import fs from "node:fs";

// [x, y, 文字]，坐标仿照真实票面（600×400）；ASCII 按半角宽（/W），否则号码会超出页面被裁掉
const TEXTS = [
  [194, 358, "电子发票（普通发票）"],
  [440, 357, "发票号码：26110000000000000002"],
  [440, 340, "开票日期：2026年10月18日"],
  [34, 289, "名称：测试个人"],
  [321, 291, "名称：测试小吃有限公司"],
  [46, 239, "项目名称"],
  [120, 239, "规格型号"],
  [191, 239, "单位"],
  [265, 239, "数量"],
  [335, 239, "单价"],
  [408, 239, "金额"],
  [447, 239, "税率/征收率"],
  [555, 239, "税额"],
  [46, 225, "*餐饮服务*餐费"],
  [408, 225, "188.12"],
  [470, 225, "1%"],
  [555, 225, "1.88"],
  [60, 124, "合计"],
  [408, 124, "¥188.12"],
  [555, 124, "¥1.88"],
  [50, 106, "价税合计（大写）"],
  [150, 106, "壹佰玖拾圆整"],
  [409, 106, "（小写）"],
  [460, 106, "¥190.00"],
];

function ucs2Hex(text) {
  return [...text].map((ch) => ch.charCodeAt(0).toString(16).padStart(4, "0")).join("").toUpperCase();
}

const content = TEXTS.map(([x, y, text]) => `BT /F1 9 Tf ${x} ${y} Td <${ucs2Hex(text)}> Tj ET`).join("\n");

const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 600 400] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
  `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
  "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light-UniGB-UCS2-H /Encoding /UniGB-UCS2-H /DescendantFonts [6 0 R] >>",
  "<< /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> /FontDescriptor 7 0 R /DW 1000 /W [1 95 500] >>",
  "<< /Type /FontDescriptor /FontName /STSong-Light /Flags 6 /FontBBox [-25 -254 1000 880] /ItalicAngle 0 /Ascent 880 /Descent -120 /CapHeight 880 /StemV 93 >>",
];

let pdf = "%PDF-1.7\n";
const offsets = [];
objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

const out = new URL("./fixtures/fake-cmap-invoice.pdf", import.meta.url);
fs.writeFileSync(out, pdf);
console.log("wrote", out.pathname);
