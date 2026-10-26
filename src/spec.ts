// 「PDFに何を足すか」をJSONで表す仕様。人間のUI操作・AI・CLIのすべてがこの形を共通で使う。
//
// 座標系: 単位は PDF の pt(1/72 inch)。原点はページ左上、x は右向き、y は下向き。
// page は 1 始まり。rotation は左上(x,y)を中心に時計回りへ回す角度(度)。
// 色は "#rrggbb"。stroke / fill / background を省略(または "none")すると、その要素は描かない。

export interface SpecBase {
  /** 1始まりのページ番号 */
  page: number;
  /** 左上の座標(pt) */
  x: number;
  y: number;
  /** 0〜1。省略時は 1 */
  opacity?: number;
  /** 度。左上を中心に時計回り。省略時は 0 */
  rotation?: number;
  /** 後から update / remove するための識別子(省略可)。 */
  id?: string;
}

export interface TextItem extends SpecBase {
  type: "text";
  text: string;
  /** 文字サイズ(pt)。省略時 12 */
  fontSize?: number;
  /** 文字色。省略時 #000000 */
  color?: string;
  bold?: boolean;
  italic?: boolean;
  align?: "left" | "center" | "right";
  /** 折り返し幅(pt)。省略すると折り返さず、改行(\n)だけで改行する */
  width?: number;
  /** 行の高さ(fontSizeの倍数)。省略時 1.2 */
  lineHeight?: number;
  /** 背景色(テキスト枠全体を塗る) */
  background?: string;
  /** 折り返し済みの行。指定した場合は text の折り返し計算より優先する(画面と同じ折り返しにするため) */
  lines?: string[];
}

export interface RectItem extends SpecBase {
  type: "rect";
  width: number;
  height: number;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
}

export interface EllipseItem extends SpecBase {
  type: "ellipse";
  width: number;
  height: number;
  stroke?: string;
  strokeWidth?: number;
  fill?: string;
}

export interface LineItem extends SpecBase {
  type: "line";
  /** 終点(pt)。x,y が始点 */
  x2: number;
  y2: number;
  stroke?: string;
  strokeWidth?: number;
}

export interface ImageItem extends SpecBase {
  type: "image";
  width: number;
  height: number;
  /** data:image/png;base64,... / data:image/jpeg;base64,... */
  src?: string;
  /** CLI のみ: 画像ファイルのパス(PNG / JPEG) */
  path?: string;
}

export type SpecItem = TextItem | RectItem | EllipseItem | LineItem | ImageItem;

/** CLI / API に渡す編集指示の全体 */
export interface EditSpec {
  items?: SpecItem[];
  /** フォーム項目名 → 値(文字列 / 真偽値 / 文字列配列) */
  form?: Record<string, string | boolean | string[]>;
  /** true なら、フォームを確定(編集不可に)して保存する */
  flatten?: boolean;
}

export function normalizeColor(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const v = value.trim().toLowerCase();
  if (!v || v === "none" || v === "transparent") return undefined;
  if (/^#[0-9a-f]{6}$/.test(v)) return v;
  if (/^#[0-9a-f]{3}$/.test(v)) return "#" + v.slice(1).split("").map((c) => c + c).join("");
  throw new Error(`色は "#rrggbb" 形式で指定してください: ${JSON.stringify(value)}`);
}

/** 仕様の検証。不正なら、AIが直しやすい具体的なメッセージで例外にする。 */
export function validateSpec(spec: EditSpec, pageCount?: number): void {
  const items = spec.items ?? [];
  if (!Array.isArray(items)) throw new Error("items は配列で指定してください");
  items.forEach((it, i) => {
    const where = `items[${i}]`;
    if (!it || typeof it !== "object") throw new Error(`${where}: オブジェクトで指定してください`);
    const type = (it as { type?: string }).type;
    if (!["text", "rect", "ellipse", "line", "image"].includes(type ?? "")) {
      throw new Error(`${where}: type は text / rect / ellipse / line / image のいずれかです (指定値: ${JSON.stringify(type)})`);
    }
    if (!Number.isInteger(it.page) || it.page < 1) throw new Error(`${where}: page は1以上の整数です`);
    if (pageCount !== undefined && it.page > pageCount) {
      throw new Error(`${where}: page ${it.page} は存在しません(このPDFは ${pageCount} ページ)`);
    }
    for (const k of ["x", "y"] as const) {
      if (typeof it[k] !== "number" || !Number.isFinite(it[k])) throw new Error(`${where}: ${k} は数値(pt)で指定してください`);
    }
    if (it.type === "text" && typeof it.text !== "string") throw new Error(`${where}: text は文字列です`);
    if (it.type === "rect" || it.type === "ellipse" || it.type === "image") {
      if (!(it.width > 0) || !(it.height > 0)) throw new Error(`${where}: width と height は正の数(pt)で指定してください`);
    }
    if (it.type === "line" && (typeof it.x2 !== "number" || typeof it.y2 !== "number")) {
      throw new Error(`${where}: line には x2, y2 が必要です`);
    }
    if (it.type === "image" && !it.src && !it.path) throw new Error(`${where}: image には src(data URL)か path が必要です`);
    if (it.opacity !== undefined && !(it.opacity >= 0 && it.opacity <= 1)) throw new Error(`${where}: opacity は0〜1です`);
    for (const k of ["color", "stroke", "fill", "background"] as const) {
      if (k in it) normalizeColor((it as unknown as Record<string, unknown>)[k]);
    }
  });
}
