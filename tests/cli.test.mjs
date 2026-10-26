// CLI(AI/スクリプト向け)のテスト: 実際に dist/cli.mjs を起動して、JSON仕様どおりに編集できるか検証する。
// 事前に `npm run build` が必要。
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PDFDocument } from "@cantoo/pdf-lib";

const CLI = "dist/cli.mjs";
const dir = mkdtempSync(join(tmpdir(), "pdf-edit-"));
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function run(...args) {
  const r = spawnSync("node", [CLI, ...args], { encoding: "utf8" });
  let json;
  try { json = JSON.parse(r.stdout); } catch { json = undefined; }
  return { code: r.status, json, stdout: r.stdout, stderr: r.stderr };
}

async function makePdf(name, { form = false, encrypt = false, pages = 1 } = {}) {
  const d = await PDFDocument.create();
  for (let i = 0; i < pages; i++) d.addPage([300, 400]);
  const p = d.getPage(0);
  p.drawText("Existing text", { x: 20, y: 350, size: 12 });
  if (form) {
    const f = d.getForm();
    f.createTextField("name").addToPage(p, { x: 20, y: 300, width: 150, height: 20 });
    f.createCheckBox("agree").addToPage(p, { x: 20, y: 270, width: 15, height: 15 });
    const dd = f.createDropdown("sel"); dd.addOptions(["a", "b"]); dd.addToPage(p, { x: 20, y: 240, width: 60, height: 20 });
    const rg = f.createRadioGroup("rg"); rg.addOptionToPage("x", p, { x: 20, y: 210, width: 15, height: 15 }); rg.addOptionToPage("y", p, { x: 50, y: 210, width: 15, height: 15 });
  }
  if (encrypt) d.encrypt({ userPassword: "", ownerPassword: "o", permissions: { modifying: false, copying: false } });
  const path = join(dir, name);
  writeFileSync(path, await d.save());
  return path;
}
const spec = (name, obj) => { const p = join(dir, name); writeFileSync(p, JSON.stringify(obj)); return p; };
const out = (name) => join(dir, name);

test("inspect: ページ寸法・既存テキストの位置(左上原点・pt)・フォーム項目が取れる", async () => {
  const pdf = await makePdf("in1.pdf", { form: true });
  const r = run("inspect", pdf);
  assert.equal(r.code, 0);
  assert.equal(r.json.pageCount, 1);
  assert.deepEqual(r.json.pages[0], { page: 1, width: 300, height: 400 });
  const t = r.json.text.find((x) => x.text === "Existing text");
  assert.ok(t, "既存テキストが見つかる");
  assert.ok(Math.abs(t.x - 20) < 1 && Math.abs(t.y - (400 - 350 - 12)) < 4, `位置が左上原点で返る: ${t.x},${t.y}`);
  assert.equal(r.json.text.find((x) => x.text === "Existing text").fontSize, 12);
  const names = r.json.form.map((f) => `${f.name}:${f.kind}`).sort();
  assert.deepEqual(names, ["agree:checkbox", "name:text", "rg:radio", "sel:dropdown"]);
  assert.ok(r.json.form.find((f) => f.name === "name").width > 100, "フォーム項目の位置も返る");
});

test("inspect: stdoutは常に純粋なJSON(pdf.jsの警告が混ざらない)", async () => {
  const r = run("inspect", await makePdf("in2.pdf"));
  assert.ok(r.json, r.stdout.slice(0, 200));
});

