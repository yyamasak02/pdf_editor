// PowerPoint風のプロパティパネル。選択中のオブジェクトの位置・サイズ・色などを数値で設定する。
// 単位は pt(画面のpx ÷ RENDER_SCALE)。保存結果と同じ単位なので、見た値がそのままPDFの値になる。
import { fabric } from "fabric";
import { els } from "./dom";
import { state, currentCanvas } from "./state";
import { RENDER_SCALE as S } from "./constants";
import { isHexColor } from "./colors";
import { computeAlign, MIN_DISTRIBUTE, type AlignMode } from "./align";
import { isShapeObject, isTextObject, deleteSelectedObjects, duplicateSelection } from "./canvasTools";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const num = (id: string) => $<HTMLInputElement>(id);
const r1 = (n: number) => Math.round(n * 10) / 10;

function selected(): fabric.Object | null {
  return currentCanvas()?.getActiveObject() ?? null;
}

type Kind = "text" | "shape" | "path" | "image" | "multi" | "other";
function kindOf(obj: fabric.Object): Kind {
  if (obj.type === "activeSelection") return "multi";
  if (isTextObject(obj)) return "text";
  if (isShapeObject(obj)) return "shape";
  if (obj instanceof fabric.Path || obj instanceof fabric.Line) return "path";
  if (obj instanceof fabric.Image) return "image";
  return "other";
}

/** 選択状態に合わせて、パネルの表示・入力欄の値を更新する。入力中の欄は上書きしない。 */
export function refreshPropsPanel(): void {
  const obj = state.editMode ? selected() : null;
  els.propsPanel.classList.toggle("hidden", !state.editMode || !state.numPages);
  $("props-empty").hidden = !!obj;
  $("props-body").hidden = !obj;
  if (!obj) return;

  const kind = kindOf(obj);
  const show = (key: string, on: boolean) => {
    const el = document.querySelector<HTMLElement>(`[data-props="${key}"]`);
    if (el) el.hidden = !on;
  };
  show("text", kind === "text");
  show("shape", kind === "shape" || kind === "path");
  show("align", kind === "multi");
  if (kind === "multi") {
    const count = (obj as fabric.ActiveSelection).size();
    $<HTMLButtonElement>("align-distribute-h").disabled = count < MIN_DISTRIBUTE;
    $<HTMLButtonElement>("align-distribute-v").disabled = count < MIN_DISTRIBUTE;
  }
  $("prop-fill").parentElement!.hidden = kind === "path";
  $("prop-fill-none").parentElement!.hidden = kind === "path";
  const single = kind !== "multi";
  num("prop-w").disabled = kind === "path" ? false : !single;
  num("prop-h").disabled = !single || kind === "text"; // テキストの高さは行数で決まる
  num("prop-angle").disabled = !single;

  const set = (id: string, v: string | number) => {
    const el = num(id);
    if (document.activeElement !== el) el.value = String(v);
  };
  set("prop-x", r1((obj.left ?? 0) / S));
  set("prop-y", r1((obj.top ?? 0) / S));
  set("prop-w", r1(obj.getScaledWidth() / S));
  set("prop-h", r1(obj.getScaledHeight() / S));
  set("prop-angle", r1(obj.angle ?? 0));
  set("prop-opacity", Math.round((obj.opacity ?? 1) * 100));

  if (isTextObject(obj)) {
    set("prop-fontsize", r1(((obj.fontSize ?? 20) * (obj.scaleY ?? 1)) / S));
    if (isHexColor(obj.fill)) set("prop-color", obj.fill);
    $("prop-bold").setAttribute("aria-pressed", String(obj.fontWeight === "bold"));
    $("prop-italic").setAttribute("aria-pressed", String(obj.fontStyle === "italic"));
    for (const a of ["left", "center", "right"]) {
      $(`prop-align-${a}`).setAttribute("aria-pressed", String((obj.textAlign || "left") === a));
    }
    const hasBg = isHexColor(obj.textBackgroundColor);
    num("prop-bg-none").checked = !hasBg;
    if (hasBg) set("prop-bg", obj.textBackgroundColor as string);
  } else if (kind === "shape" || kind === "path") {
    const o = obj as fabric.Object;
    if (isHexColor(o.stroke)) set("prop-stroke", o.stroke);
    set("prop-strokewidth", r1((o.strokeWidth ?? 0) / S));
    const hasFill = isHexColor(o.fill);
    num("prop-fill-none").checked = !hasFill;
    if (hasFill) set("prop-fill", o.fill as string);
  }
}

