// 仕様書(docs/SPEC.md)とソースコードの差分を検査する。
//  1. SPEC.md の「ソース構成」に載っているファイルが実在する
//  2. src/ と cli/ の全 .ts が「ソース構成」に載っている
//  3. SPEC.md の「画面要素」に載っているid が index.html に存在し、index.html の主要idが漏れなく載っている
//  4. SPEC.md の「CLIコマンド」が cli/main.ts の実装と一致する
import { readFileSync, readdirSync, existsSync } from "node:fs";

const spec = readFileSync("docs/SPEC.md", "utf8");
const html = readFileSync("index.html", "utf8");
const cli = readFileSync("cli/main.ts", "utf8");
const errors = [];

const section = (title) => {
  const m = spec.match(new RegExp(`^## ${title}[^\\n]*\\n([\\s\\S]*?)(?=^## |$(?![\\s\\S]))`, "m"));
  if (!m) errors.push(`SPEC.md に「## ${title}」セクションがありません`);
  return m ? m[1] : "";
};
const ticks = (text) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

// 1, 2: ソース構成
const listed = new Set(ticks(section("ソース構成")).filter((t) => /^(src|cli)\/.+\.ts$/.test(t)));
for (const f of listed) if (!existsSync(f)) errors.push(`SPEC.md に載っているが存在しない: ${f}`);
for (const dir of ["src", "cli"])
  for (const f of readdirSync(dir).filter((n) => n.endsWith(".ts")))
    if (!listed.has(`${dir}/${f}`)) errors.push(`ソースにあるが SPEC.md「ソース構成」に未記載: ${dir}/${f}`);

// 3: 画面要素(トップバー・ダイアログのボタン/入力のid)
const htmlIds = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
const specIds = new Set(ticks(section("画面要素")).filter((t) => t.startsWith("#")).map((t) => t.slice(1)));
for (const id of specIds) if (!htmlIds.has(id)) errors.push(`SPEC.md の #${id} が index.html に存在しません`);
for (const id of htmlIds)
  if (/^(merge-|align-|save-btn|file-input|toggle-form-panel|edit-mode-toggle)/.test(id) && !specIds.has(id))
    errors.push(`index.html の #${id} が SPEC.md「画面要素」に未記載です`);

// 4: CLI
const specCmds = new Set(ticks(section("CLIコマンド")).filter((t) => /^[a-z]+$/.test(t)));
const codeCmds = new Set([...cli.matchAll(/cmd === "([a-z]+)"/g)].map((m) => m[1]));
for (const c of codeCmds) if (!specCmds.has(c)) errors.push(`CLIコマンド ${c} が SPEC.md に未記載です`);
for (const c of specCmds) if (!codeCmds.has(c)) errors.push(`SPEC.md のCLIコマンド ${c} が cli/main.ts に存在しません`);

if (errors.length) {
  console.error("仕様書とソースに差分があります:\n" + errors.map((e) => " - " + e).join("\n"));
  console.error("→ docs/SPEC.md を更新してください。");
  process.exit(1);
}
console.log("仕様書とソースの整合性: OK");
