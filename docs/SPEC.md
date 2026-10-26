# PDF編集ツール 仕様書

この仕様書はソースコードと一致させる。`npm run check:spec` で差分を検査する(コミット時にも自動実行)。ソース変更時は同じコミットで更新すること。

## 概要

ブラウザ内だけで動くPDF編集ツール。サーバー送信なし。`index.html` が `dist/app.js` を読み込む。CLI(`dist/cli.mjs`)でもJSON指示でPDFを編集できる。

## ソース構成

| ファイル | 役割 |
|---|---|
| `src/main.ts` | 初期化・イベント結線 |
| `src/state.ts` | アプリ状態 |
| `src/types.ts` | 型定義 |
| `src/dom.ts` | DOM要素の取得 |
| `src/constants.ts` | 定数 |
| `src/colors.ts` | 色変換 |
| `src/pdfView.ts` | PDF読み込み・ページ表示・ズーム |
| `src/pdfLoad.ts` | PDF読み込み共通処理(暗号化の除去) |
| `src/canvasTools.ts` | 描画ツール・選択・キー操作(fabric.js) |
| `src/propsPanel.ts` | プロパティパネル |
| `src/align.ts` | 整列・均等割り付けの計算(純粋関数) |
| `src/formFields.ts` | AcroFormの読み込み・入力欄 |
| `src/formApply.ts` | フォーム値のPDFへの反映 |
| `src/exportPdf.ts` | PDF書き出し |
| `src/persistence.ts` | 再編集用データの埋め込み・復元 |
| `src/render.ts` | 注釈のPDF描画(pdf-lib) |
| `src/fabricSpec.ts` | fabricオブジェクトとJSON仕様の相互変換 |
| `src/spec.ts` | 編集JSON仕様と検証 |
| `src/schemaDoc.ts` | `schema` コマンドの出力 |
| `src/editApi.ts` | ブラウザ用API `window.pdfEditor` |
| `src/jpFont.ts` | 日本語フォント(Noto Sans JP)の読み込み |
| `src/mergePdf.ts` | 複数PDFの結合ロジック |
| `src/mergeDialog.ts` | 結合・並べ替えダイアログ |
| `cli/main.ts` | CLI |

## 機能

### 編集
テキスト・画像・四角形・楕円・フリーハンドの追加、選択/移動/リサイズ/削除、プロパティの数値編集、コピー・貼り付け・複製、編集モードON/OFF、表示倍率変更、ページ送り。

### 整列・均等割り付け(複数選択時)
複数のオブジェクトを選択すると、プロパティパネルに「整列」が表示される(`#align-left` `#align-right` `#align-distribute-h` `#align-distribute-v`)。基準は各オブジェクトの外接矩形(回転・線幅を含む)。
- 左に整列 / 右に整列: 選択範囲の最も左 / 右の端に揃える。
- 左右に均等割り付け / 上下に均等割り付け: 両端のオブジェクトは動かさず、間の隙間が等しくなるよう並べる。3つ以上の選択で有効(2つ以下では無効)。
- 別ページのオブジェクトは同時に選択できないため、対象は常に現在のページ内。

### フォーム
AcroForm項目(テキスト・チェック・ラジオ・ドロップダウン)の入力。保存時に確定(flatten)を選べる。

### 保存と再編集
保存PDFに原本と各ページの注釈データを添付し、再度開くと編集状態を復元する。

### PDF結合・並べ替え
- ヘッダーの「PDFを結合」でダイアログを開く。
- 複数PDFを選択(追加は繰り返し可)し、↑↓ボタンまたはドラッグで並べ替え、✕で除外、クリアで全消去。
- 2ファイル以上で結合可能。上から順に全ページを1つのPDFにする(`mergePdfs`)。
- 「結合して編集を開始」: 結果をエディタで開く。「結合してダウンロード」: `merged.pdf` として保存。
- 暗号化(空パスワード)PDFも結合可能。
- 制限: 各PDFのフォーム項目と再編集データは引き継がれない(見た目のみ)。ページ単位の並べ替え・削除は未対応。

## 画面要素

| id | 内容 |
|---|---|
| `#file-input` | PDFを開く |
| `#save-btn` | PDFを保存 |
| `#toggle-form-panel` | フォーム項目パネルの開閉 |
| `#edit-mode-toggle` | 編集モード切替 |
| `#align-left` | 左に整列 |
| `#align-right` | 右に整列 |
| `#align-distribute-h` | 左右に均等割り付け |
| `#align-distribute-v` | 上下に均等割り付け |
| `#merge-btn` | 結合ダイアログを開く |
| `#merge-dialog` | 結合ダイアログ本体 |
| `#merge-input` | 結合するPDFの追加(複数選択) |
| `#merge-list` | 結合順の一覧 |
| `#merge-empty` | 未選択時の案内 |
| `#merge-status` | 状態・エラー表示 |
| `#merge-clear` | 一覧をクリア |
| `#merge-close` | ダイアログを閉じる |
| `#merge-download` | 結合してダウンロード |
| `#merge-open` | 結合してエディタで開く |

## CLIコマンド

`node dist/cli.mjs <command>`。出力は常にJSON、失敗時は `{"error": ...}` と終了コード1。

| command | 内容 |
|---|---|
| `inspect` | ページ寸法・フォーム項目・テキスト位置を出力 |
| `apply` | 編集JSONを適用して `-o` に保存 |
| `schema` | 編集JSONの仕様を出力 |

詳細は `docs/AI.md`。

## 制限事項

- 要素の回転はプロパティ/JSON指定で可能だが、UI上のハンドル回転は未対応。
- ページの追加・削除・分割は未対応。
- 保存のたびにファイルサイズが増える(原本の複製を埋め込むため)。