test("apply: text/rect/ellipse/line/image を一度に追加して、inspectで確認できる", async () => {
  const pdf = await makePdf("in3.pdf", { pages: 2 });
  writeFileSync(join(dir, "stamp.png"), Buffer.from(PNG, "base64"));
  const s = spec("e3.json", {
    items: [
      { type: "text", page: 1, x: 50, y: 60, text: "Added text", fontSize: 16, color: "#ff0000", bold: true },
      { type: "text", page: 2, x: 10, y: 10, text: "page two" },
      { type: "rect", page: 1, x: 50, y: 100, width: 100, height: 40, stroke: "#00ff00", strokeWidth: 2, fill: "#ffff00" },
      { type: "ellipse", page: 1, x: 50, y: 160, width: 80, height: 40, stroke: "#0000ff" },
      { type: "line", page: 1, x: 10, y: 230, x2: 200, y2: 230, stroke: "#000000", strokeWidth: 2 },
      { type: "image", page: 1, x: 200, y: 20, width: 40, height: 40, path: join(dir, "stamp.png") },
      { type: "image", page: 2, x: 200, y: 20, width: 40, height: 40, src: "data:image/png;base64," + PNG },
    ],
  });
  const r = run("apply", pdf, s, "-o", out("o3.pdf"));
  assert.equal(r.code, 0, r.stdout);
  assert.equal(r.json.ok, true);
  assert.equal(r.json.itemsApplied, 7);
  const back = run("inspect", out("o3.pdf")).json;
  assert.equal(back.pageCount, 2);
  const added = back.text.find((t) => t.text === "Added text");
  assert.ok(added && Math.abs(added.x - 50) < 1 && Math.abs(added.y - 60) < 3, `指定位置に配置される: ${JSON.stringify(added)}`);
  assert.equal(added.fontSize, 16);
  assert.ok(back.text.find((t) => t.page === 2 && t.text === "page two"), "2ページ目にも追加");
  assert.ok(back.text.find((t) => t.text === "Existing text"), "既存テキストは残る");
});

test("apply: 日本語は自動でNoto Sans JPが埋め込まれ、テキストとして取り出せる", async () => {
  const pdf = await makePdf("in4.pdf");
  const r = run("apply", pdf, spec("e4.json", { items: [{ type: "text", page: 1, x: 20, y: 100, text: "山田 太郎 就職・卒業", fontSize: 14 }] }), "-o", out("o4.pdf"));
  assert.equal(r.code, 0, r.stdout);
  const back = run("inspect", out("o4.pdf")).json;
  assert.ok(back.text.some((t) => t.text.includes("山田")), JSON.stringify(back.text.map((t) => t.text)));
  assert.ok(Buffer.from(readFileSync(out("o4.pdf"))).toString("latin1").includes("NotoSansJP"));
});

test("apply: 折り返し・中央揃え・回転・不透明度・背景色でもエラーにならない", async () => {
  const pdf = await makePdf("in5.pdf");
  const r = run("apply", pdf, spec("e5.json", { items: [
    { type: "text", page: 1, x: 20, y: 100, width: 100, text: "This is a long sentence that must wrap", align: "center", background: "#ffff00" },
    { type: "text", page: 1, x: 150, y: 200, text: "Rotated", rotation: 45, opacity: 0.5 },
    { type: "rect", page: 1, x: 150, y: 250, width: 60, height: 30, rotation: 30, stroke: "#000000", opacity: 0.4 },
  ] }), "-o", out("o5.pdf"));
  assert.equal(r.code, 0, r.stdout);
  const back = run("inspect", out("o5.pdf")).json;
  const lines = back.text.filter((t) => /This|is a|long|wrap|sentence|must/.test(t.text));
  assert.ok(lines.length >= 3, "折り返されて複数行になる: " + JSON.stringify(lines.map((l) => l.text)));
});

