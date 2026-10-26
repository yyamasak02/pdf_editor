# 開発ルール(必ず守ること)

このリポジトリの作業ルール。`.githooks/` と `.claude/settings.json` のフックで機械的にも強制している。

1. **作業ブランチ単位で修正する**: `main` で直接コミットしない。作業ごとに `feat/…` `fix/…` `docs/…` ブランチを切り、PR経由で `main` に取り込む。
2. **変更は毎回GitHubに反映する**: 作業の区切りごとにコミットし、作業ブランチを `git push -u origin <branch>` する。未コミット・未pushのまま作業を終えない。
3. **秘匿情報を入れない**: APIキー・トークン・パスワード・秘密鍵・`.env`・個人情報を含むファイルはコミットしない。`scripts/check-secrets.sh` がコミット時に検査する。このリポジトリはpublic。
4. **仕様書を作成・更新し、ソースとの差分を確認する**: 仕様は `docs/SPEC.md`。`src/` `cli/` `index.html` を変えたら同じコミットで仕様書も更新する。`npm run check:spec` で仕様書とソースの整合を確認する。

## 作業の流れ(ブランチ→PR→マージ)
1. `main` を最新にして作業ブランチを切る(`git switch main && git pull && git switch -c <type>/<name>`)。
2. 変更をコミットし、ブランチをpushする。
3. **作業が一区切りしたらPRを作成する**(`gh pr create --base main`)。本文に変更内容・確認結果を書き、末尾に `🤖 Generated with [Claude Code](https://claude.com/claude-code)` を付ける。PRのURLをユーザーに伝える。
4. **マージ**
   - ユーザーがプロンプトで「マージして」と言ったら、そのPRをマージする: `gh pr merge <番号> --squash --delete-branch` のあと `git switch main && git pull`。
   - **軽微な修正は、PR作成後すぐにマージしてよい**。軽微とは次をすべて満たすもの: 誤字・文言・コメント・ドキュメントの修正など動作が変わらない / 差分が小さい(目安30行以内)/ typecheck・test・check:spec が通っている / フック・設定・依存関係・セキュリティに関わらない。
   - 上記に当てはまらない変更(機能追加、挙動の変更、フック/設定/依存の変更など)は、PRを作ったところで止めてユーザーの指示を待つ。迷ったら軽微とみなさない。
   - マージしたら、その旨(PR番号・方式)をユーザーに報告する。

## コミット前の確認
`npm run typecheck && npm test && npm run check:spec`

## 初回セットアップ
`npm install` で `core.hooksPath=.githooks` が自動設定される(`npm run prepare` でも可)。

## フックを回避する場合
正当な理由があるときだけ、ユーザーに確認してから: `ALLOW_MAIN=1`(main直コミット)、`SKIP_SPEC=1`(仕様書更新不要の変更)。`--no-verify` は使わない。
