// 仕様(SpecItem)をpdf-libでPDFページへ描く。DOMに依存しないため、ブラウザの保存処理と
// Node製CLIの両方から同じコードで使える(=画面とCLIの結果がずれない)。
import {
  PDFDocument,
  PDFFont,
  PDFPage,
  StandardFonts,
  degrees,
  rgb,
} from "@cantoo/pdf-lib";
import { needsJpFont, embedJpFont, type JpFontStyle } from "./jpFont";
import { normalizeColor, type SpecItem, type TextItem } from "./spec";

/** 1行目のベースラインの、枠上端からの距離(fontSizeの倍数)。画面(fabric)の描画位置に合わせた値。 */
export const BASELINE_RATIO = 0.879;

export interface RenderEnv {
  /** path 指定の画像を読む(CLI用)。ブラウザでは未指定 */
  readFile?: (path: string) => Promise<Uint8Array>;
}

interface StdFonts {
  regular: PDFFont;
  bold: PDFFont;
  oblique: PDFFont;
  boldOblique: PDFFont;
}

export class Renderer {
  private std?: Promise<StdFonts>;
  private jp: Partial<Record<JpFontStyle, Promise<PDFFont>>> = {};

  constructor(
    readonly doc: PDFDocument,
    private env: RenderEnv = {}
  ) {}

  stdFonts(): Promise<StdFonts> {
    return (this.std ??= (async () => ({
      regular: await this.doc.embedFont(StandardFonts.Helvetica),
      bold: await this.doc.embedFont(StandardFonts.HelveticaBold),
      oblique: await this.doc.embedFont(StandardFonts.HelveticaOblique),
      boldOblique: await this.doc.embedFont(StandardFonts.HelveticaBoldOblique),
    }))());
  }

  jpFont(style: JpFontStyle): Promise<PDFFont> {
    return (this.jp[style] ??= embedJpFont(this.doc, style));
  }

  async fontFor(item: TextItem): Promise<PDFFont> {
    if (needsJpFont(item.text)) return this.jpFont(item.bold ? "bold" : "regular");
    const f = await this.stdFonts();
    if (item.bold && item.italic) return f.boldOblique;
    if (item.bold) return f.bold;
    if (item.italic) return f.oblique;
    return f.regular;
  }

  async render(items: SpecItem[]): Promise<void> {
    const pages = this.doc.getPages();
    for (const item of items) {
      const page = pages[item.page - 1];
      if (!page) throw new Error(`page ${item.page} が存在しません`);
      await this.drawItem(page, item);
    }
  }

