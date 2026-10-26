import { fabric } from "fabric";
import { els } from "./dom";
import { state, currentCanvas } from "./state";
import { isHexColor } from "./colors";
import { newId, setObjectId } from "./fabricSpec";
import type { ToolName } from "./types";

const CLONE_PROPS = ["textBackgroundColor", "id"];
/** 貼り付けのたびにずらす距離(px) */
const PASTE_OFFSET = 20;

// 選択時の枠・ハンドルを見やすくする(全オブジェクト共通)
fabric.Object.prototype.transparentCorners = false;
fabric.Object.prototype.cornerColor = "#2563eb";
fabric.Object.prototype.cornerStrokeColor = "#1d4ed8";
fabric.Object.prototype.borderColor = "#2563eb";
fabric.Object.prototype.cornerSize = 11;
fabric.Object.prototype.borderScaleFactor = 2.5;
fabric.Object.prototype.padding = 6;

export function isTextObject(obj: fabric.Object): obj is fabric.Textbox | fabric.IText {
  return obj instanceof fabric.Textbox || obj instanceof fabric.IText;
}

export function isShapeObject(obj: fabric.Object): obj is fabric.Rect | fabric.Ellipse {
  return obj instanceof fabric.Rect || obj instanceof fabric.Ellipse;
}

/**
 * テキストは幅だけを変えるml/mrハンドルのみ、それ以外は回転ハンドルのみを
 * 無効化する。新規作成時・JSONからの復元時の両方で同じ見た目にするため共通化。
 */
export function applyControlsPreset(obj: fabric.Object): void {
  if (isTextObject(obj)) {
    obj.setControlsVisibility({
      mtr: false,
      tl: false,
      tr: false,
      bl: false,
      br: false,
      mt: false,
      mb: false,
    });
  } else {
    obj.setControlsVisibility({ mtr: false });
  }
}

export function drawTextBoxOutlines(canvas: fabric.Canvas): void {
  if (!state.editMode) return;
  const ctx = canvas.getContext();
  ctx.save();
  ctx.strokeStyle = "#2563eb";
  ctx.lineWidth = 1;
  ctx.setLineDash([5, 3]);
  canvas.getObjects().forEach((obj) => {
    if (!isTextObject(obj) || !obj.visible) return;
    const r = obj.getBoundingRect(false, true);
    ctx.strokeRect(r.left + 0.5, r.top + 0.5, r.width, r.height);
  });
  ctx.restore();
}

/** 編集モードのON/OFFを切り替える。OFFでは閲覧専用になり、枠線も消える。 */
export function setEditMode(on: boolean): void {
  state.editMode = on;
  els.editModeToggle.setAttribute("aria-pressed", String(on));
  els.editModeToggle.textContent = `編集モード: ${on ? "ON" : "OFF"}`;
  document.getElementById("toolpanel")?.classList.toggle("view-only", !on);
  setTool(state.activeTool);
  document.dispatchEvent(new Event("editmodechange"));
}

export function setTool(tool: ToolName): void {
  state.activeTool = tool;
  els.toolBtns.forEach((btn) => btn.classList.toggle("active", btn.dataset.tool === tool));

  const canvas = currentCanvas();
  if (!canvas) return;

  const interactive = state.editMode;
  canvas.isDrawingMode = interactive && tool === "pen";
  canvas.selection = interactive && tool === "select";
  canvas.forEachObject((o) => {
    o.selectable = interactive && tool === "select";
    o.evented = interactive;
  });
  canvas.discardActiveObject();

  if (tool === "pen") {
    canvas.freeDrawingBrush.color = els.colorInput.value;
    canvas.freeDrawingBrush.width = parseInt(els.strokeWidth.value, 10);
  }

  canvas.defaultCursor = interactive && tool !== "select" ? "crosshair" : "default";
  canvas.renderAll();
}

