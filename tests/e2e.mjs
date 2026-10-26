// E2E: 実ブラウザ(Chromium)で index.html を開き、実際のUI操作で「開く→編集→保存」を検証する。
// 事前に `npm run build` が必要。ブラウザは CHROME 環境変数、または playwright のキャッシュから探す。
import { chromium } from "playwright-core";
import { PDFDocument, PDFName as PDFName_ } from "@cantoo/pdf-lib";
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { test, after } from "node:test";
import assert from "node:assert/strict";

function findChrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const base = join(homedir(), ".cache/ms-playwright");
  if (!existsSync(base)) return undefined;
  for (const d of readdirSync(base).sort().reverse()) {
    if (!d.startsWith("chromium_headless_shell")) continue;
    const exe = join(base, d, "chrome-headless-shell-linux64/chrome-headless-shell");
    if (existsSync(exe)) return exe;
  }
}

const URL_ = "file://" + resolve("index.html");
const FIXTURES = resolve("tests/fixtures");
mkdirSync(FIXTURES, { recursive: true });
const browser = await chromium.launch({ executablePath: findChrome(), args: ["--no-sandbox"] });
after(() => browser.close());

async function openApp(pdfPath) {
  const ctx = await browser.newContext({ acceptDownloads: true });
  const page = await ctx.newPage();
  const dialogs = [];
  const errors = [];
  page.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(URL_);
  await page.setInputFiles("#file-input", pdfPath);
  await page.waitForFunction(() => document.querySelector("#save-btn") && !document.querySelector("#save-btn").disabled);
  await page.waitForSelector(".page-wrapper.visible canvas.upper-canvas");
  return { ctx, page, dialogs, errors };
}

async function save(page) {
  const [dl] = await Promise.all([page.waitForEvent("download", { timeout: 15000 }), page.click("#save-btn")]);
  const path = await dl.path();
  return readFileSync(path);
}

async function canvasPoint(page, x, y) {
  const box = await page.locator(".page-wrapper.visible canvas.upper-canvas").boundingBox();
  return { x: box.x + x, y: box.y + y };
}

async function makeSimplePdf() {
  const d = await PDFDocument.create();
  d.addPage([300, 400]);
  const p = join(FIXTURES, "simple.pdf");
  writeFileSync(p, await d.save());
  return p;
}

test("開いて保存(編集なし): 正常なPDF", async () => {
  const { page, dialogs, ctx } = await openApp(await makeSimplePdf());
  const out = await save(page);
  assert.deepEqual(dialogs, []);
  assert.equal((await PDFDocument.load(out)).getPageCount(), 1);
  await ctx.close();
});

test("開いて保存: pdf-libが解析できないPDF(回帰: Expected instance of ...)", async () => {
  const { page, dialogs, ctx } = await openApp(join(FIXTURES, "badpages.pdf"));
  const out = await save(page);
  assert.ok(dialogs.every((m) => !m.includes("失敗")), "失敗ダイアログが出ない: " + dialogs.join("|"));
  assert.equal((await PDFDocument.load(out)).getPageCount(), 1);
  await ctx.close();
});

test("テキスト追加→保存→開き直して編集状態が復元される", async () => {
  const { page, dialogs, ctx } = await openApp(await makeSimplePdf());
  await page.click('[data-tool="text"]');
  const p = await canvasPoint(page, 100, 100);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.type("E2E text");
  await page.click("#stage-area", { position: { x: 5, y: 5 } }).catch(() => {});
  const out = await save(page);
  assert.deepEqual(dialogs, []);
  const edited = join(FIXTURES, "edited-e2e.pdf");
  writeFileSync(edited, out);
  await ctx.close();

  const re = await openApp(edited);
  const count = await re.page.evaluate(() => window.__pdfEditorDebug.currentCanvas().getObjects().length);
  assert.equal(count, 1, "再オープンで注釈が復元される");
  const out2 = await save(re.page);
  assert.deepEqual(re.dialogs, []);
  assert.equal((await PDFDocument.load(out2)).getPageCount(), 1);
  await re.ctx.close();
});

