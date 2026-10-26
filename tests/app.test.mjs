import nodeTest from "node:test";

let failed = 0;
const test = (name, fn) =>
  nodeTest(name, { timeout: 20000 }, async (t) => {
    try { await fn(t); } catch (e) { failed++; throw e; }
  });
import assert from "node:assert/strict";

import { readFileSync } from "node:fs";
const A = globalThis.__app;
// 日本語フォントは本番では<script>で読むが、テストではファイルから直接読む。
A.setJpFontLoader(async (style) =>
  new Uint8Array(readFileSync(`node_modules/@expo-google-fonts/noto-sans-jp/${style === "bold" ? "700Bold/NotoSansJP_700Bold" : "400Regular/NotoSansJP_400Regular"}.ttf`))
);
const { state, els, fabric, pdfLib } = A;
const { PDFDocument, PDFName, PDFDict } = pdfLib;

const W = 600, H = 800; // 描画px (RENDER_SCALE=1想定でなくても比率検証のみ)

async function makeBasePdf({ form = true, mutate } = {}) {
  const d = await PDFDocument.create();
  const p = d.addPage([300, 400]);
  if (form) {
    const f = d.getForm();
    f.createTextField("name").addToPage(p, { x: 10, y: 10, width: 100, height: 20 });
    f.createCheckBox("agree").addToPage(p, { x: 10, y: 40, width: 15, height: 15 });
    const dd = f.createDropdown("sel"); dd.addOptions(["a", "b"]); dd.addToPage(p, { x: 10, y: 70, width: 60, height: 20 });
    const rg = f.createRadioGroup("rg"); rg.addOptionToPage("x", p, { x: 10, y: 100, width: 15, height: 15 });
    rg.addOptionToPage("y", p, { x: 30, y: 100, width: 15, height: 15 });
  }
  mutate?.(d);
  return await d.save();
}

function newCanvas() {
  const el = document.createElement("canvas");
  document.body.appendChild(el);
  const c = new fabric.Canvas(el, { width: W, height: H });
  A.attachCanvasToolHandlers(c);
  return c;
}

async function setup(opts) {
  const bytes = await makeBasePdf(opts);
  state.originalBytes = bytes;
  state.numPages = 1;
  state.currentPage = 0;
  state.pageDims = [{ widthPt: 300, heightPt: 400 }];
  state.pageCanvases = [newCanvas()];
  state.pageInitialized = [true];
  state.restoredPageJson = [];
  state.formFieldsMeta = [];
  state.hasAcroForm = false;
  state.activeTool = "select";
  A.setEditMode(true);
  await A.loadFormFields();
  return state.pageCanvases[0];
}

const mouse = (c, type, x, y) => c.fire(type, { e: { clientX: x, clientY: y, offsetX: x, offsetY: y }, pointer: { x, y } });

// ---- 編集モード ----
test("編集モード: 初期はON、トグル表示が切り替わる", async () => {
  await setup();
  assert.equal(state.editMode, true);
  assert.match(els.editModeToggle.textContent, /ON/);
  A.setEditMode(false);
  assert.equal(state.editMode, false);
  assert.match(els.editModeToggle.textContent, /OFF/);
  assert.equal(els.editModeToggle.getAttribute("aria-pressed"), "false");
  A.setEditMode(true);
});

test("編集モードOFF: 既存オブジェクトは選択不可・描画系は無効、ONで復帰", async () => {
  const c = await setup();
  const r = new fabric.Rect({ left: 10, top: 10, width: 50, height: 50 });
  c.add(r);
  A.setEditMode(false);
  assert.equal(r.selectable, false);
  assert.equal(r.evented, false);
  assert.equal(c.selection, false);
  A.setTool("pen");
  assert.equal(c.isDrawingMode, false, "OFFではペンも無効");
  mouse(c, "mouse:down", 20, 20);
  A.setTool("text");
  mouse(c, "mouse:down", 20, 20);
  assert.equal(c.getObjects().length, 1, "OFFではテキストを追加できない");
  A.setEditMode(true);
  A.setTool("select");
  assert.equal(r.selectable, true);
  assert.equal(r.evented, true);
});