  async drawItem(page: PDFPage, item: SpecItem): Promise<void> {
    const H = page.getHeight();
    const rot = item.rotation ?? 0;
    const opacity = item.opacity ?? 1;
    // 左上基準・y下向きの局所座標(lx,ly) → PDF座標
    const rad = (rot * Math.PI) / 180;
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const toPdf = (lx: number, ly: number) => ({
      x: item.x + lx * cos - ly * sin,
      y: H - (item.y + lx * sin + ly * cos),
    });
    const rotate = rot ? degrees(-rot) : undefined;

    switch (item.type) {
      case "text": {
        const text = item;
        const font = await this.fontFor(text);
        const size = text.fontSize ?? 12;
        const color = normalizeColor(text.color) ?? "#000000";
        const lines = text.lines ?? wrapText(text.text, font, size, text.width);
        const lh = size * (text.lineHeight ?? 1.2);
        const boxW = text.width ?? Math.max(0, ...lines.map((l) => font.widthOfTextAtSize(l, size)));

        // 背景は画面(fabric)と同じく、各行の文字幅だけを塗る。
        const bg = normalizeColor(text.background);
        const lineOffset = (w: number) => (text.align === "center" ? (boxW - w) / 2 : text.align === "right" ? boxW - w : 0);
        if (bg) {
          lines.forEach((line, i) => {
            if (!line) return;
            const w = font.widthOfTextAtSize(line, size);
            const h = size * 1.13;
            const bl = toPdf(lineOffset(w), i * lh + h);
            page.drawRectangle({ x: bl.x, y: bl.y, width: w, height: h, color: toRgb(bg), rotate, opacity });
          });
        }
        lines.forEach((line, i) => {
          if (!line) return;
          const w = font.widthOfTextAtSize(line, size);
          const p = toPdf(lineOffset(w), size * BASELINE_RATIO + i * lh);
          page.drawText(line, { x: p.x, y: p.y, size, font, color: toRgb(color), rotate, opacity });
        });
        return;
      }
      case "rect": {
        const stroke = normalizeColor(item.stroke);
        const fill = normalizeColor(item.fill);
        const bl = toPdf(0, item.height);
        page.drawRectangle({
          x: bl.x,
          y: bl.y,
          width: item.width,
          height: item.height,
          rotate,
          opacity,
          ...(fill ? { color: toRgb(fill) } : {}),
          ...(stroke ? { borderColor: toRgb(stroke), borderWidth: item.strokeWidth ?? 1, borderOpacity: opacity } : {}),
        });
        return;
      }
      case "ellipse": {
        const stroke = normalizeColor(item.stroke);
        const fill = normalizeColor(item.fill);
        const c = toPdf(item.width / 2, item.height / 2);
        page.drawEllipse({
          x: c.x,
          y: c.y,
          xScale: item.width / 2,
          yScale: item.height / 2,
          rotate,
          opacity,
          ...(fill ? { color: toRgb(fill) } : {}),
          ...(stroke ? { borderColor: toRgb(stroke), borderWidth: item.strokeWidth ?? 1, borderOpacity: opacity } : {}),
        });
        return;
      }
      case "line": {
        page.drawLine({
          start: { x: item.x, y: H - item.y },
          end: { x: item.x2, y: H - item.y2 },
          thickness: item.strokeWidth ?? 1,
          color: toRgb(normalizeColor(item.stroke) ?? "#000000"),
          opacity,
        });
        return;
      }
      case "image": {
        const bytes = await this.imageBytes(item);
        const img = isPng(bytes) ? await this.doc.embedPng(bytes) : await this.doc.embedJpg(bytes);
        const bl = toPdf(0, item.height);
        page.drawImage(img, { x: bl.x, y: bl.y, width: item.width, height: item.height, rotate, opacity });
        return;
      }
    }
  }

  private async imageBytes(item: { src?: string; path?: string }): Promise<Uint8Array> {
    if (item.src) {
      const m = /^data:image\/(png|jpe?g);base64,(.*)$/s.exec(item.src);
      if (!m) throw new Error("image.src は data:image/png;base64,... か data:image/jpeg;base64,... で指定してください");
      return base64ToBytes(m[2] as string);
    }
    if (item.path) {
      if (!this.env.readFile) throw new Error("image.path はCLIでのみ使えます。ブラウザでは src(data URL)を使ってください");
      return this.env.readFile(item.path);
    }
    throw new Error("image には src か path が必要です");
  }
}

function toRgb(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  return rgb(((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255);
}

function isPng(b: Uint8Array): boolean {
  return b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 幅 width(pt) に収まるよう折り返す。英語は単語境界、日本語は文字単位で折る。width 未指定なら \n のみで改行。 */
export function wrapText(text: string, font: PDFFont, size: number, width?: number): string[] {
  const paragraphs = text.split("\n");
  if (!width) return paragraphs;
  const out: string[] = [];
  for (const para of paragraphs) {
    let line = "";
    let lastSpace = -1;
    for (const ch of para) {
      const next = line + ch;
      if (line && font.widthOfTextAtSize(next, size) > width) {
        if (lastSpace > 0 && ch !== " ") {
          out.push(line.slice(0, lastSpace));
          line = line.slice(lastSpace + 1) + ch;
        } else {
          out.push(line);
          line = ch === " " ? "" : ch;
        }
        lastSpace = -1;
      } else {
        line = next;
      }
      if (ch === " ") lastSpace = line.length - 1;
    }
    out.push(line);
  }
  return out;
}
