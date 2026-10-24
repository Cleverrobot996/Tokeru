// 生成给 AI 的导入提示词：把 importPrompt.ts 打包成 ESM 后调用 buildPrompt。
// 用法：node tools/e2e/gen-prompt.mjs --material tools/e2e/xxx.md --title "标题" --out tools/e2e/xxx.prompt.txt
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const args = process.argv.slice(2);
function arg(name, fallback = "") {
  const i = args.indexOf("--" + name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}
const materialPath = arg("material");
const title = arg("title");
const outPath = arg("out");
const extra = arg("extra");
if (!materialPath || !outPath) {
  console.error("用法: node tools/e2e/gen-prompt.mjs --material <file> --title <标题> --out <prompt.txt> [--extra <补充要求>]");
  process.exit(2);
}
const root = resolve(process.cwd());
const bundle = resolve(root, ".tmp/importPrompt.mjs");
mkdirSync(dirname(bundle), { recursive: true });
mkdirSync(dirname(resolve(root, outPath)), { recursive: true });
// Windows 下 .bin/esbuild 是 bash shim，spawnSync 不能直接执行，必须用真实 .exe。
function findEsbuild() {
  const direct = resolve(root, "node_modules/.pnpm/@esbuild+win32-x64@0.28.2/node_modules/@esbuild/win32-x64/esbuild.exe");
  if (existsSync(direct)) return direct;
  const pnpmDir = resolve(root, "node_modules/.pnpm");
  if (existsSync(pnpmDir)) {
    for (const name of readdirSync(pnpmDir)) {
      if (!name.startsWith("@esbuild+win32-x64@")) continue;
      const p = resolve(pnpmDir, name, "node_modules/@esbuild/win32-x64/esbuild.exe");
      if (existsSync(p)) return p;
    }
  }
  return null;
}
const esbuild = findEsbuild();
if (!esbuild) {
  console.error("找不到 esbuild.exe，请先 pnpm install");
  process.exit(2);
}
const r = spawnSync(esbuild, ["src/lib/importPrompt.ts", "--bundle", "--format=esm", "--platform=node", "--outfile=" + bundle], { stdio: "inherit" });
if (r.status !== 0) process.exit(r.status ?? 1);
const mod = await import(pathToFileURL(bundle).href);
const material = readFileSync(resolve(root, materialPath), "utf8");
const prompt = mod.buildPrompt({ material, title: title || undefined, extra: extra || undefined });
writeFileSync(resolve(root, outPath), prompt, "utf8");
console.log("prompt chars:", prompt.length, "spec chars:", mod.IMPORT_SPEC.length);