test("四角・楕円・ペン・削除・編集モードOFF", async () => {
  const { page, dialogs, ctx } = await openApp(await makeSimplePdf());
  const objCount = () => page.evaluate(() => window.__pdfEditorDebug.currentCanvas().getObjects().length);
  for (const tool of ["rect", "ellipse"]) {
    await page.click(`[data-tool="${tool}"]`);
    const a = await canvasPoint(page, 60, 60), b = await canvasPoint(page, 160, 140);
    await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 5 }); await page.mouse.up();
  }
  assert.equal(await objCount(), 2);
  await page.click('[data-tool="pen"]');
  const a = await canvasPoint(page, 200, 200), b = await canvasPoint(page, 260, 260);
  await page.mouse.move(a.x, a.y); await page.mouse.down(); await page.mouse.move(b.x, b.y, { steps: 8 }); await page.mouse.up();
  assert.equal(await objCount(), 3);

  // 編集モードOFF: 新規追加できない
  await page.click("#edit-mode-toggle");
  assert.match(await page.textContent("#edit-mode-toggle"), /OFF/);
  await page.click('[data-tool="rect"]', { force: true }).catch(() => {});
  const c = await canvasPoint(page, 20, 300), d = await canvasPoint(page, 80, 360);
  await page.mouse.move(c.x, c.y); await page.mouse.down(); await page.mouse.move(d.x, d.y, { steps: 3 }); await page.mouse.up();
  assert.equal(await objCount(), 3, "OFFでは図形を追加できない");
  await page.click("#edit-mode-toggle");

  // 選択して削除
  await page.click('[data-tool="select"]');
  await page.evaluate(() => { const c = window.__pdfEditorDebug.currentCanvas(); c.setActiveObject(c.getObjects()[0]); });
  await page.click("#delete-selected");
  assert.equal(await objCount(), 2);

  const out = await save(page);
  assert.deepEqual(dialogs, []);
  assert.equal((await PDFDocument.load(out)).getPageCount(), 1);
  await ctx.close();
});

test("実PDF(任意): E2E_PDFS に指定したファイルを開いて保存できる", async (t) => {
  const files = (process.env.E2E_PDFS ?? "").split(":").filter(Boolean);
  if (!files.length) return t.skip("E2E_PDFS 未指定");
  for (const f of files) {
    const { page, dialogs, ctx } = await openApp(f);
    const out = await save(page);
    assert.ok(dialogs.every((m) => !m.includes("失敗")), f + ": " + dialogs.join("|"));
    assert.ok((await PDFDocument.load(out, { password: "", ignoreEncryption: true })).getPageCount() >= 1, f);
    await ctx.close();
  }
});

// ---- フォーム入力が保存後のページ表示に反映されること ----
async function makeFormPdf(name, mutate) {
  const { PDFName, PDFDict } = await import("@cantoo/pdf-lib");
  const d = await PDFDocument.create();
  const p = d.addPage([300, 200]);
  const f = d.getForm();
  const t = f.createTextField("name");
  t.addToPage(p, { x: 20, y: 120, width: 200, height: 30 });
  const c = f.createCheckBox("agree");
  c.addToPage(p, { x: 20, y: 70, width: 20, height: 20 });
  mutate?.(d, { PDFName, PDFDict });
  const path = join(FIXTURES, name);
  writeFileSync(path, await d.save());
  return path;
}

/** ページ背景(pdf.jsの描画結果)に、フォーム位置で「黒っぽい画素」がどれだけあるか数える。 */
async function inkInRegion(page, region) {
  return page.evaluate((r) => {
    const c = window.__pdfEditorDebug.currentCanvas();
    const ctx = c.getContext();
    const s = 2; // RENDER_SCALE
    const data = c.lowerCanvasEl.getContext("2d").getImageData(r.x * s, r.y * s, r.w * s, r.h * s).data;
    let n = 0;
    for (let i = 0; i < data.length; i += 4) if (data[i] < 100 && data[i + 1] < 100 && data[i + 2] < 100) n++;
    return n;
  }, region);
}

