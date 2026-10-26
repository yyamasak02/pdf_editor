import type { AppState } from "./types";

export const state: AppState = {
  originalBytes: null,
  pdfJsDoc: null,
  numPages: 0,
  currentPage: 0,
  pageDims: [],
  pageWrappers: [],
  pageCanvases: [],
  pageInitialized: [],
  activeTool: "select",
  editMode: true,
  formFieldsMeta: [],
  hasAcroForm: false,
  restoredPageJson: [],
  restoredFormValues: {},
};

export function currentCanvas() {
  return state.pageCanvases[state.currentPage] ?? null;
}
