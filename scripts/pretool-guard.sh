#!/usr/bin/env bash
# Claude Code の PreToolUse(Bash) フック: フック回避や main への直接操作を止める。
cmd=$(cat | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{console.log(JSON.parse(s).tool_input.command||"")}catch{console.log("")}})')
deny() { echo "$1" >&2; exit 2; }

echo "$cmd" | grep -qE 'git +(commit|push)[^|;&]*--no-verify' && deny "--no-verify は禁止です(CLAUDE.mdのルール)。"
echo "$cmd" | grep -qE 'git +push[^|;&]*( |:)(main|master)( |$)' && deny "main への直接pushは禁止です。作業ブランチをpushしてください。"
echo "$cmd" | grep -qE 'git +push[^|;&]*(--force|-f)( |$)' && deny "force push は禁止です。"
exit 0