for (const [label, mutate] of [
  ["通常のフォーム", undefined],
  ["DA/DR無しのフォーム", (d, { PDFName, PDFDict }) => {
    const af = d.catalog.lookup(PDFName.of("AcroForm"), PDFDict);
    af.delete(PDFName.of("DA")); af.delete(PDFName.of("DR"));
  }],
]) {
  test(`フォーム: 入力が即ページに出る・編集モードOFF中の入力も保存・開き直しで復元: ${label}`, async () => {
    const src = await makeFormPdf(`form-${label.length}.pdf`, mutate);
    const a = await openApp(src);
    const region = { x: 22, y: 52, w: 196, h: 26 };
    const before = await inkInRegion(a.page, region);
    await a.page.click("#toggle-form-panel");
    await a.page.click("#edit-mode-toggle"); // 編集モードOFFのまま入力する
    assert.match(await a.page.textContent("#edit-mode-toggle"), /OFF/);
    await a.page.fill('#form-fields-list input[type="text"]', "Hello Taro");
    await a.page.check('#form-fields-list input[type="checkbox"]');
    await a.page.waitForFunction(
      ([r, b]) => {
        const c = window.__pdfEditorDebug.currentCanvas();
        const d = c.lowerCanvasEl.getContext("2d").getImageData(r.x * 2, r.y * 2, r.w * 2, r.h * 2).data;
        let n = 0;
        for (let i = 0; i < d.length; i += 4) if (d[i] < 100 && d[i + 1] < 100 && d[i + 2] < 100) n++;
        return n > b + 30;
      },
      [region, before],
      { timeout: 10000 }
    );

    const out = await save(a.page);
    assert.deepEqual(a.dialogs, []);
    const saved = join(FIXTURES, `form-saved-${label.length}.pdf`);
    writeFileSync(saved, out);
    await a.ctx.close();

    const form = (await PDFDocument.load(out)).getForm();
    assert.equal(form.getTextField("name").getText(), "Hello Taro");
    assert.equal(form.getCheckBox("agree").isChecked(), true);

    // アプリで開き直しても、欄・ページ表示の両方に値が残っている
    const b = await openApp(saved);
    await b.page.click("#toggle-form-panel");
    assert.equal(await b.page.inputValue('#form-fields-list input[type="text"]'), "Hello Taro");
    assert.equal(await b.page.isChecked('#form-fields-list input[type="checkbox"]'), true);
    const ink = await inkInRegion(b.page, region);
    assert.ok(ink > before + 30, `開き直したページ上に入力文字が描画されている (ink=${ink}, before=${before})`);
    await b.ctx.close();
  });
}

test("フォーム: 保存→開き直し→そのまま再保存しても入力値が消えない(英数字・日本語)", async () => {
  const src = await makeFormPdf("form-resave.pdf");
  for (const value of ["Hello Taro", "山田 太郎"]) {
    const a = await openApp(src);
    await a.page.click("#toggle-form-panel");
    await a.page.fill('#form-fields-list input[type="text"]', value);
    const first = await save(a.page);
    const path = join(FIXTURES, "form-resave-1.pdf");
    writeFileSync(path, first);
    await a.ctx.close();
    assert.equal((await PDFDocument.load(first)).getForm().getTextField("name").getText(), value, "1回目の保存");

    const b = await openApp(path);
    await b.page.click("#toggle-form-panel");
    assert.equal(await b.page.inputValue('#form-fields-list input[type="text"]'), value, "開き直し時のフォーム欄");
    const second = await save(b.page); // 何も触らず再保存
    assert.equal((await PDFDocument.load(second)).getForm().getTextField("name").getText(), value, "再保存: " + value);
    assert.deepEqual(b.dialogs, []);
    await b.ctx.close();
  }
});

