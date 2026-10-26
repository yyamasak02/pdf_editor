// PDFの読み込み共通処理。
// 暗号化PDF(空パスワードで開けるもの。印刷のみ許可など)は、復号して読み込む。
// ただし復号後に保存すると、元ファイルの旧xrefストリーム(/Encrypt を含む。pdf-libには
// 解釈できない「不正なオブジェクト」として生のまま書き戻される)と暗号化辞書が出力に残り、
// リーダーが「暗号化されている」と誤認して開けなくなる。そのため読み込み直後に取り除く。
import { PDFDict, PDFDocument, PDFInvalidObject, PDFName } from "@cantoo/pdf-lib";

export async function loadPdfDocument(bytes: Uint8Array): Promise<PDFDocument> {
  const doc = await PDFDocument.load(bytes, { password: "", ignoreEncryption: true });
  stripEncryption(doc);
  return doc;
}

const latin1 = (data: Uint8Array): string => {
  let s = "";
  for (let i = 0; i < data.length; i++) s += String.fromCharCode(data[i] as number);
  return s;
};

function stripEncryption(doc: PDFDocument): void {
  const ctx = doc.context;
  const filter = PDFName.of("Filter");
  const standard = PDFName.of("Standard");
  const toDelete: Parameters<typeof ctx.delete>[0][] = [];

  ctx.enumerateIndirectObjects().forEach(([ref, obj]) => {
    // 旧xrefストリーム(解釈できず生のバイト列で保持されている)。再出力してはいけない。
    if (obj instanceof PDFInvalidObject) {
      const raw = latin1((obj as unknown as { data: Uint8Array }).data ?? new Uint8Array());
      if (/\/XRef\b/.test(raw) || /\/Encrypt\b/.test(raw)) toDelete.push(ref);
      return;
    }
    // 暗号化辞書そのもの(/Filter /Standard と /O /U を持つ)。
    if (
      obj instanceof PDFDict &&
      obj.get(filter) === standard &&
      obj.has(PDFName.of("O")) &&
      obj.has(PDFName.of("U"))
    ) {
      toDelete.push(ref);
    }
  });
  toDelete.forEach((ref) => ctx.delete(ref));
}