export function attachCanvasToolHandlers(canvas: fabric.Canvas): void {
  let drawing = false;
  let origin: { x: number; y: number } | null = null;
  let shapeObj: fabric.Rect | fabric.Ellipse | null = null;

  canvas.on("mouse:down", (opt) => {
    if (!state.editMode) return;
    const tool = state.activeTool;
    const pointer = canvas.getPointer(opt.e);

    if (tool === "text") {
      const text = new fabric.Textbox("テキスト", {
        left: pointer.x,
        top: pointer.y,
        width: 220,
        fontSize: parseInt(els.fontSize.value, 10) || 20,
        fill: els.colorInput.value,
        textBackgroundColor: els.fillEnabled.checked ? els.fillInput.value : "",
        fontFamily: "Helvetica, Arial, \"Noto Sans JP\", \"Yu Gothic\", Meiryo, sans-serif",
      });
      applyControlsPreset(text);
      canvas.add(text);
      // setTool()はcanvas.discardActiveObject()を呼ぶため、選択状態にする前に
      // 先にツール切り替えを済ませておく(順序を誤るとfabricの編集状態の
      // 保存/復元が狂い、編集終了後にhasControlsがfalseのまま残る)。
      setTool("select");
      canvas.setActiveObject(text);
      text.enterEditing();
      text.selectAll();
      return;
    }

    if (tool === "rect" || tool === "ellipse") {
      drawing = true;
      origin = pointer;
      const common: fabric.IObjectOptions = {
        left: pointer.x,
        top: pointer.y,
        stroke: els.colorInput.value,
        strokeWidth: parseInt(els.strokeWidth.value, 10),
        fill: els.fillEnabled.checked ? els.fillInput.value : "transparent",
        selectable: false,
      };
      shapeObj =
        tool === "rect"
          ? new fabric.Rect({ ...common, width: 1, height: 1 })
          : new fabric.Ellipse({ ...common, rx: 1, ry: 1 });
      applyControlsPreset(shapeObj);
      canvas.add(shapeObj);
    }
  });

  canvas.on("mouse:move", (opt) => {
    if (!drawing || !shapeObj || !origin) return;
    const pointer = canvas.getPointer(opt.e);
    const w = pointer.x - origin.x;
    const h = pointer.y - origin.y;
    const left = w < 0 ? pointer.x : origin.x;
    const top = h < 0 ? pointer.y : origin.y;

    if (shapeObj instanceof fabric.Rect) {
      shapeObj.set({ left, top, width: Math.abs(w), height: Math.abs(h) });
    } else {
      shapeObj.set({ left, top, rx: Math.abs(w) / 2, ry: Math.abs(h) / 2 });
    }
    canvas.renderAll();
  });

  canvas.on("mouse:up", () => {
    if (drawing && shapeObj) {
      shapeObj.setCoords();
      shapeObj.selectable = true;
      // setTool()はcanvas.discardActiveObject()を呼ぶため、選択する前に
      // 先にツール切り替えを済ませる(順序を誤ると選択が解除されてしまう)。
      setTool("select");
      canvas.setActiveObject(shapeObj);
      canvas.requestRenderAll();
    }
    drawing = false;
    shapeObj = null;
  });

  // 編集モード中だけ、テキストボックスの範囲(ふち)を点線で重ねて描く。
  // オブジェクト自体には持たせないので、PDF出力や再編集データには含まれない。
  canvas.on("after:render", () => drawTextBoxOutlines(canvas));

  canvas.on("path:created", (e) => {
    const path = (e as unknown as { path: fabric.Path }).path;
    applyControlsPreset(path);
  });

  canvas.on("selection:created", syncToolbarFromSelection);
  canvas.on("selection:updated", syncToolbarFromSelection);

  // 編集終了後にリサイズハンドルが出なくなることがあるfabricの既知の挙動への対策。
  canvas.on("text:editing:exited", (e) => {
    const obj = e.target;
    if (!obj) return;
    obj.hasControls = true;
    obj.selectable = true;
    canvas.requestRenderAll();
  });
}

// オブジェクトを選択したとき、サイドバーの色・塗りつぶし・線の太さ・文字サイズを
// その選択中オブジェクトの現在値に合わせる(選択中の見た目と操作対象を一致させる)。
function syncToolbarFromSelection(e: fabric.IEvent): void {
  const obj = e.selected?.[0] ?? currentCanvas()?.getActiveObject() ?? null;
  if (!obj) return;

  if (isTextObject(obj)) {
    if (isHexColor(obj.fill)) els.colorInput.value = obj.fill;
    if (obj.fontSize) els.fontSize.value = String(Math.round(obj.fontSize));
    const hasBg = isHexColor(obj.textBackgroundColor);
    els.fillEnabled.checked = hasBg;
    if (hasBg) els.fillInput.value = obj.textBackgroundColor as string;
  } else if (isShapeObject(obj)) {
    if (isHexColor(obj.stroke)) els.colorInput.value = obj.stroke;
    if (obj.strokeWidth) {
      els.strokeWidth.value = String(obj.strokeWidth);
      els.strokeWidthValue.textContent = String(obj.strokeWidth);
    }
    const hasFill = isHexColor(obj.fill);
    els.fillEnabled.checked = hasFill;
    if (hasFill) els.fillInput.value = obj.fill as string;
  } else if (obj instanceof fabric.Path) {
    if (isHexColor(obj.stroke)) els.colorInput.value = obj.stroke;
    if (obj.strokeWidth) {
      els.strokeWidth.value = String(obj.strokeWidth);
      els.strokeWidthValue.textContent = String(obj.strokeWidth);
    }
  }
}