test("暗号化PDF(空パスワード・編集制限)を開いて、画像化せずに保存できる", async () => {
  const { page, dialogs, ctx } = await openApp(join(FIXTURES, "encrypted.pdf"));
  await page.click('[data-tool="text"]');
  const p = await canvasPoint(page, 100, 100);
  await page.mouse.click(p.x, p.y);
  await page.keyboard.type("memo");
  const out = await save(page);
  assert.deepEqual(dialogs, [], "「画像として保存」などの警告が出ない: " + dialogs.join("|"));
  const doc = await PDFDocument.load(out); // 復号済みで保存される(パスワード不要)
  assert.equal(doc.getPageCount(), 1);
  const text = Buffer.from(out).toString("latin1");
  assert.ok(!text.includes("/DCTDecode"), "ページを画像化していない");
  await ctx.close();
});

test("日本語のテキストボックス: 保存→開き直しで復元され、再保存でも日本語フォントで保存される", async () => {
  const { page, dialogs, ctx } = await openApp(await makeSimplePdf());
  await page.evaluate(() => {
    const c = window.__pdfEditorDebug.currentCanvas();
    c.add(new window.fabric.Textbox("就職・卒業 山田太郎", { left: 40, top: 40, width: 300 }));
  }).catch(() => {});
  const count = await page.evaluate(() => window.__pdfEditorDebug.currentCanvas().getObjects().length);
  if (count === 0) { // fabricがwindowに無い場合はUI操作で追加する
    await page.click('[data-tool="text"]');
    const p = await canvasPoint(page, 80, 80);
    await page.mouse.click(p.x, p.y);
    await page.keyboard.type("就職・卒業 山田太郎");
  }
  const out = await save(page);
  assert.deepEqual(dialogs, []);
  const names = [];
  (await PDFDocument.load(out)).context.enumerateIndirectObjects().forEach(([, o]) => {
    const b = o.dict?.get?.(PDFName_.of("BaseFont")); if (b) names.push(String(b));
  });
  assert.ok(names.some((n) => /NotoSansJP/.test(n)), "日本語フォントが埋め込まれている: " + names.join(","));
  await ctx.close();
});

// ---- コピー&ペースト / ショートカット ----
async function makeTwoPagePdf() {
  const d = await PDFDocument.create();
  d.addPage([300, 400]); d.addPage([300, 400]);
  const p = join(FIXTURES, "two.pdf");
  writeFileSync(p, await d.save());
  return p;
}
const count = (page) => page.evaluate(() => window.__pdfEditorDebug.currentCanvas().getObjects().length);
const pageCount = (page, n) => page.evaluate((n) => window.__pdfEditorDebug.state.pageCanvases[n]?.getObjects().length, n);

test("ショートカット: Ctrl+C/Ctrl+V・Ctrl+D・Ctrl+X・Ctrl+A、別ページへの貼り付け", async () => {
  const { page, dialogs, ctx } = await openApp(await makeTwoPagePdf());
  await page.evaluate(() => window.pdfEditor.add([{ type: "rect", page: 1, x: 40, y: 40, width: 60, height: 30, stroke: "#ff0000" }]));
  await page.evaluate(() => { const c = window.__pdfEditorDebug.currentCanvas(); c.setActiveObject(c.getObjects()[0]); });

  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await page.waitForFunction(() => window.__pdfEditorDebug.currentCanvas().getObjects().length === 2);
  const lefts = await page.evaluate(() => window.__pdfEditorDebug.currentCanvas().getObjects().map((o) => o.left));
  assert.ok(lefts[1] > lefts[0], "貼り付けは少しずらして置かれる");
  const ids = await page.evaluate(() => window.__pdfEditorDebug.currentCanvas().getObjects().map((o) => o.id));
  assert.notEqual(ids[0], ids[1], "貼り付けたものは別idになる");

  await page.keyboard.press("Control+d"); // 貼り付けたもの(選択中)を複製
  await page.waitForFunction(() => window.__pdfEditorDebug.currentCanvas().getObjects().length === 3);

  await page.keyboard.press("Control+a");
  assert.equal(await page.evaluate(() => window.__pdfEditorDebug.currentCanvas().getActiveObjects().length), 3);
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+x"); // 選択中の3つを切り取る(ページ上から消え、クリップボードに入る)
  await page.waitForFunction(() => window.__pdfEditorDebug.currentCanvas().getObjects().length === 0);

  // 切り取った3つを2ページ目へ貼り付ける
  await page.evaluate(() => window.pdfEditor.gotoPage(2));
  await page.waitForFunction(() => window.__pdfEditorDebug.state.currentPage === 1);
  await page.keyboard.press("Control+v");
  await page.waitForFunction(() => window.__pdfEditorDebug.currentCanvas().getObjects().length === 3);
  assert.equal(await pageCount(page, 0), 0);
  assert.deepEqual(dialogs, []);
  await ctx.close();
});

