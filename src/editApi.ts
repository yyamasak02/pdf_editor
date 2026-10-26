// ページ内API: ブラウザで開いているアプリを、JSで(=AIやスクリプトから)操作する口。
// window.pdfEditor に公開する。要素の表現は CLI と同じ仕様(src/spec.ts)なので、
// 「CLIで焼き込む」も「開いているアプリに足して人が仕上げる」も同じJSONで指示できる。
//
// 画面を直接触るため、人が見ている画面にも即反映され、元に戻す/動かすなどの手直しもできる。
import type { fabric } from "fabric";
import { state } from "./state";
import { fabricToSpec, specToFabric, getObjectId, setObjectId, newId } from "./fabricSpec";
import { applyControlsPreset } from "./canvasTools";
import { buildPdfBytes } from "./exportPdf";
import { ensureAllPages, goToPage, loadPdfFile, scheduleFormPreview } from "./pdfView";
import { collectFormValues, restoreFormValues } from "./formFields";
import { refreshPropsPanel } from "./propsPanel";
import { validateSpec, type SpecItem } from "./spec";
import { SCHEMA_DOC } from "./schemaDoc";
import type { FormValues } from "./types";

function requireLoaded(): void {
  if (!state.originalBytes || !state.numPages) throw new Error("PDFが読み込まれていません。先に load() するか、画面から開いてください");
}

function* allObjects(): Generator<{ obj: fabric.Object; page: number; canvas: fabric.Canvas }> {
  for (let page = 0; page < state.numPages; page++) {
    const canvas = state.pageCanvases[page];
    if (!canvas) continue;
    for (const obj of canvas.getObjects()) yield { obj, page, canvas };
  }
}

function ensureIds(): void {
  for (const { obj } of allObjects()) if (!getObjectId(obj)) setObjectId(obj, newId());
}

function find(id: string) {
  for (const hit of allObjects()) if (getObjectId(hit.obj) === id) return hit;
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(bin);
}

