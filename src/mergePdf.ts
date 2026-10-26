// 複数PDFの結合。指定された順に全ページをコピーして1つのPDFにまとめる。
import { PDFDocument } from "@cantoo/pdf-lib";
import { loadPdfDocument } from "./pdfLoad";

export async function mergePdfs(sources: Uint8Array[]): Promise<Uint8Array> {
  if (sources.length === 0) throw new Error("結合するPDFがありません");
  const out = await PDFDocument.create();
  for (const bytes of sources) {
    const src = await loadPdfDocument(bytes);
    const pages = await out.copyPages(src, src.getPageIndices());
    pages.forEach((p) => out.addPage(p));
  }
  return out.save();
}
