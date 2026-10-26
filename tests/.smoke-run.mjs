// テスト実行: jsdom上でindex.htmlを読み込み、実際のfabric/pdf-libを使って各操作を検証する。
import { JSDOM } from "jsdom";
import { readFileSync } from "node:fs";
import { build } from "esbuild";
import { spawnSync } from "node:child_process";

const dom = new JSDOM(readFileSync("index.html", "utf8").replace(/<script[^>]*><\/script>/, ""), {
  pretendToBeVisual: true,
  resources: "usable",
});
for (const k of Object.getOwnPropertyNames(dom.window)) {
  if (k in globalThis || k === "window" || k === "document") continue;
  {
    let override;
    Object.defineProperty(globalThis, k, {
      get: () => (override !== undefined ? override : dom.window[k]),
      set: (v) => { override = v; },
      configurable: true,
    });
  }
}
Object.defineProperty(globalThis, "window", { value: dom.window, configurable: true });
Object.defineProperty(globalThis, "document", { value: dom.window.document, configurable: true });
Object.defineProperty(globalThis, "navigator", { value: dom.window.navigator, configurable: true });
globalThis.alert = () => {};
globalThis.requestAnimationFrame = (f) => setTimeout(f, 0);

await build({
  entryPoints: ["tests/entry.ts"], bundle: true, platform: "node", format: "esm",
  outfile: "tests/.build/entry.mjs", external: ["canvas", "jsdom"], logLevel: "error", minify: process.env.MINIFY === "1",
  banner: { js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);" },
});
globalThis.__app = await import("./.build/entry.mjs");
await import(process.env.SMOKE);
