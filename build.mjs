import * as esbuild from "esbuild";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

const watch = process.argv.includes("--watch");

mkdirSync("dist", { recursive: true });
copyFileSync(
  "node_modules/pdfjs-dist/legacy/build/pdf.worker.min.js",
  "dist/pdf.worker.min.js"
);

// 日本語フォント(OFL)は日本語を含む保存のときだけ読み込む。file:// でも動くよう、
// fetchではなく<script>で読めるJS(base64)として出力する。
const FONT_DIR = "node_modules/@expo-google-fonts/noto-sans-jp";
for (const [key, file] of [
  ["regular", `${FONT_DIR}/400Regular/NotoSansJP_400Regular.ttf`],
  ["bold", `${FONT_DIR}/700Bold/NotoSansJP_700Bold.ttf`],
]) {
  const b64 = readFileSync(file).toString("base64");
  writeFileSync(
    `dist/noto-sans-jp-${key}.js`,
    `window.__pdfEditorFonts=window.__pdfEditorFonts||{};window.__pdfEditorFonts.${key}="${b64}";`
  );
}
copyFileSync(`${FONT_DIR}/LICENSE_FONT`, "dist/noto-sans-jp-LICENSE.txt");

const options = {
  entryPoints: ["src/main.ts"],
  bundle: true,
  outfile: "dist/app.js",
  format: "iife",
  target: "es2020",
  sourcemap: true,
  minify: !watch,
  logLevel: "info",
};

if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watching for changes...");
} else {
  await esbuild.build(options);
}

// AI/スクリプト向けCLI(Node)。`node dist/cli.mjs inspect|apply|schema`
await esbuild.build({
  entryPoints: ["cli/main.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  outfile: "dist/cli.mjs",
  external: ["pdfjs-dist", "canvas"],
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
  logLevel: "warning",
});
