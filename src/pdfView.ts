import { fabric } from "fabric";
import * as pdfjsLib from "pdfjs-dist/legacy/build/pdf.js";
import { PDFDocument } from "@cantoo/pdf-lib";
import { els } from "./dom";
import { state } from "./state";
import { RENDER_SCALE } from "./constants";
import { setTool, attachCanvasToolHandlers, applyControlsPreset } from "./canvasTools";
import { loadFormFields, restoreFormValues, applyFormValues } from "./formFields";
import { loadPdfDocument } from "./pdfLoad";
import { bindPropsToCanvas, refreshPropsPanel } from "./propsPanel";
import { readEditorState } from "./persistence";

pdfjsLib.GlobalWorkerOptions.workerSrc = "dist/pdf.worker.min.js";

export async function loadPdfFile(file: File): Promise<void> {
  try {
    const arrayBuffer = await file.arrayBuffer();
    const uploadedBytes = new Uint8Array(arrayBuffer);

    // このツールで以前保存したPDFかどうかを調べ、そうであれば加工前の原本と
    // 編集状態を取り出す。復元できなければ、普通の新規ファイルとして扱う。
    let originalBytes: Uint8Array<ArrayBufferLike> = uploadedBytes;
    let restoredPages: typeof state.restoredPageJson = [];
    let restored = false;
    let restoredFormValues: typeof state.restoredFormValues = {};
    try {
      const probeDoc = await PDFDocument.load(uploadedBytes, { password: "", ignoreEncryption: true });
      const editorState = readEditorState(probeDoc);
      if (editorState) {
        originalBytes = editorState.originalBytes;
        restoredPages = editorState.pages;
        restoredFormValues = editorState.formValues;
        restored = true;
      }
    } catch {
      // 読み取れない場合は新規ファイルとして扱う
    }

    state.originalBytes = originalBytes;
    state.restoredPageJson = restoredPages;
    state.restoredFormValues = restoredFormValues;

    const loadingTask = pdfjsLib.getDocument({ data: originalBytes.slice() });
    state.pdfJsDoc = await loadingTask.promise;
    state.numPages = state.pdfJsDoc.numPages;

    // 既存のページをクリア
    els.stage.innerHTML = "";
    state.pageDims = [];
    state.pageWrappers = [];
    state.pageCanvases = [];
    state.pageInitialized = [];
    state.currentPage = 0;

    for (let i = 0; i < state.numPages; i++) {
      const page = await state.pdfJsDoc.getPage(i + 1);
      const viewport = page.getViewport({ scale: 1 });
      state.pageDims.push({ widthPt: viewport.width, heightPt: viewport.height });

      const wrapper = document.createElement("div");
      wrapper.className = "page-wrapper";
      els.stage.appendChild(wrapper);
      state.pageWrappers.push(wrapper);
      state.pageCanvases.push(null);
      state.pageInitialized.push(false);
    }

    els.emptyState.style.display = "none";
    els.saveBtn.disabled = false;
    els.prevPage.disabled = false;
    els.nextPage.disabled = false;

    await loadFormFields();
    restoreFormValues(state.restoredFormValues);
    // 入力値が入った状態(外観入り)のPDFでページを描き直してから表示する。
    if (Object.keys(state.restoredFormValues).length) await refreshFormPreview();
    await showPage(0);

    if (restored) {
      console.info("このツールで保存済みのPDFを検出したため、前回の編集内容を復元しました。");
    }
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    alert("PDFの読み込みに失敗しました: " + message);
  }
}

/**
 * フォーム欄の入力値を反映したPDFでpdf.jsを開き直し、描画済みページの背景を差し替える。
 * 画面に見えている内容と保存結果を一致させるためのもの(編集モードのON/OFFに関係なく動く)。
 */
