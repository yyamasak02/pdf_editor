// 画面上のfabricオブジェクト ⇔ 仕様(SpecItem) の変換。
// 保存処理(fabric→spec→render)、ページ内API、コピー&ペーストで共用する。
import { fabric } from "fabric";
import { RENDER_SCALE as S } from "./constants";
import { normalizeColor, type SpecItem } from "./spec";

const FONT_FAMILY = 'Helvetica, Arial, "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';

type WithId = fabric.Object & { id?: string };

export function getObjectId(obj: fabric.Object): string | undefined {
  return (obj as WithId).id;
}

export function setObjectId(obj: fabric.Object, id: string): void {
  (obj as WithId).id = id;
}

let seq = 0;
export function newId(): string {
  return `obj-${Date.now().toString(36)}-${(seq++).toString(36)}`;
}

function safeColor(v: unknown): string | undefined {
  try {
    return normalizeColor(v);
  } catch {
    return undefined;
  }
}

const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
const r2 = (n: number) => Math.round(n * 100) / 100;

function isTextObj(o: fabric.Object): o is fabric.Textbox | fabric.IText {
  return o instanceof fabric.Textbox || o instanceof fabric.IText;
}

/** 回転込みの外枠の左上から、(dx,dy)(px, 物体の局所座標)だけ進んだ位置を返す。 */
function offsetAlong(tl: { x: number; y: number }, angleDeg: number, dx: number, dy: number) {
  const a = (angleDeg * Math.PI) / 180;
  return { x: tl.x + dx * Math.cos(a) - dy * Math.sin(a), y: tl.y + dx * Math.sin(a) + dy * Math.cos(a) };
}

/**
 * fabricオブジェクトを仕様へ変換する。pageIndex は0始まり。
 * 変換できない種類は null(その要素は保存されない)。
 */
export function fabricToSpec(obj: fabric.Object, pageIndex: number): SpecItem | null {
  const page = pageIndex + 1;
  const id = getObjectId(obj);
  const angle = obj.angle ?? 0;
  const common = {
    page,
    ...(id ? { id } : {}),
    ...(obj.opacity !== undefined && obj.opacity !== 1 ? { opacity: r2(obj.opacity) } : {}),
    ...(angle ? { rotation: r2(angle) } : {}),
  };
  obj.setCoords();
  const c = (obj as unknown as {
    calcACoords(): Record<"tl" | "tr" | "bl" | "br", { x: number; y: number }>;
  }).calcACoords();
  const tl = c.tl;
  const sx = obj.scaleX ?? 1;
  const sy = obj.scaleY ?? 1;

  if (isTextObj(obj)) {
    const fs = ((obj.fontSize ?? 20) * sy) / S;
    const lines = (obj as unknown as { textLines?: string[] }).textLines;
    const mult = (obj as unknown as { _fontSizeMult?: number })._fontSizeMult ?? 1.13;
    const align = obj.textAlign === "center" || obj.textAlign === "right" ? obj.textAlign : "left";
    const bg = safeColor(obj.textBackgroundColor);
    const color = safeColor(obj.fill);
    return {
      type: "text",
      ...common,
      x: r2(tl.x / S),
      y: r2(tl.y / S),
      text: String(obj.text ?? ""),
      fontSize: r2(fs),
      ...(color ? { color } : {}),
      ...(obj.fontWeight === "bold" || obj.fontWeight === 700 ? { bold: true } : {}),
      ...(obj.fontStyle === "italic" ? { italic: true } : {}),
      align,
      width: r2(((obj.width ?? 0) * sx) / S),
      lineHeight: r2((obj.lineHeight ?? 1.16) * mult),
      ...(bg ? { background: bg } : {}),
      ...(lines?.length ? { lines: [...lines] } : {}),
    };
  }

  if (obj instanceof fabric.Rect || obj instanceof fabric.Ellipse) {
    const innerW = (obj.width ?? 0) * sx;
    const innerH = (obj.height ?? 0) * sy;
    const outerW = dist(c.tl, c.tr);
    const outerH = dist(c.tl, c.bl);
    const o = offsetAlong(tl, angle, (outerW - innerW) / 2, (outerH - innerH) / 2);
    const stroke = safeColor(obj.stroke);
    const fill = safeColor(obj.fill);
    const sw = obj.strokeUniform ? (obj.strokeWidth ?? 0) : ((obj.strokeWidth ?? 0) * (sx + sy)) / 2;
    return {
      type: obj instanceof fabric.Rect ? "rect" : "ellipse",
      ...common,
      x: r2(o.x / S),
      y: r2(o.y / S),
      width: r2(innerW / S),
      height: r2(innerH / S),
      ...(stroke ? { stroke, strokeWidth: r2(sw / S) } : {}),
      ...(fill ? { fill } : {}),
    };
  }

  if (obj instanceof fabric.Line) {
    const p = obj.calcLinePoints();
    const m = obj.calcTransformMatrix();
    const a = fabric.util.transformPoint(new fabric.Point(p.x1, p.y1), m);
    const b = fabric.util.transformPoint(new fabric.Point(p.x2, p.y2), m);
    const stroke = safeColor(obj.stroke) ?? "#000000";
    return {
      type: "line",
      page,
      ...(id ? { id } : {}),
      ...(obj.opacity !== undefined && obj.opacity !== 1 ? { opacity: r2(obj.opacity) } : {}),
      x: r2(a.x / S),
      y: r2(a.y / S),
      x2: r2(b.x / S),
      y2: r2(b.y / S),
      stroke,
      strokeWidth: r2(((obj.strokeWidth ?? 1) * (sx + sy)) / 2 / S),
    };
  }

  if (obj instanceof fabric.Image && !obj.flipX && !obj.flipY && !(obj.filters && obj.filters.length)) {
    const src = obj.getSrc();
    if (/^data:image\/(png|jpe?g);base64,/.test(src)) {
      return {
        type: "image",
        ...common,
        x: r2(tl.x / S),
        y: r2(tl.y / S),
        width: r2(((obj.width ?? 0) * sx) / S),
        height: r2(((obj.height ?? 0) * sy) / S),
        src,
      };
    }
  }

  // 自由描画・変形した画像など: 見た目どおりに画像化して配置する。
  if (obj instanceof fabric.Image || obj instanceof fabric.Path || obj instanceof fabric.Group) {
    const r = obj.getBoundingRect(true, true);
    return {
      type: "image",
      page,
      ...(id ? { id } : {}),
      x: r2(r.left / S),
      y: r2(r.top / S),
      width: r2(r.width / S),
      height: r2(r.height / S),
      src: obj.toDataURL({ format: "png", multiplier: 2 }),
    };
  }
  return null;
}