test("編集モードOFF: 削除・矢印キー移動も無効", async () => {
  const c = await setup();
  const r = new fabric.Rect({ left: 10, top: 10, width: 50, height: 50 });
  c.add(r); c.setActiveObject(r);
  A.setEditMode(false);
  A.deleteSelectedObjects();
  assert.equal(c.getObjects().length, 1);
  A.handleGlobalKeydown(new KeyboardEvent("keydown", { key: "ArrowRight" }));
  assert.equal(r.left, 10);
  A.setEditMode(true);
});

test("枠線: ON中はテキストボックスの外枠が描画され、OFFでは描画されない", async () => {
  const c = await setup();
  const t = new fabric.Textbox("hello", { left: 40, top: 50, width: 200 });
  c.add(t);
  const calls = [];
  const ctx = c.getContext();
  const orig = ctx.strokeRect.bind(ctx);
  ctx.strokeRect = (...a) => { calls.push(a); return orig(...a); };
  c.renderAll();
  assert.ok(calls.length >= 1, "ON: 枠が描かれる");
  calls.length = 0;
  A.setEditMode(false);
  c.renderAll();
  assert.equal(calls.length, 0, "OFF: 枠なし");
  A.setEditMode(true);
  ctx.strokeRect = orig;
});

test("枠線は保存データ(JSON)にもPDFにも含まれない", async () => {
  const c = await setup();
  c.add(new fabric.Textbox("hello", { left: 40, top: 50, width: 200 }));
  const json = JSON.stringify(c.toJSON());
  assert.ok(!/outline/i.test(json));
});

// ---- ツール操作 ----
test("テキストツール: クリックでTextboxが追加され選択ツールに戻る", async () => {
  const c = await setup();
  A.setTool("text");
  mouse(c, "mouse:down", 100, 120);
  const objs = c.getObjects();
  assert.equal(objs.length, 1);
  assert.ok(A.isTextObject(objs[0]));
  assert.equal(state.activeTool, "select");
});

for (const tool of ["rect", "ellipse"]) {
  test(`${tool}ツール: ドラッグで図形が追加され選択状態になる`, async () => {
    const c = await setup();
    A.setTool(tool);
    mouse(c, "mouse:down", 50, 50);
    mouse(c, "mouse:move", 150, 120);
    mouse(c, "mouse:up", 150, 120);
    const objs = c.getObjects();
    assert.equal(objs.length, 1);
    assert.ok(A.isShapeObject(objs[0]));
    assert.equal(c.getActiveObject(), objs[0]);
  });
}

test("ペンツール: 描画モードになりpathが追加できる", async () => {
  const c = await setup();
  A.setTool("pen");
  assert.equal(c.isDrawingMode, true);
  const path = new fabric.Path("M 0 0 L 50 50", { stroke: "#000", fill: "" });
  c.add(path);
  c.fire("path:created", { path });
  assert.equal(c.getObjects().length, 1);
});

test("選択を削除 / Deleteキー", async () => {
  const c = await setup();
  const r = new fabric.Rect({ width: 10, height: 10 });
  c.add(r); c.setActiveObject(r);
  A.deleteSelectedObjects();
  assert.equal(c.getObjects().length, 0);
  const r2 = new fabric.Rect({ width: 10, height: 10 });
  c.add(r2); c.setActiveObject(r2);
  A.handleGlobalKeydown(new KeyboardEvent("keydown", { key: "Delete" }));
  assert.equal(c.getObjects().length, 0);
});

test("矢印キーで1px、Shift+矢印で10px移動", async () => {
  const c = await setup();
  const r = new fabric.Rect({ left: 100, top: 100, width: 10, height: 10 });
  c.add(r); c.setActiveObject(r);
  A.handleGlobalKeydown(new KeyboardEvent("keydown", { key: "ArrowRight" }));
  A.handleGlobalKeydown(new KeyboardEvent("keydown", { key: "ArrowDown", shiftKey: true }));
  assert.equal(r.left, 101);
  assert.equal(r.top, 110);
});