export async function refreshFormPreview(): Promise<void> {
  if (!state.originalBytes || !state.hasAcroForm) return;
  const seq = ++previewSeq;
  try {
    const doc = await loadPdfDocument(state.originalBytes);
    await applyFormValues(doc, { flatten: false });
    let bytes: Uint8Array;
    try {
      bytes = await doc.save();
    } catch {
      bytes = await doc.save({ updateFieldAppearances: false });
    }
    const pdfJsDoc = await pdfjsLib.getDocument({ data: bytes }).promise;
    if (seq !== previewSeq) return; // より新しい入力が来ている
    state.pdfJsDoc = pdfJsDoc;
    for (let i = 0; i < state.numPages; i++) {
      const canvas = state.pageCanvases[i];
      if (!canvas) continue;
      const { dataUrl } = await renderPageBitmap(i);
      await new Promise<void>((resolve) =>
        fabric.Image.fromURL(dataUrl, (img) => {
          canvas.setBackgroundImage(img, () => canvas.requestRenderAll(), {
            left: 0,
            top: 0,
            originX: "left",
            originY: "top",
          });
          resolve();
        })
      );
    }
  } catch (err) {
    console.warn("フォーム入力のプレビュー更新に失敗しました:", err);
  }
}
let previewSeq = 0;
let previewTimer: ReturnType<typeof setTimeout> | undefined;
export function scheduleFormPreview(): void {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(() => void refreshFormPreview(), 300);
}

async function renderPageBitmap(
  pageIndex: number
): Promise<{ dataUrl: string; width: number; height: number }> {
  if (!state.pdfJsDoc) throw new Error("PDFが読み込まれていません");
  const page = await state.pdfJsDoc.getPage(pageIndex + 1);
  const viewport = page.getViewport({ scale: RENDER_SCALE });
  const canvas = document.createElement("canvas");
  canvas.width = viewport.width;
  canvas.height = viewport.height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("2d contextを取得できませんでした");
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { dataUrl: canvas.toDataURL("image/png"), width: viewport.width, height: viewport.height };
}

/** 全ページのキャンバスを用意する(ページ内APIが、表示していないページも扱えるように)。 */
export async function ensureAllPages(): Promise<void> {
  for (let i = 0; i < state.numPages; i++) await initPageCanvas(i);
}

async function initPageCanvas(pageIndex: number): Promise<void> {
  if (state.pageInitialized[pageIndex]) return;
  const wrapper = state.pageWrappers[pageIndex];
  if (!wrapper) return;
  const { dataUrl, width, height } = await renderPageBitmap(pageIndex);

  const canvasEl = document.createElement("canvas");
  wrapper.appendChild(canvasEl);

  const fabricCanvas = new fabric.Canvas(canvasEl, {
    width,
    height,
    selection: true,
  });

  await new Promise<void>((resolve) => {
    fabric.Image.fromURL(dataUrl, (img) => {
      fabricCanvas.setBackgroundImage(img, () => undefined, {
        left: 0,
        top: 0,
        originX: "left",
        originY: "top",
      });

      const restoredJson = state.restoredPageJson[pageIndex];
      if (restoredJson) {
        fabricCanvas.loadFromJSON(restoredJson, () => {
          // JSONには選択ハンドルの表示設定は含まれないため再適用する。
          fabricCanvas.getObjects().forEach(applyControlsPreset);
          fabricCanvas.renderAll();
          resolve();
        });
      } else {
        fabricCanvas.renderAll();
        resolve();
      }
    });
  });

  attachCanvasToolHandlers(fabricCanvas);
  bindPropsToCanvas(fabricCanvas);

  state.pageCanvases[pageIndex] = fabricCanvas;
  state.pageInitialized[pageIndex] = true;
}

export async function showPage(pageIndex: number): Promise<void> {
  if (pageIndex < 0 || pageIndex >= state.numPages) return;

  state.pageWrappers.forEach((w) => w.classList.remove("visible"));

  await initPageCanvas(pageIndex);

  state.currentPage = pageIndex;
  state.pageWrappers[pageIndex]?.classList.add("visible");
  els.pageInfo.textContent = `${pageIndex + 1} / ${state.numPages}`;
  els.prevPage.disabled = pageIndex === 0;
  els.nextPage.disabled = pageIndex === state.numPages - 1;

  setTool(state.activeTool); // 新しいキャンバスにツール状態を反映
  refreshPropsPanel();
  applyZoom();
}

export function goToPage(index: number): void {
  void showPage(index);
}

export function applyZoom(): void {
  const zoom = parseFloat(els.zoomSelect.value);
  const wrapper = state.pageWrappers[state.currentPage];
  if (!wrapper) return;
  wrapper.style.transform = `scale(${zoom})`;
  wrapper.style.transformOrigin = "top center";
}
