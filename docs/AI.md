# AIからPDFを編集する

人が画面で操作するのと同じ結果を、**JSONで指示するだけ**で得られます。入口は2つあり、どちらも同じ仕様(`src/spec.ts`)を使います。

| | 何ができる | 使いどころ |
|---|---|---|
| **CLI** `node dist/cli.mjs` | ブラウザ不要。PDFに注釈を焼き込んで保存 | AI/スクリプトが完結させる |
| **ページ内API** `window.pdfEditor` | 開いているアプリに要素を足す・動かす・消す | 人が画面を見ながらAIと共同作業 |

`npm run build` の後に使えます。

## 流れ(CLI)

```bash
node dist/cli.mjs schema                      # 仕様(JSON)を出力。AIに渡せる
node dist/cli.mjs inspect in.pdf              # ページ寸法・フォーム項目・既存テキストの位置
node dist/cli.mjs apply in.pdf edit.json -o out.pdf
```

- 座標は **pt、原点は左上、yは下向き**。`inspect` の `text[].x/y/width/height` と同じ座標系なので、「この文字の右隣」などをそのまま計算できます。
- 出力はすべてJSON。失敗時は `{"error": "..."}` と終了コード1(直し方が分かるメッセージ)。
- 日本語は自動で Noto Sans JP を埋め込みます。暗号化(空パスワード)PDFは復号して保存します。

```json
{
  "items": [
    { "type": "text", "page": 1, "x": 100, "y": 120, "text": "山田 太郎", "fontSize": 14 },
    { "type": "rect", "page": 1, "x": 95, "y": 115, "width": 120, "height": 24, "stroke": "#ff0000" }
  ],
  "form": { "name": "山田 太郎", "agree": true }
}
```

要素の種類: `text` / `rect` / `ellipse` / `line` / `image`。共通で `rotation`(度)・`opacity`(0〜1)・`id` が使えます。詳細は `schema` の出力を参照してください。

## ページ内API(ブラウザ)

アプリでPDFを開いた状態で、コンソールや Playwright の `page.evaluate` から使います。

```js
pdfEditor.info()                         // ページ寸法・フォーム項目
await pdfEditor.list()                   // 置かれている要素(id付き)
await pdfEditor.add([{ type: "text", page: 1, x: 40, y: 40, text: "追記", id: "memo" }])
await pdfEditor.update("memo", { x: 100, text: "修正" })   // 部分更新(重なり順は保たれる)
pdfEditor.remove("memo");  pdfEditor.clear(1)
pdfEditor.setForm({ name: "山田 太郎" })  // 入力欄とページ表示も更新
const { base64 } = await pdfEditor.export()  // 保存結果(ダウンロードはしない)
await pdfEditor.load(base64)             // PDFを開く
```

## 画面操作(人向け)

- Ctrl+C / X / V: コピー・切り取り・貼り付け(別ページにも貼れる)、Ctrl+D: 複製、Ctrl+A: 全選択、Delete: 削除、矢印: 1px(Shiftで10px)移動
- 選択すると右の「プロパティ」で、位置・サイズ・回転・不透明度・文字(サイズ/太字/斜体/揃え/色/背景)・線と塗り・重なり順を数値や色で設定できます(単位はpt)。
- 「編集モード」をOFFにすると閲覧専用(枠線・操作なし)。フォーム入力はOFFのままでも可能です。

## テスト

```bash
npm test            # 単体(jsdom)
npm run test:cli    # CLI
npm run test:e2e    # 実ブラウザ(Chromium)
```