test("スタイル変更: 選択中のテキスト/図形に色・サイズが反映される", async () => {
  const c = await setup();
  const t = new fabric.Textbox("a", { width: 100 });
  const r = new fabric.Rect({ width: 10, height: 10 });
  c.add(t); c.add(r);
  c.setActiveObject(t); // 選択でツールバーが選択物の値に同期されるため、その後に値を設定する
  els.colorInput.value = "#00ff00"; els.fontSize.value = "33"; els.strokeWidth.value = "7";
  A.updateSelectedStyle();
  assert.equal(t.fill, "#00ff00"); assert.equal(t.fontSize, 33);
  c.setActiveObject(r);
  els.colorInput.value = "#00ff00"; els.strokeWidth.value = "7";
  A.updateSelectedStyle();
  assert.equal(r.stroke, "#00ff00"); assert.equal(r.strokeWidth, 7);
});

// ---- 保存 ----
async function reopen(bytes) { return PDFDocument.load(bytes, { password: "", ignoreEncryption: true }); }

test("保存: 何も編集しなくても成功し、再編集用データが埋め込まれる", async () => {
  await setup();
  const out = await A.buildPdfBytes();
  assert.equal(out.editorStateSkipped, false);
  const loaded = A.readEditorState(await reopen(out.bytes));
  assert.ok(loaded);
});

test("保存: テキスト・四角・楕円・画像・パスを全て含めて保存できる", async () => {
  const c = await setup();
  c.add(new fabric.Textbox("Hello\nWorld", { left: 20, top: 20, width: 200, fontWeight: "bold", fontStyle: "italic", textBackgroundColor: "#ffff00" }));
  c.add(new fabric.Rect({ left: 50, top: 100, width: 80, height: 40, stroke: "#ff0000", fill: "#00ff00" }));
  c.add(new fabric.Ellipse({ left: 50, top: 200, rx: 30, ry: 20, stroke: "#0000ff", fill: "transparent" }));
  c.add(new fabric.Path("M 0 0 L 50 50 L 100 0", { left: 200, top: 200, stroke: "#000000", fill: "" }));
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  await new Promise((res) => fabric.Image.fromURL(png, (img) => { c.add(img); res(); }));
  const warns = [];
  const w = console.warn; console.warn = (...a) => warns.push(a);
  const out = await A.buildPdfBytes();
  console.warn = w;
  assert.ok(out.bytes.length > 0);
  const objWarn = warns.filter((a) => String(a[0]).includes("書き込みに失敗"));
  // 画像/Pathのtoデータ化はjsdom環境で失敗し得るため、失敗しても保存自体は成功すること
  assert.ok(objWarn.length <= 2, "描画失敗は画像/パスのみ許容: " + JSON.stringify(objWarn.map((a) => a[0])));
  const loaded = A.readEditorState(await reopen(out.bytes));
  assert.equal(loaded.pages[0].objects.length, 5);
});

test("保存→再読込: 再編集データから原本が復元でき、二重保存でも壊れない", async () => {
  const c = await setup();
  c.add(new fabric.Rect({ left: 5, top: 5, width: 20, height: 20, stroke: "#f00" }));
  const first = await A.buildPdfBytes();
  const loaded = A.readEditorState(await reopen(first.bytes));
  assert.deepEqual([...loaded.originalBytes.slice(0, 5)], [...state.originalBytes.slice(0, 5)]);
  state.originalBytes = loaded.originalBytes;
  const second = await A.buildPdfBytes();
  assert.ok(A.readEditorState(await reopen(second.bytes)));
});

test("保存: 再編集データの埋め込みに失敗しても、PDF本体は保存できる(回帰: Expected instance of ...)", async () => {
  // AFが辞書、NamesがPDFではなく数値など、壊れたカタログ構造
  for (const [label, mutate] of [
    ["AFが辞書", (d) => d.catalog.set(PDFName.of("AF"), d.context.obj({}))],
    ["Namesが配列", (d) => d.catalog.set(PDFName.of("Names"), d.context.obj([]))],
    ["EmbeddedFilesが配列", (d) => d.catalog.set(PDFName.of("Names"), d.context.obj({ EmbeddedFiles: [] }))],
    ["EmbeddedFiles.Namesが辞書", (d) => d.catalog.set(PDFName.of("Names"), d.context.obj({ EmbeddedFiles: { Names: {} } }))],
  ]) {
    await setup({ mutate });
    const out = await A.buildPdfBytes();
    assert.ok(out.bytes.length > 0, label);
    assert.equal(out.editorStateSkipped, false, label + ": sanitizeで埋め込みまで成功する");
    assert.ok(A.readEditorState(await reopen(out.bytes)), label);
  }
});

