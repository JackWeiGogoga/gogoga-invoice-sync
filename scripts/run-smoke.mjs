/** 用 esbuild 把 TS 测试打成 mjs 再执行（不引入额外的 TS 运行时）。 */
import esbuild from "esbuild";
import { execFileSync } from "node:child_process";
import path from "node:path";

const entry = process.argv[2] ?? "scripts/smoke.ts";
// 输出放在 node_modules/.cache 下，运行时能就近解析依赖
const out = path.resolve("node_modules/.cache/invoice-sync", path.basename(entry).replace(/\.ts$/, ".mjs"));

await esbuild.build({
  entryPoints: [entry],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  // 测试不加载 Obsidian；被测模块只从 obsidian 引类型
  external: ["obsidian"],
  outfile: out,
  logLevel: "warning",
});

execFileSync(process.execPath, [out, ...process.argv.slice(3)], { stdio: "inherit", env: process.env });