const api = {
  version: 1,

  /** 仕様の説明(JSON)。AIにそのまま渡せる。 */
  schema: () => JSON.parse(SCHEMA_DOC) as unknown,

  /** 開いているPDFの概要。座標系はpt・左上原点。 */
  info() {
    return {
      loaded: !!state.originalBytes,
      pageCount: state.numPages,
      currentPage: state.currentPage + 1,
      editMode: state.editMode,
      pages: state.pageDims.map((d, i) => ({ page: i + 1, width: d.widthPt, height: d.heightPt })),
      form: state.formFieldsMeta.map((m) => ({ name: m.name, kind: m.kind })),
      formValues: collectFormValues(),
      coordinateSystem: "pt, origin top-left, y down",
    };
  },

  /** 置かれている要素の一覧(id付き)。page を渡すとそのページだけ。 */
  async list(page?: number): Promise<SpecItem[]> {
    requireLoaded();
    await ensureAllPages();
    ensureIds();
    const out: SpecItem[] = [];
    for (const hit of allObjects()) {
      if (page !== undefined && hit.page + 1 !== page) continue;
      const item = fabricToSpec(hit.obj, hit.page);
      if (item) out.push(item);
    }
    return out;
  },

  /** 要素を追加する。追加した要素のidを返す。 */
  async add(items: SpecItem[]): Promise<string[]> {
    requireLoaded();
    validateSpec({ items }, state.numPages);
    await ensureAllPages();
    const ids: string[] = [];
    for (const item of items) {
      const canvas = state.pageCanvases[item.page - 1];
      if (!canvas) throw new Error(`page ${item.page} のキャンバスを用意できません`);
      const obj = await specToFabric(item);
      applyControlsPreset(obj);
      canvas.add(obj);
      ids.push(getObjectId(obj) as string);
      canvas.requestRenderAll();
    }
    return ids;
  },

  /** 既存の要素を部分更新する(例: {x: 120, text: "新しい文言"})。ページ移動も可。更新後の仕様を返す。 */
  async update(id: string, patch: Partial<SpecItem>): Promise<SpecItem> {
    requireLoaded();
    await ensureAllPages();
    const hit = find(id);
    if (!hit) throw new Error(`id "${id}" の要素が見つかりません。list() で確認してください`);
    const current = fabricToSpec(hit.obj, hit.page);
    if (!current) throw new Error("この要素は更新できません");
    const merged = { ...current, ...patch, id } as SpecItem;
    if (patch.type && patch.type !== current.type) throw new Error("type は変更できません。remove して add し直してください");
    validateSpec({ items: [merged] }, state.numPages);
    const target = state.pageCanvases[merged.page - 1];
    if (!target) throw new Error(`page ${merged.page} のキャンバスを用意できません`);
    const fresh = await specToFabric(merged);
    applyControlsPreset(fresh);
    // 同じページなら重なり順を保つ。
    const index = hit.canvas === target ? hit.canvas.getObjects().indexOf(hit.obj) : -1;
    hit.canvas.remove(hit.obj);
    if (index >= 0) target.insertAt(fresh, index, false);
    else target.add(fresh);
    hit.canvas.requestRenderAll();
    target.requestRenderAll();
    refreshPropsPanel();
    return fabricToSpec(fresh, merged.page - 1) as SpecItem;
  },

  /** 要素を削除する。削除した個数を返す。 */
  remove(ids: string | string[]): number {
    let n = 0;
    for (const id of Array.isArray(ids) ? ids : [ids]) {
      const hit = find(id);
      if (!hit) continue;
      hit.canvas.remove(hit.obj);
      hit.canvas.requestRenderAll();
      n++;
    }
    refreshPropsPanel();
    return n;
  },

  /** 要素を全部消す(page を渡すとそのページだけ)。 */
  clear(page?: number): number {
    let n = 0;
    for (let p = 0; p < state.numPages; p++) {
      if (page !== undefined && p + 1 !== page) continue;
      const canvas = state.pageCanvases[p];
      if (!canvas) continue;
      for (const obj of [...canvas.getObjects()]) {
        canvas.remove(obj);
        n++;
      }
      canvas.requestRenderAll();
    }
    refreshPropsPanel();
    return n;
  },

  /** フォーム項目に値を入れる(画面の入力欄にも反映され、ページ表示も更新される)。 */
  setForm(values: FormValues): { applied: string[]; unknown: string[] } {
    requireLoaded();
    const known = new Set(state.formFieldsMeta.map((m) => m.name));
    const applied = Object.keys(values).filter((k) => known.has(k));
    restoreFormValues(values);
    scheduleFormPreview();
    return { applied, unknown: Object.keys(values).filter((k) => !known.has(k)) };
  },

  gotoPage(page: number): void {
    goToPage(page - 1);
  },

  /** 編集結果のPDFを作る(ダウンロードはしない)。base64で返す。 */
  async export(): Promise<{ base64: string; bytes: number; rasterized: boolean; warnings: string[] }> {
    requireLoaded();
    await ensureAllPages();
    const r = await buildPdfBytes();
    const warnings: string[] = [];
    if (r.appearanceWarning) warnings.push("フォーム外観を再生成できませんでした(値は保存済み)");
    if (r.editorStateSkipped) warnings.push("再編集用データを埋め込めませんでした");
    if (r.rasterized) warnings.push("元PDFを解析できず、ページを画像化して書き出しました");
    return { base64: toBase64(r.bytes), bytes: r.bytes.length, rasterized: r.rasterized, warnings };
  },

  /** PDFを開く(base64 または バイト列)。 */
  async load(data: string | Uint8Array, name = "document.pdf"): Promise<void> {
    const bytes = typeof data === "string" ? Uint8Array.from(atob(data), (c) => c.charCodeAt(0)) : data;
    await loadPdfFile(new File([bytes as BlobPart], name, { type: "application/pdf" }));
  },
};

export type PdfEditorApi = typeof api;

declare global {
  interface Window {
    pdfEditor?: PdfEditorApi;
  }
}

export function installEditApi(): void {
  window.pdfEditor = api;
}
