// 日本語(WinAnsiに無い文字)を含むテキストを描画するためのフォント読み込み。
// フォントは大きい(数MB)ため、日本語を含む保存のときだけ別ファイルを読み込む。
import type { PDFDocument, PDFFont } from "@cantoo/pdf-lib";
import fontkit from "@cantoo/fontkit";

export type JpFontStyle = "regular" | "bold";

declare global {
  interface Window {
    __pdfEditorFonts?: Partial<Record<JpFontStyle, string>>;
  }
}

/** Latin-1の範囲外の文字(日本語など)を含むか。標準フォントで描けるかの判定に使う。 */
export function needsJpFont(text: string): boolean {
  return /[^\u0000-ÿ]/.test(text);
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

const loading: Partial<Record<JpFontStyle, Promise<Uint8Array>>> = {};

/** テストなどで読み込み方法を差し替えるための口。 */
let loader: (style: JpFontStyle) => Promise<Uint8Array> = loadViaScriptTag;
export function setJpFontLoader(fn: typeof loader): void {
  loader = fn;
}

function loadViaScriptTag(style: JpFontStyle): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const existing = window.__pdfEditorFonts?.[style];
    if (existing) return resolve(base64ToBytes(existing));
    const script = document.createElement("script");
    script.src = `dist/noto-sans-jp-${style}.js`;
    script.onload = () => {
      const b64 = window.__pdfEditorFonts?.[style];
      if (b64) resolve(base64ToBytes(b64));
      else reject(new Error("日本語フォントの読み込み結果が空です"));
    };
    script.onerror = () => reject(new Error("日本語フォント(dist/noto-sans-jp-*.js)を読み込めません"));
    document.head.appendChild(script);
  });
}

function getBytes(style: JpFontStyle): Promise<Uint8Array> {
  return (loading[style] ??= loader(style).catch((err) => {
    delete loading[style];
    throw err;
  }));
}

/** 文書に日本語フォントを埋め込む(使った文字だけのサブセット)。 */
export async function embedJpFont(doc: PDFDocument, style: JpFontStyle): Promise<PDFFont> {
  doc.registerFontkit(fontkit);
  return doc.embedFont(await getBytes(style), { subset: true });
}