/** 値を適用して描き直す。入力欄の再同期のため object:modified も通知する。 */
function applyToSelection(fn: (obj: fabric.Object) => void, { each = false } = {}): void {
  const canvas = currentCanvas();
  const obj = selected();
  if (!canvas || !obj || !state.editMode) return;
  if (each && obj.type === "activeSelection") (obj as fabric.ActiveSelection).forEachObject(fn);
  else fn(obj);
  obj.setCoords();
  canvas.requestRenderAll();
  canvas.fire("object:modified", { target: obj });
}

const numValue = (id: string): number | null => {
  const v = parseFloat(num(id).value);
  return Number.isFinite(v) ? v : null;
};

function setScaledSize(obj: fabric.Object, axis: "x" | "y", targetPx: number): void {
  if (targetPx <= 0) return;
  if (axis === "x" && isTextObject(obj)) {
    // テキストは幅だけを変える(折り返しが変わる)。拡大率は使わない。
    obj.set({ width: targetPx / (obj.scaleX ?? 1) });
    return;
  }
  const scale = axis === "x" ? obj.scaleX ?? 1 : obj.scaleY ?? 1;
  const current = axis === "x" ? obj.getScaledWidth() : obj.getScaledHeight();
  const unit = current / scale; // 拡大率1のときの大きさ(線の太さを含む)
  obj.set(axis === "x" ? { scaleX: targetPx / unit } : { scaleY: targetPx / unit });
}

/**
 * 複数選択中のオブジェクトを整列・均等割り付けする。
 * 選択グループ内の座標は相対値なので、いったん選択を解除してキャンバス上の座標で動かし、選択し直す。
 */
export function alignSelection(mode: AlignMode): void {
  const canvas = currentCanvas();
  const active = selected();
  if (!canvas || !active || !state.editMode || active.type !== "activeSelection") return;
  const objs = (active as fabric.ActiveSelection).getObjects().slice();
  canvas.discardActiveObject();
  const rects = objs.map((o) => {
    const b = o.getBoundingRect(true, true);
    return { left: b.left, top: b.top, width: b.width, height: b.height };
  });
  computeAlign(rects, mode).forEach(([dx, dy], i) => {
    const o = objs[i]!;
    o.set({ left: (o.left ?? 0) + dx, top: (o.top ?? 0) + dy });
    o.setCoords();
  });
  const sel = new fabric.ActiveSelection(objs, { canvas });
  canvas.setActiveObject(sel);
  canvas.requestRenderAll();
  canvas.fire("object:modified", { target: sel });
}