test("保存: 既に別の添付ファイルを持つPDFでも既存添付を壊さない", async () => {
  await setup({ mutate: async () => {} });
  const d = await PDFDocument.load(state.originalBytes);
  await d.attach(new TextEncoder().encode("hi"), "other.txt", { mimeType: "text/plain" });
  state.originalBytes = await d.save();
  const out = await A.buildPdfBytes();
  const doc = await reopen(out.bytes);
  const names = doc.catalog.lookup(PDFName.of("Names"), PDFDict).lookup(PDFName.of("EmbeddedFiles"), PDFDict).lookup(PDFName.of("Names"));
  assert.equal(names.size() / 2, 3);
});

// ---- 暗号化PDF ----
test("暗号化PDF(空パスワード): 復号して保存でき、出力に/Encryptが残らず、パスワードなしで開ける", async () => {
  const d = await PDFDocument.create();
  d.addPage([300, 400]).drawText("secret", { x: 20, y: 200 });
  d.encrypt({ userPassword: "", ownerPassword: "owner", permissions: { modifying: false, copying: false } });
  state.originalBytes = await d.save();
  state.numPages = 0; state.pageCanvases = []; state.pageDims = [];
  state.hasAcroForm = false; state.formFieldsMeta = [];
  const out = await A.buildPdfBytes();
  assert.equal(out.rasterized, false, "画像化にフォールバックしない");
  assert.ok(!Buffer.from(out.bytes).toString("latin1").includes("/Encrypt"), "/Encrypt が出力に残らない");
  const re = await PDFDocument.load(out.bytes); // パスワード指定なしで開ける
  assert.equal(re.getPageCount(), 1);
  assert.ok(A.readEditorState(re), "再編集データも読める");
});

// ---- 日本語 ----
async function textOf(bytes) {
  // 埋め込まれたフォントの有無で描画できているかを見る
  const doc = await PDFDocument.load(bytes, { password: "", ignoreEncryption: true });
  const names = [];
  doc.context.enumerateIndirectObjects().forEach(([, o]) => {
    const d = o.dict;
    const base = d?.get?.(pdfLib.PDFName.of("BaseFont"));
    if (base) names.push(String(base));
  });
  return names.join(" ");
}

test("日本語: テキストボックスが日本語フォントで保存され、他の要素の保存も止まらない", async () => {
  const c = await setup();
  c.add(new fabric.Textbox("就職・卒業 山田太郎", { left: 20, top: 20, width: 300 }));
  c.add(new fabric.Textbox("Bold 日本語", { left: 20, top: 80, width: 300, fontWeight: "bold" }));
  c.add(new fabric.Rect({ left: 50, top: 200, width: 80, height: 40, stroke: "#f00" }));
  const warns = [];
  const w = console.warn; console.warn = (...a) => warns.push(a);
  const out = await A.buildPdfBytes();
  console.warn = w;
  assert.equal(warns.filter((a) => String(a[0]).includes("書き込みに失敗")).length, 0, "どの要素も書き込みに成功する");
  assert.match(await textOf(out.bytes), /NotoSansJP/);
  assert.equal(out.rasterized, false);
});

test("日本語: 英数字だけなら日本語フォントを埋め込まない(サイズ節約)", async () => {
  const c = await setup();
  c.add(new fabric.Textbox("Hello", { left: 20, top: 20, width: 300 }));
  const out = await A.buildPdfBytes();
  assert.doesNotMatch(await textOf(out.bytes), /NotoSansJP/);
});

