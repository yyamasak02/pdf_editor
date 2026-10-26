#!/usr/bin/env bash
# ステージ済みの変更に秘匿情報が含まれていないか検査する。見つかれば終了コード1。
set -u
fail=0

# 1) 危険なファイル名
while IFS= read -r f; do
  case "$f" in
    .env|.env.*|*/.env|*/.env.*|*.pem|*.key|*.p12|*.pfx|id_rsa*|*credentials*.json|*.keystore)
      echo "秘匿情報の可能性があるファイル: $f" >&2; fail=1 ;;
  esac
done < <(git diff --cached --name-only --diff-filter=ACM)

# 2) 追加行に含まれる秘密らしい文字列
patterns='-----BEGIN [A-Z ]*PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9_-]{20,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|(password|passwd|secret|api[_-]?key|access[_-]?token)["'"'"' ]*[:=]["'"'"' ]*[A-Za-z0-9/+_-]{8,}'
hits=$(git diff --cached -U0 --diff-filter=ACM -- . ':(exclude)package-lock.json' ':(exclude)dist' ':(exclude)scripts/check-secrets.sh' \
  | grep -E '^\+[^+]' | grep -Eni -e "$patterns" || true)
if [ -n "$hits" ]; then
  echo "秘匿情報らしい文字列が追加されています:" >&2
  echo "$hits" | cut -c1-160 >&2
  fail=1
fi
[ $fail -eq 0 ] || echo "→ 秘匿情報を取り除いてから再度コミットしてください。" >&2
exit $fail