function bindInputs(): void {
  const on = (id: string, ev: string, fn: () => void) => $(id).addEventListener(ev, fn);

  on("prop-x", "input", () => { const v = numValue("prop-x"); if (v !== null) applyToSelection((o) => o.set({ left: v * S })); });
  on("prop-y", "input", () => { const v = numValue("prop-y"); if (v !== null) applyToSelection((o) => o.set({ top: v * S })); });
  on("prop-w", "input", () => { const v = numValue("prop-w"); if (v !== null) applyToSelection((o) => setScaledSize(o, "x", v * S)); });
  on("prop-h", "input", () => { const v = numValue("prop-h"); if (v !== null) applyToSelection((o) => setScaledSize(o, "y", v * S)); });
  on("prop-angle", "input", () => { const v = numValue("prop-angle"); if (v !== null) applyToSelection((o) => o.rotate(v)); });
  on("prop-opacity", "input", () => {
    const v = numValue("prop-opacity");
    if (v !== null) applyToSelection((o) => o.set({ opacity: Math.min(1, Math.max(0, v / 100)) }), { each: true });
  });

  on("prop-fontsize", "input", () => {
    const v = numValue("prop-fontsize");
    if (v === null || v <= 0) return;
    applyToSelection((o) => { if (isTextObject(o)) o.set({ fontSize: (v * S) / (o.scaleY ?? 1) }); });
  });
  on("prop-color", "input", () => applyToSelection((o) => { if (isTextObject(o)) o.set({ fill: num("prop-color").value }); }));
  on("prop-bold", "click", () => applyToSelection((o) => { if (isTextObject(o)) o.set({ fontWeight: o.fontWeight === "bold" ? "normal" : "bold" }); }));
  on("prop-italic", "click", () => applyToSelection((o) => { if (isTextObject(o)) o.set({ fontStyle: o.fontStyle === "italic" ? "normal" : "italic" }); }));
  for (const a of ["left", "center", "right"] as const) {
    on(`prop-align-${a}`, "click", () => applyToSelection((o) => { if (isTextObject(o)) o.set({ textAlign: a }); }));
  }
  const applyBg = () =>
    applyToSelection((o) => { if (isTextObject(o)) o.set({ textBackgroundColor: num("prop-bg-none").checked ? "" : num("prop-bg").value }); });
  on("prop-bg", "input", () => { num("prop-bg-none").checked = false; applyBg(); });
  on("prop-bg-none", "change", applyBg);

  on("prop-stroke", "input", () => applyToSelection((o) => o.set({ stroke: num("prop-stroke").value })));
  on("prop-strokewidth", "input", () => {
    const v = numValue("prop-strokewidth");
    if (v !== null && v >= 0) applyToSelection((o) => o.set({ strokeWidth: v * S }));
  });
  const applyFill = () =>
    applyToSelection((o) => o.set({ fill: num("prop-fill-none").checked ? "transparent" : num("prop-fill").value }));
  on("prop-fill", "input", () => { num("prop-fill-none").checked = false; applyFill(); });
  on("prop-fill-none", "change", applyFill);

  const z = (fn: (c: fabric.Canvas, o: fabric.Object) => void) => () => {
    const canvas = currentCanvas();
    const obj = selected();
    if (!canvas || !obj) return;
    const targets = obj.type === "activeSelection" ? (obj as fabric.ActiveSelection).getObjects() : [obj];
    // 複数選択のときは見た目の前後関係を保つため、現在の重なり順に処理する。
    const ordered = [...targets].sort((a, b) => canvas.getObjects().indexOf(a) - canvas.getObjects().indexOf(b));
    fn(canvas, obj);
    void ordered;
    canvas.requestRenderAll();
    canvas.fire("object:modified", { target: obj });
  };
  on("prop-front", "click", z((c, o) => c.bringToFront(o)));
  on("prop-forward", "click", z((c, o) => c.bringForward(o)));
  on("prop-backward", "click", z((c, o) => c.sendBackwards(o)));
  on("prop-back", "click", z((c, o) => c.sendToBack(o)));
  on("align-left", "click", () => alignSelection("left"));
  on("align-right", "click", () => alignSelection("right"));
  on("align-distribute-h", "click", () => alignSelection("distribute-h"));
  on("align-distribute-v", "click", () => alignSelection("distribute-v"));
  on("prop-duplicate", "click", () => void duplicateSelection());
  on("prop-delete", "click", () => deleteSelectedObjects());
}

/** 各ページのキャンバスの選択・変形イベントをパネルに結びつける。 */
export function bindPropsToCanvas(canvas: fabric.Canvas): void {
  const refresh = () => refreshPropsPanel();
  for (const ev of [
    "selection:created",
    "selection:updated",
    "selection:cleared",
    "object:modified",
    "object:moving",
    "object:scaling",
    "object:rotating",
    "text:changed",
    "text:editing:exited",
  ]) {
    canvas.on(ev as "selection:created", refresh);
  }
}

export function initPropsPanel(): void {
  bindInputs();
  document.addEventListener("editmodechange", refreshPropsPanel);
  document.addEventListener("pagechange", refreshPropsPanel);
}