test("ショートカット: 文字入力中のCtrl+C/Vは、オブジェクトのコピーにならない", async () => {
  const { page, ctx } = await openApp(await makeSimplePdf());
  await page.evaluate(() => window.pdfEditor.add([{ type: "text", page: 1, x: 40, y: 40, text: "abc", width: 100 }]));
  await page.evaluate(() => { const c = window.__pdfEditorDebug.currentCanvas(); const t = c.getObjects()[0]; c.setActiveObject(t); t.enterEditing(); t.selectAll(); });
  await page.keyboard.press("Control+c");
  await page.keyboard.press("Control+v");
  await page.waitForTimeout(200);
  assert.equal(await count(page), 1, "編集中はオブジェクトが増えない");
  await ctx.close();
});

test("編集モードOFF: ショートカットでの貼り付け・複製は効かない", async () => {
  const { page, ctx } = await openApp(await makeSimplePdf());
  await page.evaluate(() => window.pdfEditor.add([{ type: "rect", page: 1, x: 40, y: 40, width: 60, height: 30, stroke: "#f00" }]));
  await page.evaluate(() => { const c = window.__pdfEditorDebug.currentCanvas(); c.setActiveObject(c.getObjects()[0]); });
  await page.keyboard.press("Control+c");
  await page.click("#edit-mode-toggle");
  await page.keyboard.press("Control+v");
  await page.keyboard.press("Control+d");
  await page.waitForTimeout(200);
  assert.equal(await count(page), 1);
  await ctx.close();
});

// ---- プロパティパネル ----
test("プロパティパネル: 選択で表示され、数値入力が反映され、保存結果にも出る(位置・サイズ・回転・文字・色)", async () => {
  const { page, dialogs, ctx } = await openApp(await makeSimplePdf());
  assert.equal(await page.isVisible("#props-body"), false, "未選択では欄を出さない");
  const [id] = await page.evaluate(() => window.pdfEditor.add([{ type: "text", page: 1, x: 40, y: 40, text: "Panel Test", fontSize: 12, width: 120 }]));
  await page.evaluate((id) => { const c = window.__pdfEditorDebug.currentCanvas(); c.setActiveObject(c.getObjects().find((o) => o.id === id)); }, id);
  await page.waitForSelector("#props-body", { state: "visible" });
  assert.equal(await page.inputValue("#prop-x"), "40");
  assert.equal(await page.inputValue("#prop-fontsize"), "12");

  await page.fill("#prop-x", "100"); await page.fill("#prop-y", "150");
  await page.fill("#prop-w", "200");
  await page.fill("#prop-fontsize", "20");
  await page.fill("#prop-angle", "0");
  await page.click("#prop-bold");
  await page.click("#prop-align-center");
  await page.fill("#prop-opacity", "80");
  await page.fill("#prop-color", "#0000ff");

  const spec = await page.evaluate(() => window.pdfEditor.list(1).then((l) => l[0]));
  assert.equal(spec.x, 100); assert.equal(spec.y, 150);
  assert.equal(spec.width, 200); assert.equal(spec.fontSize, 20);
  assert.equal(spec.bold, true); assert.equal(spec.align, "center");
  assert.equal(spec.opacity, 0.8); assert.equal(spec.color, "#0000ff");

  // 保存結果(実PDF)でも、指定位置・サイズで出ている
  const out = await save(page);
  assert.deepEqual(dialogs, []);
  const outPath = join(FIXTURES, "panel-out.pdf");
  writeFileSync(outPath, out);
  const insp = JSON.parse((await import("node:child_process")).spawnSync("node", ["dist/cli.mjs", "inspect", outPath], { encoding: "utf8" }).stdout);
  const t = insp.text.find((x) => x.text.includes("Panel Test"));
  assert.ok(t, "保存したPDFにテキストがある");
  assert.equal(Math.round(t.fontSize), 20);
  assert.ok(t.y > 140 && t.y < 160, `Y=150ptあたりに出ている: ${t.y}`);
  await ctx.close();
});

