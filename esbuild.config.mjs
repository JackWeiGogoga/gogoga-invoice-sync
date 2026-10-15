import esbuild from "esbuild";
import { builtinModules as builtins } from "node:module";

const production = process.argv.includes("production");

const context = await esbuild.context({
  entryPoints: ["src/main.ts"],
  bundle: true,
  // IMAP 与邮件解析依赖 Node（tls/stream），按 node 平台打包；Node 内置模块留给运行时 require
  platform: "node",
  external: ["obsidian", "electron", ...builtins, ...builtins.map((m) => `node:${m}`)],
  format: "cjs",
  target: "es2022",
  logLevel: "info",
  sourcemap: production ? false : "inline",
  treeShaking: true,
  minify: production,
  outfile: "dist/main.js",
});

if (production) {
  await context.rebuild();
  await context.dispose();
} else {
  await context.watch();
}
