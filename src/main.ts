import { els } from "./dom";
import { state, currentCanvas } from "./state";
import { goToPage, applyZoom, loadPdfFile, scheduleFormPreview } from "./pdfView";
import {
  setTool,
  setEditMode,
  updateSelectedStyle,
  deleteSelectedObjects,
  addImageFile,
  handleGlobalKeydown,
  handlePasteEvent,
} from "./canvasTools";
import { savePdf } from "./exportPdf";
import { initMergeDialog } from "./mergeDialog";
import { initPropsPanel } from "./propsPanel";
import { installEditApi } from "./editApi";
import type { ToolName } from "./types";

function init(): void {
  initPropsPanel();
  initMergeDialog();
  installEditApi();
  els.fileInput.addEventListener("change", (e) => {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (file) void loadPdfFile(file);
  });

  els.prevPage.addEventListener("click", () => goToPage(state.currentPage - 1));
  els.nextPage.addEventListener("click", () => goToPage(state.currentPage + 1));
  els.zoomSelect.addEventListener("change", applyZoom);

  els.toolBtns.forEach((btn) => {
    btn.addEventListener("click", () => setTool(btn.dataset.tool as ToolName));
  });

  els.editModeToggle.addEventListener("click", () => setEditMode(!state.editMode));

  els.imageInput.addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    const file = input.files?.[0];
    if (file) addImageFile(file);
    input.value = "";
  });

  els.strokeWidth.addEventListener("input", () => {
    els.strokeWidthValue.textContent = els.strokeWidth.value;
    updateSelectedStyle();
  });
  els.colorInput.addEventListener("input", updateSelectedStyle);
  els.fillInput.addEventListener("input", updateSelectedStyle);
  els.fillEnabled.addEventListener("change", updateSelectedStyle);
  els.fontSize.addEventListener("input", updateSelectedStyle);

  els.deleteSelected.addEventListener("click", deleteSelectedObjects);

  els.toggleFormPanel.addEventListener("click", () => {
    els.formPanel.classList.toggle("hidden");
  });

  // フォーム欄に入力したら、ページ表示にもすぐ反映する。
  els.formFieldsList.addEventListener("input", scheduleFormPreview);
  els.formFieldsList.addEventListener("change", scheduleFormPreview);

  els.saveBtn.addEventListener("click", () => void savePdf());

  document.addEventListener("keydown", handleGlobalKeydown);
  document.addEventListener("paste", handlePasteEvent);
}

init();

// 動作確認・サポート対応用のデバッグフック(アプリの動作には使用しない)。
declare global {
  interface Window {
    __pdfEditorDebug?: { state: typeof state; currentCanvas: typeof currentCanvas };
  }
}
window.__pdfEditorDebug = { state, currentCanvas };