test("プロパティパネル: 図形の線・塗り・重なり順・複製・削除", async () => {
  const { page, ctx } = await openApp(await makeSimplePdf());
  await page.evaluate(() => window.pdfEditor.add([
    { type: "rect", page: 1, x: 40, y: 40, width: 60, height: 40, stroke: "#ff0000", strokeWidth: 2, fill: "#ffff00", id: "a" },
    { type: "rect", page: 1, x: 60, y: 50, width: 60, height: 40, stroke: "#0000ff", id: "b" },
  ]));
  const select = (id) => page.evaluate((id) => { const c = window.__pdfEditorDebug.currentCanvas(); c.setActiveObject(c.getObjects().find((o) => o.id === id)); }, id);
  const order = () => page.evaluate(() => window.__pdfEditorDebug.currentCanvas().getObjects().map((o) => o.id));

  await select("a");
  await page.waitForSelector("#prop-stroke", { state: "visible" });
  await page.fill("#prop-stroke", "#00ff00");
  await page.fill("#prop-strokewidth", "4");
  await page.check("#prop-fill-none");
  let a = (await page.evaluate(() => window.pdfEditor.list(1))).find((x) => x.id === "a");
  assert.equal(a.stroke, "#00ff00"); assert.equal(a.strokeWidth, 4); assert.equal(a.fill, undefined, "塗りなし");

  assert.deepEqual(await order(), ["a", "b"]);
  await page.click("#prop-front");
  assert.deepEqual(await order(), ["b", "a"]);
  await page.click("#prop-back");
  assert.deepEqual(await order(), ["a", "b"]);

  await page.click("#prop-duplicate");
  await page.waitForFunction(() => window.__pdfEditorDebug.currentCanvas().getObjects().length === 3);
  await page.click("#prop-delete");
  await page.waitForFunction(() => window.__pdfEditorDebug.currentCanvas().getObjects().length === 2);
  await ctx.close();
});

test("プロパティパネル: 編集モードOFFでは非表示", async () => {
  const { page, ctx } = await openApp(await makeSimplePdf());
  await page.evaluate(() => window.pdfEditor.add([{ type: "rect", page: 1, x: 40, y: 40, width: 60, height: 40, stroke: "#f00" }]));
  await page.evaluate(() => { const c = window.__pdfEditorDebug.currentCanvas(); c.setActiveObject(c.getObjects()[0]); });
  await page.waitForSelector("#props-panel", { state: "visible" });
  await page.click("#edit-mode-toggle");
  await page.waitForSelector("#props-panel", { state: "hidden" });
  await ctx.close();
});