/** 仕様 → fabricオブジェクト(画像は非同期)。 */
export async function specToFabric(item: SpecItem): Promise<fabric.Object> {
  const base = {
    angle: item.rotation ?? 0,
    opacity: item.opacity ?? 1,
  };
  let obj: fabric.Object;
  switch (item.type) {
    case "text": {
      const fs = (item.fontSize ?? 12) * S;
      const width =
        item.width !== undefined
          ? item.width * S
          : Math.max(40, ...item.text.split("\n").map((l) => l.length * fs * (/[^\u0000-ÿ]/.test(l) ? 1 : 0.6)));
      obj = new fabric.Textbox(item.text, {
        left: item.x * S,
        top: item.y * S,
        width,
        fontSize: fs,
        fill: safeColor(item.color) ?? "#000000",
        fontWeight: item.bold ? "bold" : "normal",
        fontStyle: item.italic ? "italic" : "normal",
        textAlign: item.align ?? "left",
        textBackgroundColor: safeColor(item.background) ?? "",
        lineHeight: (item.lineHeight ?? 1.2) / 1.13,
        fontFamily: FONT_FAMILY,
        ...base,
      });
      break;
    }
    case "rect":
    case "ellipse": {
      const sw = (item.stroke ? (item.strokeWidth ?? 1) : 0) * S;
      const o = offsetAlong({ x: item.x * S, y: item.y * S }, item.rotation ?? 0, -sw / 2, -sw / 2);
      const style = {
        left: o.x,
        top: o.y,
        stroke: safeColor(item.stroke) ?? "",
        strokeWidth: sw,
        fill: safeColor(item.fill) ?? "transparent",
        ...base,
      };
      obj =
        item.type === "rect"
          ? new fabric.Rect({ ...style, width: item.width * S, height: item.height * S })
          : new fabric.Ellipse({ ...style, rx: (item.width * S) / 2, ry: (item.height * S) / 2 });
      break;
    }
    case "line":
      obj = new fabric.Line([item.x * S, item.y * S, item.x2 * S, item.y2 * S], {
        stroke: safeColor(item.stroke) ?? "#000000",
        strokeWidth: (item.strokeWidth ?? 1) * S,
        opacity: item.opacity ?? 1,
      });
      break;
    case "image": {
      if (!item.src) throw new Error("image には src(data URL)が必要です");
      const src = item.src;
      obj = await new Promise<fabric.Object>((resolve) =>
        fabric.Image.fromURL(src, (img) => {
          img.set({
            left: item.x * S,
            top: item.y * S,
            scaleX: (item.width * S) / (img.width ?? 1),
            scaleY: (item.height * S) / (img.height ?? 1),
            ...base,
          });
          resolve(img);
        })
      );
      break;
    }
  }
  setObjectId(obj, item.id ?? newId());
  return obj;
}
