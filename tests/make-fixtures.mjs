import { PDFDocument } from "@cantoo/pdf-lib";
import { writeFileSync } from "node:fs";
// 手書きPDF。pdf-libが解釈できないトークンを含むオブジェクトを混ぜる。
function make(variant) {
  const objs = [];
  objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
  objs[2] = variant === "badpages" ? "<< /Type /Pages /Kids [3 0 R] /Count 1 /X ~~~ >>" : "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
  objs[3] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 400] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>";
  const content = "BT /F1 24 Tf 20 200 Td (Hello fixture) Tj ET";
  objs[4] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  objs[5] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
  let out = "%PDF-1.4\n"; const offs = [];
  for (let i = 1; i < objs.length; i++) { offs[i] = out.length; out += `${i} 0 obj\n${objs[i]}\nendobj\n`; }
  const x = out.length;
  out += `xref\n0 ${objs.length}\n0000000000 65535 f \n` + offs.slice(1).map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
  out += `trailer\n<< /Size ${objs.length} /Root 1 0 R >>\nstartxref\n${x}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}
for (const v of ["ok", "badpages"]) {
  const b = make(v); writeFileSync(`${process.argv[2]}/${v}.pdf`, b);
  try { const d = await PDFDocument.load(b, { password: "", ignoreEncryption: true }); d.getPages(); console.log(v, "pdf-lib OK"); } catch (e) { console.log(v, "pdf-lib FAIL:", e.message); }
}

// 暗号化(AES-256・空のユーザーパスワード・編集制限あり)のPDF。pdf-libは復号できず、pdf.jsは開ける種類。
{
  const d = await PDFDocument.create();
  d.addPage([300, 400]).drawText("encrypted fixture", { x: 20, y: 200 });
  d.encrypt({ userPassword: "", ownerPassword: "owner-secret", permissions: { printing: "highResolution", modifying: false, copying: false } });
  writeFileSync(`${process.argv[2]}/encrypted.pdf`, await d.save());
  console.log("encrypted.pdf written");
}
