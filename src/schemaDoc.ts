// `pdf-edit schema` と README が出す、編集JSONの説明(AIにそのまま渡せる形)。
export const SCHEMA_DOC = JSON.stringify(
  {
    description:
      "PDFへ足す要素(items)とフォーム入力(form)を指定するJSON。座標の単位はpt、原点はページ左上でyは下向き。pageは1始まり。色は #rrggbb。",
    workflow: [
      "1. pdf-edit inspect in.pdf で、ページ寸法・フォーム項目・既存テキストの位置(x,y,width,height)を確認する",
      "2. 位置を決めて edit.json を書く(既存テキストの近くに置くときは、そのtextのx,y,heightを基準にする)",
      "3. pdf-edit apply in.pdf edit.json -o out.pdf",
      "4. 必要なら out.pdf を inspect し直して結果を確認する",
    ],
    items: {
      text: { type: "text", page: 1, x: 72, y: 100, text: "こんにちは\nHello", fontSize: 14, color: "#000000", bold: false, italic: false, align: "left|center|right", width: "折り返し幅(省略で折り返さない)", lineHeight: 1.2, background: "#ffff00(省略可)", rotation: 0, opacity: 1 },
      rect: { type: "rect", page: 1, x: 50, y: 50, width: 200, height: 60, stroke: "#ff0000", strokeWidth: 2, fill: "#ffff00(省略で塗らない)" },
      ellipse: { type: "ellipse", page: 1, x: 50, y: 50, width: 120, height: 80, stroke: "#0000ff", strokeWidth: 2 },
      line: { type: "line", page: 1, x: 50, y: 50, x2: 250, y2: 50, stroke: "#000000", strokeWidth: 1 },
      image: { type: "image", page: 1, x: 50, y: 50, width: 100, height: 40, path: "stamp.png(CLIのみ)", src: "data:image/png;base64,...(どこでも可)" },
      common: { rotation: "左上を中心に時計回りの度数", opacity: "0〜1", id: "後でupdate/removeするための名前(ブラウザAPI用)" },
    },
    form: { "項目名": "文字列(テキスト/ドロップダウン/ラジオ) | true/false(チェックボックス) | [文字列](リスト)" },
    flatten: "true でフォームを確定(以後編集不可)",
    example: {
      items: [
        { type: "text", page: 1, x: 100, y: 120, text: "山田 太郎", fontSize: 14 },
        { type: "rect", page: 1, x: 95, y: 115, width: 120, height: 24, stroke: "#ff0000", strokeWidth: 1 },
      ],
      form: { name: "山田 太郎", agree: true },
    },
    notes: ["日本語は自動でNoto Sans JPを埋め込む", "暗号化(空パスワード)PDFは復号して保存する", "CLIは注釈を焼き込む(再編集用データは付けない)"],
  },
  null,
  2
);
