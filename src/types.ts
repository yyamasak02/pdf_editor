import type { fabric } from "fabric";

export type ToolName = "select" | "text" | "rect" | "ellipse" | "pen";

export interface PageDims {
  widthPt: number;
  heightPt: number;
}

export type FieldKind = "text" | "checkbox" | "dropdown" | "radio" | "optionlist" | "unsupported";

export interface FormFieldMeta {
  name: string;
  kind: FieldKind;
  el: HTMLInputElement | HTMLSelectElement;
}

export interface AppState {
  originalBytes: Uint8Array | null;
  pdfJsDoc: import("pdfjs-dist/types/src/display/api").PDFDocumentProxy | null;
  numPages: number;
  currentPage: number;
  pageDims: PageDims[];
  pageWrappers: HTMLDivElement[];
  pageCanvases: (fabric.Canvas | null)[];
  pageInitialized: boolean[];
  activeTool: ToolName;
  /** 編集モード。OFFの間は閲覧専用(選択・描画・枠線表示なし) */
  editMode: boolean;
  formFieldsMeta: FormFieldMeta[];
  hasAcroForm: boolean;
  /** このツールで保存したPDFを再度開いたときに復元する、ページごとのfabric JSON */
  restoredPageJson: (FabricCanvasJSON | null)[];
  /** 再オープン時に復元するフォーム入力値 */
  restoredFormValues: FormValues;
}

export interface FabricCanvasJSON {
  version?: string;
  objects: Record<string, unknown>[];
  [key: string]: unknown;
}

/** PDFに埋め込む、再編集用の永続化データ */
export interface PersistedEditorState {
  tool: "pdf-editor-tool";
  version: 1;
  pages: (FabricCanvasJSON | null)[];
  /** フォーム入力値(項目名 → 値)。原本には値が入っていないため別途保存する */
  formValues?: FormValues;
}

export type FormValue = string | boolean | string[];
export type FormValues = Record<string, FormValue>;
