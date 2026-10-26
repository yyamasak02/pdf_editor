// このツールで保存したPDFを、後で再び開いたときに編集可能な状態へ復元するための仕組み。
//
// 書き出し時、PDFの中に2つのファイルを添付(embed)する:
//   1. __pdf_editor_original__.pdf … 一度も加工していない、最初のPDFそのもの
//   2. __pdf_editor_state__.json   … 各ページの注釈(テキスト/画像/図形など)を
//                                     fabric.jsのJSON形式で保存したもの
//
// 再度開いたときはこの2つを取り出し、「原本」を土台にして注釈を復元する。
// 原本を土台にし続けることで、保存を繰り返しても注釈が重複して焼き込まれることがない。
import {
  PDFArray,
  PDFDict,
  PDFDocument,
  PDFHexString,
  PDFName,
  PDFRawStream,
  PDFStream,
  PDFString,
  decodePDFRawStream,
} from "@cantoo/pdf-lib";
import type { PersistedEditorState, FabricCanvasJSON, FormValues } from "./types";

const ORIGINAL_FILENAME = "__pdf_editor_original__.pdf";
const STATE_FILENAME = "__pdf_editor_state__.json";

/**
 * pdf-lib の attach() は、カタログ内の Names / EmbeddedFiles / AF が想定外の型
 * (参照切れ・辞書と配列の取り違えなど)だと「Expected instance of ...」で保存全体が
 * 失敗する。添付の前に、壊れている箇所だけを空の正しい型に置き換えておく。
 */
function sanitizeAttachmentTree(pdfDoc: PDFDocument): void {
  const ctx = pdfDoc.context;
  const catalog = pdfDoc.catalog;
  const names = PDFName.of("Names");
  const ef = PDFName.of("EmbeddedFiles");
  const af = PDFName.of("AF");

  // lookupMaybe は型違いだと undefined ではなく例外を投げるため、型指定なしで引いて自前で判定する。
  if (catalog.has(names) && !(catalog.lookup(names) instanceof PDFDict)) catalog.delete(names);
  const namesDict = catalog.has(names) ? (catalog.lookup(names) as PDFDict) : undefined;
  if (namesDict?.has(ef) && !(namesDict.lookup(ef) instanceof PDFDict)) namesDict.delete(ef);
  const efDict = namesDict?.has(ef) ? (namesDict.lookup(ef) as PDFDict) : undefined;
  if (efDict?.has(names) && !(efDict.lookup(names) instanceof PDFArray)) efDict.delete(names);
  if (catalog.has(af) && !(catalog.lookup(af) instanceof PDFArray)) catalog.set(af, ctx.obj([]));
}

export async function embedEditorState(
  pdfDoc: PDFDocument,
  originalBytes: Uint8Array,
  pages: (FabricCanvasJSON | null)[],
  formValues: FormValues = {}
): Promise<void> {
  const state: PersistedEditorState = { tool: "pdf-editor-tool", version: 1, pages, formValues };
  const stateJson = JSON.stringify(state);

  sanitizeAttachmentTree(pdfDoc);
  await pdfDoc.attach(originalBytes, ORIGINAL_FILENAME, {
    mimeType: "application/pdf",
    description: "PDF編集ツール: 加工前の原本",
  });
  await pdfDoc.attach(new TextEncoder().encode(stateJson), STATE_FILENAME, {
    mimeType: "application/json",
    description: "PDF編集ツール: 編集状態(再編集用)",
  });
}

export interface LoadedEditorState {
  originalBytes: Uint8Array;
  pages: (FabricCanvasJSON | null)[];
  formValues: FormValues;
}

/**
 * 添付ファイルから、このツールで保存された原本と編集状態を取り出す。
 * このツールで保存されたPDFでなければ null を返す。
 */
export function readEditorState(pdfDoc: PDFDocument): LoadedEditorState | null {
  const originalBytes = findAttachment(pdfDoc, ORIGINAL_FILENAME);
  const stateBytes = findAttachment(pdfDoc, STATE_FILENAME);
  if (!originalBytes || !stateBytes) return null;

  let parsed: PersistedEditorState;
  try {
    parsed = JSON.parse(new TextDecoder().decode(stateBytes));
  } catch {
    return null;
  }
  if (parsed.tool !== "pdf-editor-tool" || !Array.isArray(parsed.pages)) return null;

  return { originalBytes, pages: parsed.pages, formValues: parsed.formValues ?? {} };
}

function findAttachment(pdfDoc: PDFDocument, targetName: string): Uint8Array | null {
  const namesDict = pdfDoc.catalog.lookupMaybe(PDFName.of("Names"), PDFDict);
  const embeddedFilesDict = namesDict?.lookupMaybe(PDFName.of("EmbeddedFiles"), PDFDict);
  const namesArray = embeddedFilesDict?.lookupMaybe(PDFName.of("Names"), PDFArray);
  if (!namesArray) return null;

  for (let i = 0; i < namesArray.size(); i += 2) {
    const nameObj = namesArray.lookup(i);
    const name =
      nameObj instanceof PDFHexString || nameObj instanceof PDFString ? nameObj.decodeText() : null;
    if (name !== targetName) continue;

    const fileSpecRef = namesArray.get(i + 1);
    const fileSpecDict = pdfDoc.context.lookupMaybe(fileSpecRef, PDFDict);
    const efDict = fileSpecDict?.lookupMaybe(PDFName.of("EF"), PDFDict);
    const fStreamRef = efDict?.get(PDFName.of("F"));
    const stream = pdfDoc.context.lookupMaybe(fStreamRef, PDFStream);
    if (!(stream instanceof PDFRawStream)) continue;

    return decodePDFRawStream(stream).decode();
  }
  return null;
}