test("apply: フォーム入力(全種別)とflatten", async () => {
  const pdf = await makePdf("in6.pdf", { form: true });
  const r = run("apply", pdf, spec("e6.json", { form: { name: "山田 太郎", agree: true, sel: "b", rg: "y" } }), "-o", out("o6.pdf"));
  assert.equal(r.code, 0, r.stdout);
  assert.deepEqual(r.json.warnings, []);
  const f = (await PDFDocument.load(readFileSync(out("o6.pdf")))).getForm();
  assert.equal(f.getTextField("name").getText(), "山田 太郎");
  assert.equal(f.getCheckBox("agree").isChecked(), true);
  assert.deepEqual(f.getDropdown("sel").getSelected(), ["b"]);
  assert.equal(f.getRadioGroup("rg").getSelected(), "y");
  // 再度inspectしても、値が確認できる(AIが結果を検証できる)
  const back = run("inspect", out("o6.pdf")).json.form;
  assert.equal(back.find((x) => x.name === "name").value, "山田 太郎");
  assert.equal(back.find((x) => x.name === "agree").value, true);

  const fl = run("apply", pdf, spec("e6b.json", { form: { name: "X" }, flatten: true }), "-o", out("o6b.pdf"));
  assert.equal(fl.code, 0);
  assert.equal((await PDFDocument.load(readFileSync(out("o6b.pdf")))).getForm().getFields().length, 0);
});

test("apply: 存在しないフォーム項目は警告として返し、他は反映する", async () => {
  const pdf = await makePdf("in7.pdf", { form: true });
  const r = run("apply", pdf, spec("e7.json", { form: { name: "ok", nothing: "x" } }), "-o", out("o7.pdf"));
  assert.equal(r.code, 0);
  assert.ok(r.json.warnings.some((w) => w.includes("nothing")), JSON.stringify(r.json.warnings));
});

test("apply: 暗号化PDF(空パスワード)を復号して編集でき、出力はパスワード不要", async () => {
  const pdf = await makePdf("in8.pdf", { encrypt: true });
  const r = run("apply", pdf, spec("e8.json", { items: [{ type: "text", page: 1, x: 20, y: 100, text: "edited" }] }), "-o", out("o8.pdf"));
  assert.equal(r.code, 0, r.stdout);
  assert.ok(!readFileSync(out("o8.pdf")).toString("latin1").includes("/Encrypt"));
  assert.ok(run("inspect", out("o8.pdf")).json.text.some((t) => t.text === "edited"));
});

test("エラー: 不正な指定は、直し方が分かるメッセージとexit 1で返る", async () => {
  const pdf = await makePdf("in9.pdf");
  const cases = [
    [{ items: [{ type: "text", page: 3, x: 1, y: 1, text: "a" }] }, /page 3 は存在しません/],
    [{ items: [{ type: "star", page: 1, x: 1, y: 1 }] }, /type は text/],
    [{ items: [{ type: "text", page: 1, x: "10", y: 1, text: "a" }] }, /x は数値/],
    [{ items: [{ type: "rect", page: 1, x: 1, y: 1, width: 0, height: 5 }] }, /width と height/],
    [{ items: [{ type: "text", page: 1, x: 1, y: 1, text: "a", color: "red" }] }, /#rrggbb/],
    [{ items: [{ type: "image", page: 1, x: 1, y: 1, width: 5, height: 5 }] }, /src.*path/],
    [{ items: [{ type: "text", page: 1, x: 1, y: 1, text: "a", opacity: 2 }] }, /opacity/],
  ];
  for (const [body, re] of cases) {
    const r = run("apply", pdf, spec("bad.json", body), "-o", out("bad.pdf"));
    assert.equal(r.code, 1);
    assert.match(r.json.error, re);
  }
  assert.equal(run("apply", pdf, spec("ok.json", {})).code, 1, "-o 必須");
  assert.equal(run("bogus").code, 1);
});

test("schema: AIに渡せる仕様が出る", () => {
  const r = run("schema");
  assert.equal(r.code, 0);
  assert.ok(r.json.items.text && r.json.workflow.length >= 3 && r.json.example);
});

test("pdf.jsで開けない/pdf-libで開けない壊れたPDFは、エラーJSONで返る(クラッシュしない)", async () => {
  const bad = join(dir, "garbage.pdf");
  writeFileSync(bad, "not a pdf");
  const r = run("inspect", bad);
  assert.equal(r.code, 1);
  assert.ok(r.json.error);
});