export function updateSelectedStyle(): void {
  const canvas = currentCanvas();
  if (!canvas) return;

  if (canvas.isDrawingMode) {
    canvas.freeDrawingBrush.color = els.colorInput.value;
    canvas.freeDrawingBrush.width = parseInt(els.strokeWidth.value, 10);
  }

  canvas.getActiveObjects().forEach((obj) => {
    if (isTextObject(obj)) {
      obj.set({
        fill: els.colorInput.value,
        fontSize: parseInt(els.fontSize.value, 10) || obj.fontSize,
        textBackgroundColor: els.fillEnabled.checked ? els.fillInput.value : "",
      });
    } else if (isShapeObject(obj)) {
      obj.set({
        stroke: els.colorInput.value,
        strokeWidth: parseInt(els.strokeWidth.value, 10),
        fill: els.fillEnabled.checked ? els.fillInput.value : "transparent",
      });
    } else if (obj instanceof fabric.Path) {
      obj.set({
        stroke: els.colorInput.value,
        strokeWidth: parseInt(els.strokeWidth.value, 10),
      });
    }
  });
  canvas.renderAll();
}

export function deleteSelectedObjects(): void {
  if (!state.editMode) return;
  const canvas = currentCanvas();
  if (!canvas) return;
  const active = canvas.getActiveObjects();
  if (!active.length) return;
  active.forEach((obj) => canvas.remove(obj));
  canvas.discardActiveObject();
  canvas.renderAll();
}

export function addImageFile(file: File): void {
  if (!state.editMode) return;
  const canvas = currentCanvas();
  if (!canvas) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    const result = e.target?.result;
    if (typeof result !== "string") return;
    fabric.Image.fromURL(result, (img) => {
      const maxDim = Math.min(canvas.width ?? 0, canvas.height ?? 0) * 0.6;
      if ((img.width ?? 0) > maxDim || (img.height ?? 0) > maxDim) {
        const scale = maxDim / Math.max(img.width ?? 1, img.height ?? 1);
        img.scale(scale);
      }
      img.set({
        left: ((canvas.width ?? 0) - img.getScaledWidth()) / 2,
        top: ((canvas.height ?? 0) - img.getScaledHeight()) / 2,
      });
      applyControlsPreset(img);
      canvas.add(img);
      setTool("select");
      canvas.setActiveObject(img);
      canvas.requestRenderAll();
    });
  };
  reader.readAsDataURL(file);
}

const ARROW_DELTAS: Record<string, [number, number]> = {
  ArrowUp: [0, -1],
  ArrowDown: [0, 1],
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
};

// ---- コピー / 切り取り / 貼り付け / 複製 / 全選択 ----
// 内部クリップボード。ページをまたいで貼り付けられる(別ページへも可)。

let clipboard: fabric.Object | null = null;
let pasteCount = 0;

function cloneObject(obj: fabric.Object): Promise<fabric.Object> {
  return new Promise((resolve) => obj.clone((c: fabric.Object) => resolve(c), CLONE_PROPS));
}

/** 選択中のオブジェクトを内部クリップボードへ保存する。保存できたら true。 */
export async function copySelection(): Promise<boolean> {
  const canvas = currentCanvas();
  const active = canvas?.getActiveObject();
  if (!canvas || !active || (active as fabric.IText).isEditing) return false;
  clipboard = await cloneObject(active);
  pasteCount = 0;
  return true;
}

export async function cutSelection(): Promise<void> {
  if (await copySelection()) deleteSelectedObjects();
}

function giveFreshIds(obj: fabric.Object): void {
  if (obj.type === "activeSelection") (obj as fabric.ActiveSelection).forEachObject((o) => setObjectId(o, newId()));
  else setObjectId(obj, newId());
}