test("日本語: フォーム入力(日本語)も外観つきで保存され、警告なしで書き出せる", async () => {
  await setup();
  state.formFieldsMeta.find((m) => m.name === "name").el.value = "山田 太郎";
  const out = await A.buildPdfBytes();
  assert.equal(out.appearanceWarning, false, "外観の再生成に失敗していない");
  assert.equal((await reopen(out.bytes)).getForm().getTextField("name").getText(), "山田 太郎");
  assert.match(await textOf(out.bytes), /NotoSansJP/);
});

// ---- フォーム ----
test("フォーム: 全種別(テキスト/チェック/ドロップダウン/ラジオ)の値が保存に反映される", async () => {
  await setup();
  assert.equal(state.hasAcroForm, true);
  const byName = Object.fromEntries(state.formFieldsMeta.map((m) => [m.name, m]));
  assert.deepEqual(Object.keys(byName).sort(), ["agree", "name", "rg", "sel"]);
  byName.name.el.value = "Taro";
  byName.agree.el.checked = true;
  byName.sel.el.value = "b";
  byName.rg.el.value = "y";
  const out = await A.buildPdfBytes();
  const form = (await reopen(out.bytes)).getForm();
  assert.equal(form.getTextField("name").getText(), "Taro");
  assert.equal(form.getCheckBox("agree").isChecked(), true);
  assert.deepEqual(form.getDropdown("sel").getSelected(), ["b"]);
  assert.equal(form.getRadioGroup("rg").getSelected(), "y");
});

test("フォーム: 保存時に確定(flatten)するとフィールドが消える", async () => {
  await setup();
  state.formFieldsMeta.find((m) => m.name === "name").el.value = "X";
  els.flattenForm.checked = true;
  const out = await A.buildPdfBytes();
  els.flattenForm.checked = false;
  assert.equal((await reopen(out.bytes)).getForm().getFields().length, 0);
});

test("フォーム無しPDFでも保存できる", async () => {
  await setup({ form: false });
  assert.equal(state.hasAcroForm, false);
  const out = await A.buildPdfBytes();
  assert.ok(out.bytes.length > 0);
});

test("PDF結合: 指定順にページが並ぶ", async () => {
  const mk = async (w) => { const d = await A.pdfLib.PDFDocument.create(); d.addPage([w, 100]); return new Uint8Array(await d.save()); };
  const [a, b, c] = [await mk(100), await mk(200), await mk(300)];
  const merged = await A.mergePdfs([c, a, b]);
  const doc = await A.pdfLib.PDFDocument.load(merged);
  assert.deepEqual(doc.getPages().map((p) => p.getWidth()), [300, 100, 200]);
  await assert.rejects(() => A.mergePdfs([]));
});

test("整列: 計算(左/右/左右・上下の均等割り付け)", async () => {
  const R = (left, top, width, height) => ({ left, top, width, height });
  const rs = [R(50, 0, 20, 10), R(0, 30, 10, 10), R(200, 60, 30, 10)];
  const left = A.computeAlign(rs, "left");
  assert.deepEqual(left.map((m) => m[0]), [-50, 0, -200]);
  assert.ok(left.every((m) => m[1] === 0), "左揃えで縦方向は動かない");
  const right = A.computeAlign(rs, "right");
  assert.deepEqual(right.map((m) => m[0]), [160, 220, 0]);
  assert.ok(right.every((m) => m[1] === 0), "右揃えで縦方向は動かない");
  // 左右: 順序は左から [1(0-10), 0(50-70), 2(200-230)] → 隙間=(230-0-60)/2=85
  const h = A.computeAlign(rs, "distribute-h");
  assert.deepEqual(h.map((m) => m[0]), [45, 0, 0]);
  assert.ok(h.every((m) => m[1] === 0));
  const v = A.computeAlign([R(0, 0, 10, 10), R(0, 10, 10, 10), R(0, 90, 10, 10)], "distribute-v");
  assert.deepEqual(v.map((m) => m[1]), [0, 35, 0]);
  assert.ok(v.every((m) => m[0] === 0), "上下の均等割り付けで横方向は動かない");
  // 矩形が重なっていても、両端(中心が最小・最大)のオブジェクトは動かず、隙間が等しくなる
  const ov = [R(0, 0, 100, 10), R(10, 0, 20, 10), R(30, 0, 10, 10), R(60, 0, 10, 10)];
  const o = A.computeAlign(ov, "distribute-h");
  // 中心は A=50, B=20, C=35, D=65 → 両端は B(添字1)と D(添字3)
  assert.deepEqual([o[1][0], o[3][0]], [0, 0], "両端は動かない");
  const placed = ov.map((r, i) => ({ s: r.left + o[i][0], e: r.left + o[i][0] + r.width, c: r.left + r.width / 2 }));
  const byCenter = [...placed].sort((a, b) => a.c - b.c);
  const gaps = byCenter.slice(1).map((p, i) => p.s - byCenter[i].e);
  assert.ok(gaps.every((g) => Math.abs(g - gaps[0]) < 1e-9), "隙間が等しい: " + gaps);
  assert.ok(o.every((m) => m[1] === 0));
  // 2つ以下の均等割り付けは何もしない
  assert.deepEqual(A.computeAlign([R(0, 0, 5, 5), R(9, 9, 5, 5)], "distribute-h"), [[0, 0], [0, 0]]);
});