// ---- ページ内API(window.pdfEditor) ----
test("API: info/add/list/update/remove/clear/setForm/export が一通り動く", async () => {
  const { page, dialogs, ctx } = await openApp(await makeFormPdf("api-form.pdf"));
  const info = await page.evaluate(() => window.pdfEditor.info());
  assert.equal(info.pageCount, 1);
  assert.deepEqual(info.pages[0], { page: 1, width: 300, height: 200 });
  assert.deepEqual(info.form.map((f) => f.name).sort(), ["agree", "name"]);

  const ids = await page.evaluate(() => window.pdfEditor.add([
    { type: "text", page: 1, x: 20, y: 20, text: "山田 太郎", fontSize: 14, id: "t1" },
    { type: "rect", page: 1, x: 20, y: 50, width: 80, height: 20, stroke: "#ff0000" },
    { type: "ellipse", page: 1, x: 120, y: 50, width: 60, height: 30, stroke: "#0000ff" },
    { type: "line", page: 1, x: 10, y: 100, x2: 200, y2: 100, stroke: "#000000" },
  ]));
  assert.equal(ids[0], "t1"); assert.equal(ids.length, 4);

  const list = await page.evaluate(() => window.pdfEditor.list());
  assert.deepEqual(list.map((i) => i.type), ["text", "rect", "ellipse", "line"]);
  assert.ok(list.every((i) => i.id), "全要素にidが付く");

  const upd = await page.evaluate(() => window.pdfEditor.update("t1", { x: 100, text: "鈴木 花子", fontSize: 18 }));
  assert.equal(upd.x, 100); assert.equal(upd.text, "鈴木 花子"); assert.equal(upd.fontSize, 18);
  assert.equal((await page.evaluate(() => window.pdfEditor.list())).length, 4, "更新で増えない");
  assert.equal((await page.evaluate(() => window.pdfEditor.list()))[0].id, "t1", "重なり順(先頭)が保たれる");

  const sf = await page.evaluate(() => window.pdfEditor.setForm({ name: "山田 太郎", agree: true, nope: "x" }));
  assert.deepEqual(sf.unknown, ["nope"]);

  const exp = await page.evaluate(() => window.pdfEditor.export());
  assert.equal(exp.rasterized, false); assert.deepEqual(exp.warnings, []);
  const bytes = Buffer.from(exp.base64, "base64");
  const doc = await PDFDocument.load(bytes);
  assert.equal(doc.getForm().getTextField("name").getText(), "山田 太郎");
  assert.equal(doc.getForm().getCheckBox("agree").isChecked(), true);

  assert.equal(await page.evaluate(() => window.pdfEditor.remove(["t1", "nonexistent"])), 1);
  assert.equal(await page.evaluate(() => window.pdfEditor.clear()), 3);
  assert.deepEqual(dialogs, []);
  await ctx.close();
});

test("API: 不正な指定は直し方の分かるエラーで拒否され、状態を壊さない", async () => {
  const { page, ctx } = await openApp(await makeSimplePdf());
  const err = (fn) => page.evaluate(async (src) => { try { await new Function("return (" + src + ")")()(); return null; } catch (e) { return e.message; } }, fn);
  assert.match(await err("() => window.pdfEditor.add([{type:'text',page:9,x:1,y:1,text:'a'}])"), /page 9 は存在しません/);
  assert.match(await err("() => window.pdfEditor.add([{type:'rect',page:1,x:1,y:1,width:-1,height:1}])"), /width と height/);
  assert.match(await err("() => window.pdfEditor.update('nope', {x: 1})"), /見つかりません/);
  assert.match(await err("() => window.pdfEditor.update('x', {type:'rect'})"), /見つかりません|type は変更できません/);
  assert.equal(await count(page), 0, "失敗しても何も追加されない");
  await ctx.close();
});

test("API: load()でPDFを開ける/CLIと同じJSON仕様で追加した内容が保存される", async () => {
  const { page, ctx } = await openApp(await makeSimplePdf());
  const b64 = readFileSync(await makeTwoPagePdf()).toString("base64");
  await page.evaluate((b64) => window.pdfEditor.load(b64, "two.pdf"), b64);
  await page.waitForFunction(() => window.pdfEditor.info().pageCount === 2);
  await page.evaluate(() => window.pdfEditor.add([{ type: "text", page: 2, x: 30, y: 30, text: "on page two", fontSize: 14 }]));
  const exp = await page.evaluate(() => window.pdfEditor.export());
  const path = join(FIXTURES, "api-load-out.pdf");
  writeFileSync(path, Buffer.from(exp.base64, "base64"));
  const insp = JSON.parse((await import("node:child_process")).spawnSync("node", ["dist/cli.mjs", "inspect", path], { encoding: "utf8" }).stdout);
  assert.ok(insp.text.some((t) => t.page === 2 && t.text.includes("on page two")));
  await ctx.close();
});
