/**
 * 用摸底时保存的真实邮件跑一遍完整管线（含跟随下载链接），只在内存里，不写任何文件。
 * 输出只含结构信息：不打印发票号码、名称、金额。
 *
 * 用法：node scripts/run-smoke.mjs scripts/dry-run.ts [样本目录]
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { processMessage } from "../src/core/pipeline";
import { nodeFetcher } from "../src/invoice/download";
import { checkAmounts } from "../src/invoice/einvoice";
import { buildNote, pathsFor } from "../src/core/note-builder";
import { DEFAULT_SETTINGS } from "../src/settings";

const dir = process.argv[2] ?? "survey-output/samples";
const files = readdirSync(dir).filter((f) => f.endsWith(".eml")).sort();
const seen = new Set<string>();
let invoices = 0;
for (const f of files) {
  const out = await processMessage(new Uint8Array(readFileSync(join(dir, f))), { fetcher: nodeFetcher });
  const tag = f.replace(/\.eml$/, "");
  if (out.ignored) {
    console.log(`${tag}  忽略（${out.ignored}）`);
    continue;
  }
  for (const b of out.bundles) {
    invoices += 1;
    const inv = b.invoice;
    const dup = seen.has(inv.number) ? " 重复" : "";
    seen.add(inv.number);
    const amount = checkAmounts(inv) ? "金额✗" : "金额✓";
    const filesHave = ["xml", b.pdf ? "pdf" : "", b.ofd ? "ofd" : "", b.extras.length ? `+${b.extras.length}附件` : ""].filter(Boolean).join("/");
    const note = buildNote(inv, pathsFor(b, DEFAULT_SETTINGS), { initialStatus: "未报销", embedPdf: true });
    console.log(
      `${tag}  via=${b.via} ${inv.kind}${inv.red ? "(红)" : ""} ${inv.category} ${inv.issued} ${amount} 号码${inv.number.length}位 明细${inv.items.length}行 税号${[inv.seller.taxId, inv.buyer.taxId].filter(Boolean).length}个 文件=${filesHave} 笔记${note.length}字${dup}`,
    );
  }
  for (const p of out.problems) console.log(`${tag}  问题 ${p.reason}：${p.detail.replace(/\d{6,}/g, "#")}`);
}
console.log(`\n共 ${files.length} 封 → ${invoices} 张发票（去重后 ${seen.size} 张）`);
