# 開発ルール(必ず守ること)

このリポジトリの作業ルール。`.githooks/` と `.claude/settings.json` のフックで機械的にも強制している。

1. **作業ブランチ単位で修正する**: `main` で直接コミットしない。作業ごとに `feat/…` `fix/…` `docs/…` ブランチを切り、PR経由で `main` に取り込む。
2. **変更は毎回GitHubに反映する**: 作業の区切りごとにコミットし、作業ブランチを `git push -u origin <branch>` する。未コミット・未pushのまま作業を終えない。
3. **秘匿情報を入れない**: APIキー・トークン・パスワード・秘密鍵・`.env`・個人情報を含むファイルはコミットしない。`scripts/check-secrets.sh` がコミット時に検査する。このリポジトリはpublic。
4. **仕様書を作成・更新し、ソースとの差分を確認する**: 仕様は `docs/SPEC.md`。`src/` `cli/` `index.html` を変えたら同じコミットで仕様書も更新する。`npm run check:spec` で仕様書とソースの整合を確認する。

## コミット前の確認
`npm run typecheck && npm test && npm run check:spec`

## 初回セットアップ
`npm install` で `core.hooksPath=.githooks` が自動設定される(`npm run prepare` でも可)。

## フックを回避する場合
正当な理由があるときだけ、ユーザーに確認してから: `ALLOW_MAIN=1`(main直コミット)、`SKIP_SPEC=1`(仕様書更新不要の変更)。`--no-verify` は使わない。