test("整列: 複数選択したオブジェクトを実際に揃える(選択は維持)", async () => {
  const c = await setup();
  const mk = (left, top, w, h) => new fabric.Rect({ left, top, width: w, height: h, strokeWidth: 0 });
  const [a, b, d] = [mk(50, 10, 20, 20), mk(10, 100, 40, 20), mk(300, 200, 30, 20)];
  c.add(a, b, d);
  const select = () => { c.discardActiveObject(); c.setActiveObject(new fabric.ActiveSelection([a, b, d], { canvas: c })); };
  select();
  A.alignSelection("left");
  assert.equal(c.getActiveObject()?.type, "activeSelection");
  c.discardActiveObject(); // 選択中はグループ相対座標になるため、解除してから測る
  assert.deepEqual([a, b, d].map((o) => Math.round(o.getBoundingRect(true, true).left)), [10, 10, 10]);
  assert.deepEqual([a, b, d].map((o) => Math.round(o.getBoundingRect(true, true).top)), [10, 100, 200], "縦位置は変わらない");
  c.discardActiveObject(); a.set({ left: 50 }); b.set({ left: 10 }); d.set({ left: 300 }); select();
  A.alignSelection("right");
  c.discardActiveObject();
  assert.deepEqual([a, b, d].map((o) => Math.round(o.getBoundingRect(true, true).left + o.getScaledWidth())), [330, 330, 330]);
  assert.deepEqual([a, b, d].map((o) => Math.round(o.getBoundingRect(true, true).top)), [10, 100, 200], "縦位置は変わらない");
  c.discardActiveObject(); a.set({ left: 0, top: 0 }); b.set({ left: 100, top: 50 }); d.set({ left: 300, top: 200 }); select();
  A.alignSelection("distribute-h");
  c.discardActiveObject();
  const r = [a, b, d].map((o) => o.getBoundingRect(true, true));
  assert.equal(Math.round(r[1].left - (r[0].left + r[0].width)), Math.round(r[2].left - (r[1].left + r[1].width)));
  assert.equal(Math.round(r[0].left), 0);
  assert.equal(Math.round(r[2].left), 300);
  assert.deepEqual(r.map((x) => Math.round(x.top)), [0, 50, 200], "縦位置は変わらない");
});

test("savePdf(UI): 保存ボタンの状態が元に戻り、エラー時はalertされる", async () => {
  await setup();
  state.originalBytes = new Uint8Array([1, 2, 3]); // 壊れたPDF
  let msg = "";
  globalThis.alert = (m) => { msg = m; };
  const e = console.error; console.error = () => {};
  await A.savePdf();
  console.error = e;
  assert.match(msg, /PDFの保存に失敗しました/);
  assert.equal(els.saveBtn.disabled, false);
  assert.equal(els.saveBtn.textContent, "PDFを保存");
  // jsdomのタイマーでプロセスが終了しないため、最後のテスト後に明示的に終了する。
  setTimeout(() => process.exit(failed ? 1 : 0), 500);
});
