// pdf-edit CLI: AI/スクリプトから、ブラウザ無しでPDFを調べて編集する。
//
//   pdf-edit inspect <in.pdf>                 ページ寸法・フォーム項目・テキスト位置をJSONで出力
//   pdf-edit apply <in.pdf> <edit.json> -o <out.pdf>   JSON仕様(src/spec.ts)の編集を適用して保存
//   pdf-edit schema                           編集JSONの仕様(例つき)を出力
//
// 出力(stdout)は常にJSON。エラーは {"error": "..."} を出して終了コード1。
import { readFile, writeFile } from "node:fs/promises";
import { PDFCheckBox, PDFDropdown, PDFOptionList, PDFRadioGroup, PDFTextField } from "@cantoo/pdf-lib";
import { loadPdfDocument } from "../src/pdfLoad";
import { Renderer } from "../src/render";
import { applyFormValueMap } from "../src/formApply";
import { setJpFontLoader } from "../src/jpFont";
import { validateSpec, type EditSpec } from "../src/spec";
import { SCHEMA_DOC } from "../src/schemaDoc";
import { embedEditorState } from "../src/persistence";

setJpFontLoader(async (style) => {
  const file = style === "bold" ? "700Bold/NotoSansJP_700Bold.ttf" : "400Regular/NotoSansJP_400Regular.ttf";
  return new Uint8Array(await readFile(new URL(`../node_modules/@expo-google-fonts/noto-sans-jp/${file}`, import.meta.url)));
});

function fail(message: string): never {
  process.stdout.write(JSON.stringify({ error: message }, null, 2) + "\n");
  return process.exit(1);
}

async function inspect(path: string): Promise<void> {
  const bytes = new Uint8Array(await readFile(path));
  const doc = await loadPdfDocument(bytes);
  const pages = doc.getPages().map((p, i) => ({ page: i + 1, width: round(p.getWidth()), height: round(p.getHeight()) }));

  const form: unknown[] = [];
  try {
    for (const f of doc.getForm().getFields()) {
      const w = f.acroField.getWidgets()[0];
      const r = w?.getRectangle();
      const pageIdx = w ? doc.getPages().findIndex((p) => p.ref === w.P()) : -1;
      const page = pageIdx >= 0 ? doc.getPages()[pageIdx] : undefined;
      const base: Record<string, unknown> = {
        name: f.getName(),
        ...(page && r ? { page: pageIdx + 1, x: round(r.x), y: round(page.getHeight() - r.y - r.height), width: round(r.width), height: round(r.height) } : {}),
      };
      if (f instanceof PDFTextField) form.push({ ...base, kind: "text", value: f.getText() ?? "" });
      else if (f instanceof PDFCheckBox) form.push({ ...base, kind: "checkbox", value: f.isChecked() });
      else if (f instanceof PDFDropdown) form.push({ ...base, kind: "dropdown", options: f.getOptions(), value: f.getSelected() });
      else if (f instanceof PDFRadioGroup) form.push({ ...base, kind: "radio", options: f.getOptions(), value: f.getSelected() ?? null });
      else if (f instanceof PDFOptionList) form.push({ ...base, kind: "optionlist", options: f.getOptions(), value: f.getSelected() });
      else form.push({ ...base, kind: "unsupported" });
    }
  } catch {
    // フォームなし
  }

  const text = await extractText(bytes).catch((e) => ({ error: String(e) }));
  process.stdout.write(JSON.stringify({ file: path, pageCount: pages.length, pages, form, text, coordinateSystem: "pt, origin top-left, y down" }, null, 2) + "\n");
}

/** pdf.jsでテキストの位置を取り出す(AIが「どこに何があるか」を知るため)。 */
async function extractText(bytes: Uint8Array) {
  const pdfjs = (await import("pdfjs-dist/legacy/build/pdf.js")) as unknown as {
    default?: typeof import("pdfjs-dist/legacy/build/pdf.js");
  } & typeof import("pdfjs-dist/legacy/build/pdf.js");
  const lib = pdfjs.default ?? pdfjs;
  // pdf.jsは警告を console.log / warn に出す。stdoutのJSONを汚さないよう黙らせる。
  const saved = { log: console.log, warn: console.warn };
  console.log = () => undefined;
  console.warn = () => undefined;
  try {
    const doc = await lib.getDocument({
      data: bytes.slice(),
      password: "",
      standardFontDataUrl: new URL("../node_modules/pdfjs-dist/standard_fonts/", import.meta.url).pathname,
    }).promise;
    const out: { page: number; text: string; x: number; y: number; width: number; height: number; fontSize: number }[] = [];
    for (let p = 1; p <= doc.numPages; p++) {
      const page = await doc.getPage(p);
      const H = page.getViewport({ scale: 1 }).height;
      const content = await page.getTextContent();
      for (const it of content.items as { str: string; transform: number[]; width: number; height: number }[]) {
        if (!it.str.trim()) continue;
        const [, , c, d, e, f] = it.transform as [number, number, number, number, number, number];
        const size = Math.hypot(c, d);
        out.push({ page: p, text: it.str, x: round(e), y: round(H - f - size * 0.88), width: round(it.width), height: round(size), fontSize: round(size) });
      }
    }
    return out;
  } finally {
    console.log = saved.log;
    console.warn = saved.warn;
  }
}

async function apply(inPath: string, specPath: string, outPath: string): Promise<void> {
  const spec = JSON.parse(await readFile(specPath, "utf8")) as EditSpec;
  const bytes = new Uint8Array(await readFile(inPath));
  const doc = await loadPdfDocument(bytes);
  validateSpec(spec, doc.getPageCount());

  const renderer = new Renderer(doc, { readFile: async (p) => new Uint8Array(await readFile(p)) });
  const warnings: string[] = [];
  await renderer.render(spec.items ?? []);
  if (spec.form || spec.flatten) {
    warnings.push(...(await applyFormValueMap(doc, spec.form ?? {}, { flatten: !!spec.flatten, jpFont: (s) => renderer.jpFont(s) })));
  }
  // ブラウザ版アプリで開き直したとき、原本+注釈として再編集できるようにはしない(CLIは焼き込み専用)。
  void embedEditorState;
  const out = await doc.save();
  await writeFile(outPath, out);
  process.stdout.write(
    JSON.stringify({ ok: true, output: outPath, bytes: out.length, itemsApplied: (spec.items ?? []).length, formFieldsSet: Object.keys(spec.form ?? {}).length, flattened: !!spec.flatten, warnings }, null, 2) + "\n"
  );
}

const round = (n: number) => Math.round(n * 100) / 100;

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "inspect" && rest[0]) return await inspect(rest[0]);
    if (cmd === "apply" && rest[0] && rest[1]) {
      const o = rest.indexOf("-o");
      const out = o >= 0 ? rest[o + 1] : undefined;
      if (!out) fail("出力先を -o <out.pdf> で指定してください");
      return await apply(rest[0], rest[1], out);
    }
    if (cmd === "schema") {
      process.stdout.write(SCHEMA_DOC + "\n");
      return;
    }
    fail("使い方: pdf-edit inspect <in.pdf> | pdf-edit apply <in.pdf> <edit.json> -o <out.pdf> | pdf-edit schema");
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
}

void main();
