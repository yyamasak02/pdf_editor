#!/usr/bin/env bash
# Claude Code の Stop フック: 未コミット/未pushの変更があれば、反映してから終了するよう促す。
cd "${CLAUDE_PROJECT_DIR:-.}" || exit 0
input=$(cat)
echo "$input" | grep -q '"stop_hook_active": *true' && exit 0   # 無限ループ防止
git rev-parse --git-dir >/dev/null 2>&1 || exit 0

msg=""
branch=$(git symbolic-ref --short -q HEAD || echo "")
[ -n "$(git status --porcelain)" ] && msg+="未コミットの変更があります。"
if git rev-parse --abbrev-ref '@{u}' >/dev/null 2>&1; then
  [ -n "$(git log '@{u}..HEAD' --oneline)" ] && msg+="未pushのコミットがあります。"
elif [ -n "$branch" ] && [ -n "$(git log --oneline -1 2>/dev/null)" ]; then
  msg+="ブランチ $branch は未pushです。"
fi
[ -z "$msg" ] && exit 0
{
  echo "$msg CLAUDE.md のルールに従い、作業ブランチ(mainは不可)でコミット→pushしてください。"
  echo "コミット前に npm run typecheck / npm test / npm run check:spec を実行し、docs/SPEC.md を更新済みか確認すること。"
} >&2
exit 2