/** 追加したオブジェクト(複数選択ならその中身)を、現在のページへ置いて選択する。 */
function placeOnCanvas(canvas: fabric.Canvas, obj: fabric.Object): void {
  if (obj.type === "activeSelection") {
    const sel = obj as fabric.ActiveSelection;
    sel.canvas = canvas;
    sel.forEachObject((o) => {
      applyControlsPreset(o);
      canvas.add(o);
    });
    sel.setCoords();
  } else {
    applyControlsPreset(obj);
    canvas.add(obj);
  }
  canvas.setActiveObject(obj);
  canvas.requestRenderAll();
}

/** 内部クリップボードの内容を、現在のページへ少しずらして貼り付ける。 */
export async function pasteClipboard(): Promise<boolean> {
  const canvas = currentCanvas();
  if (!canvas || !clipboard) return false;
  const copy = await cloneObject(clipboard);
  pasteCount += 1;
  canvas.discardActiveObject();
  copy.set({
    left: (copy.left ?? 0) + PASTE_OFFSET * pasteCount,
    top: (copy.top ?? 0) + PASTE_OFFSET * pasteCount,
    evented: true,
    selectable: true,
  });
  giveFreshIds(copy);
  placeOnCanvas(canvas, copy);
  return true;
}

/** コピー+貼り付けを1操作で(Ctrl+D)。クリップボードは上書きしない。 */
export async function duplicateSelection(): Promise<boolean> {
  const canvas = currentCanvas();
  const active = canvas?.getActiveObject();
  if (!canvas || !active || (active as fabric.IText).isEditing) return false;
  const copy = await cloneObject(active);
  canvas.discardActiveObject();
  copy.set({ left: (copy.left ?? 0) + PASTE_OFFSET, top: (copy.top ?? 0) + PASTE_OFFSET, evented: true, selectable: true });
  giveFreshIds(copy);
  placeOnCanvas(canvas, copy);
  return true;
}

export function selectAll(): void {
  const canvas = currentCanvas();
  if (!canvas) return;
  const objs = canvas.getObjects().filter((o) => o.selectable);
  if (!objs.length) return;
  canvas.discardActiveObject();
  canvas.setActiveObject(objs.length === 1 ? (objs[0] as fabric.Object) : new fabric.ActiveSelection(objs, { canvas }));
  canvas.requestRenderAll();
}

/** クリップボードの画像(スクリーンショットなど)を、現在のページへ貼り付ける。 */
export function handlePasteEvent(e: ClipboardEvent): void {
  if (!state.editMode || isEditableTarget(e.target)) return;
  const file = Array.from(e.clipboardData?.files ?? []).find((f) => f.type.startsWith("image/"));
  if (file) {
    e.preventDefault();
    addImageFile(file);
  }
}

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || target.isContentEditable;
}

export function handleGlobalKeydown(e: KeyboardEvent): void {
  if (!state.editMode) return;
  if (isEditableTarget(e.target)) return;

  if (e.key === "Delete" || e.key === "Backspace") {
    deleteSelectedObjects();
    return;
  }

  // Ctrl/Cmd + C / X / V / D / A
  if ((e.ctrlKey || e.metaKey) && !e.altKey) {
    const key = e.key.toLowerCase();
    const canvas = currentCanvas();
    if ((canvas?.getActiveObject() as fabric.IText | undefined)?.isEditing) return; // 文字入力中はブラウザ標準に任せる
    if (key === "c") {
      e.preventDefault();
      void copySelection();
    } else if (key === "x") {
      e.preventDefault();
      void cutSelection();
    } else if (key === "v") {
      // 画像の貼り付け(pasteイベント)も効くよう、内部クリップボードがあるときだけ止める。
      if (clipboard) {
        e.preventDefault();
        void pasteClipboard();
      }
    } else if (key === "d") {
      e.preventDefault(); // ブラウザのブックマーク追加を抑止
      void duplicateSelection();
    } else if (key === "a") {
      e.preventDefault();
      selectAll();
    }
    return;
  }

  const delta = ARROW_DELTAS[e.key];
  if (!delta) return;

  const canvas = currentCanvas();
  if (!canvas) return;
  const active = canvas.getActiveObject();
  if (!active || (active as fabric.IText).isEditing) return;

  e.preventDefault(); // ページ自体のスクロールを防ぐ
  const step = e.shiftKey ? 10 : 1;
  const [dx, dy] = delta;
  canvas.getActiveObjects().forEach((obj) => {
    obj.set({ left: (obj.left ?? 0) + dx * step, top: (obj.top ?? 0) + dy * step });
    obj.setCoords();
  });
  canvas.requestRenderAll();
}
