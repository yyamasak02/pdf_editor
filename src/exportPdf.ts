import { PDFDocument } from "@cantoo/pdf-lib";
import { els } from "./dom";
import { state } from "./state";

import { applyFormValues, collectFormValues } from "./formFields";
import { loadPdfDocument } from "./pdfLoad";
import { embedEditorState } from "./persistence";
import { Renderer } from "./render";
import { fabricToSpec } from "./fabricSpec";
import type { FabricCanvasJSON } from "./types";

const RASTER_FALLBACK_SCALE = 2;

function dataUrlToUint8Array(dataUrl: string): Uint8Array {
  const bin = atob(dataUrl.split(",")[1] ?? "");
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** ページごとのfabric JSON。未初期化のページは前回保存時の状態をそのまま引き継ぐ。 */
function collectPagesJson(): (FabricCanvasJSON | null)[] {
  const pages: (FabricCanvasJSON | null)[] = [];
  for (let i = 0; i < state.numPages; i++) {
    const canvas = state.pageCanvases[i];
    if (canvas) {
      const json = canvas.toJSON(["textBackgroundColor", "id"]) as unknown as FabricCanvasJSON;
      pages.push(json.objects.length ? json : null);
    } else {
      pages.push(state.restoredPageJson[i] ?? null);
    }
  }
  return pages;
}

function downloadBytes(bytes: Uint8Array, filename: string): void {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

export interface BuiltPdf {
  bytes: Uint8Array;
  /** フォーム外観の再生成を諦めた場合 true */
  appearanceWarning: boolean;
  /** 再編集用データの埋め込みに失敗した場合 true(PDF自体は保存できている) */
  editorStateSkipped: boolean;
  /** 元PDFをpdf-libで解析できず、ページを画像化して書き出した場合 true */
  rasterized: boolean;
}

/**
 * 元PDFの内部構造がpdf-libで解析できない場合(pdf.jsでは表示できても起こる)の代替経路。
 * 各ページをpdf.jsで画像化して新しいPDFの背景にする。元のテキスト・フォーム項目は
 * 画像になるが、追加した注釈は通常どおりベクターで重ねられる。
 */
async function buildRasterizedDoc(): Promise<PDFDocument> {
  const pdfJsDoc = state.pdfJsDoc;
  if (!pdfJsDoc) throw new Error("PDFが読み込まれていません");
  const doc = await PDFDocument.create();
  for (let i = 0; i < pdfJsDoc.numPages; i++) {
    const page = await pdfJsDoc.getPage(i + 1);
    const base = page.getViewport({ scale: 1 });
    const viewport = page.getViewport({ scale: RASTER_FALLBACK_SCALE });
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(viewport.width);
    canvas.height = Math.ceil(viewport.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2d contextを取得できませんでした");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport }).promise;
    const image = await doc.embedJpg(dataUrlToUint8Array(canvas.toDataURL("image/jpeg", 0.92)));
    const pdfPage = doc.addPage([base.width, base.height]);
    pdfPage.drawImage(image, { x: 0, y: 0, width: base.width, height: base.height });
  }
  return doc;
}

/** 失敗した段階が分かるよう、エラーメッセージに段階名を付けて投げ直す。 */
async function stage<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    console.error(`[保存:${name}]`, err);
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`[${name}] ${msg}`);
  }
}

/** 現在の編集内容を反映したPDFのバイト列を作る(UI/ダウンロードには触れない)。 */
export async function buildPdfBytes(): Promise<BuiltPdf> {
  if (!state.originalBytes) throw new Error("PDFが読み込まれていません");
  const originalBytes = state.originalBytes;
  let rasterized = false;
  let pdfDoc: PDFDocument;
  try {
    pdfDoc = await loadPdfDocument(originalBytes);
    pdfDoc.getPages(); // ページツリーが壊れている場合はここで例外になる
  } catch (err) {
    console.warn("pdf-libで元PDFを解析できないため、ページを画像化して保存します:", err);
    pdfDoc = await stage("ページの画像化", buildRasterizedDoc);
    rasterized = true;
  }
  const pages = pdfDoc.getPages();
  const renderer = new Renderer(pdfDoc);

  for (let i = 0; i < pages.length; i++) {
    const fabricCanvas = state.pageCanvases[i];
    if (!fabricCanvas) continue;
    for (const obj of fabricCanvas.getObjects()) {
      // 1つの要素の描画に失敗しても、他の編集内容は保存できるようにする。
      try {
        const item = fabricToSpec(obj, i);
        if (item) await renderer.drawItem(pages[i]!, item);
      } catch (err) {
        console.warn(`${i + 1}ページ目の要素(${obj.type})の書き込みに失敗しました:`, err);
      }
    }
  }

  if (!rasterized) await stage("フォーム反映", () => applyFormValues(pdfDoc, { jpFont: (style) => renderer.jpFont(style) }));

  // 再度このツールで開いたときに編集を続けられるよう、原本と編集状態を埋め込む。
  // 元PDFの構造が特殊で埋め込めない場合でも、PDF本体の保存は止めない。
  let editorStateSkipped = false;
  try {
    await embedEditorState(pdfDoc, state.originalBytes, collectPagesJson(), collectFormValues());
  } catch (err) {
    console.warn("再編集用データの埋め込みに失敗しました(PDFは保存します):", err);
    editorStateSkipped = true;
  }

  let bytes: Uint8Array;
  let appearanceWarning = false;
  try {
    bytes = await pdfDoc.save();
  } catch (err) {
    // 元のPDFのフォーム項目が特殊な構造(フォントがリソースに正しく
    // 登録されていない等)の場合、見た目(外観)の再生成に失敗することがある。
    // その場合は外観の再生成だけを諦めて、入力値自体は保存する。
    console.warn("通常の保存に失敗したため、フォーム外観の再生成なしで再試行します:", err);
    bytes = await stage("PDF書き出し(外観再生成なし)", () =>
      pdfDoc.save({ updateFieldAppearances: false })
    );
    appearanceWarning = true;
  }
  return { bytes, appearanceWarning, editorStateSkipped, rasterized };
}

export async function savePdf(): Promise<void> {
  if (!state.originalBytes) return;
  els.saveBtn.disabled = true;
  els.saveBtn.textContent = "保存中...";

  try {
    const { bytes, appearanceWarning, editorStateSkipped, rasterized } = await buildPdfBytes();
    downloadBytes(bytes, "edited.pdf");

    const notes: string[] = [];
    if (appearanceWarning) {
      notes.push(
        "このPDFのフォーム項目の構造が特殊なため、入力した値の「見た目」を更新できませんでした。" +
          "値自体は保存されているので、AcrobatなどのPDFリーダーで開くと正しく表示されるはずです。"
      );
    }
    if (rasterized) {
      notes.push(
        "このPDFは内部構造の都合で通常の方法では書き換えられなかったため、各ページを画像として保存しました" +
          "(元のテキスト選択・フォーム項目は失われます。追加した注釈はそのまま反映されています)。"
      );
    }
    if (editorStateSkipped) {
      notes.push("再編集用データを埋め込めなかったため、このPDFを再度開いても注釈は編集できません。");
    }
    if (notes.length) alert("PDFを保存しました。ただし:\n" + notes.join("\n"));
  } catch (err) {
    console.error(err);
    const message = err instanceof Error ? err.message : String(err);
    alert("PDFの保存に失敗しました: " + message);
  } finally {
    els.saveBtn.disabled = false;
    els.saveBtn.textContent = "PDFを保存";
  }
}
