// 「PDFを結合」ダイアログ: 複数PDFを選び、並べ替えて1つにまとめる。
import { mergePdfs } from "./mergePdf";
import { loadPdfFile } from "./pdfView";

interface Item {
  id: number;
  file: File;
}

let items: Item[] = [];
let nextId = 1;
let dragId: number | null = null;

const q = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as T;
};

function move(from: number, to: number): void {
  if (to < 0 || to >= items.length || from === to) return;
  const [it] = items.splice(from, 1);
  if (it) items.splice(to, 0, it);
  render();
}

function render(): void {
  const list = q<HTMLOListElement>("merge-list");
  list.innerHTML = "";
  items.forEach((it, i) => {
    const li = document.createElement("li");
    li.className = "merge-item";
    li.draggable = true;
    li.dataset.id = String(it.id);

    const name = document.createElement("span");
    name.className = "merge-name";
    name.textContent = it.file.name;
    name.title = it.file.name;

    const mk = (label: string, title: string, onClick: () => void, disabled = false) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "btn";
      b.textContent = label;
      b.title = title;
      b.disabled = disabled;
      b.addEventListener("click", onClick);
      return b;
    };
    li.append(
      name,
      mk("↑", "上へ", () => move(i, i - 1), i === 0),
      mk("↓", "下へ", () => move(i, i + 1), i === items.length - 1),
      mk("✕", "一覧から外す", () => {
        items.splice(i, 1);
        render();
      })
    );

    li.addEventListener("dragstart", () => (dragId = it.id));
    li.addEventListener("dragend", () => (dragId = null));
    li.addEventListener("dragover", (e) => e.preventDefault());
    li.addEventListener("drop", (e) => {
      e.preventDefault();
      const from = items.findIndex((x) => x.id === dragId);
      if (from >= 0) move(from, i);
    });
    list.appendChild(li);
  });
  const none = items.length === 0;
  q("merge-empty").hidden = !none;
  q<HTMLButtonElement>("merge-open").disabled = items.length < 2;
  q<HTMLButtonElement>("merge-download").disabled = items.length < 2;
}

async function runMerge(mode: "open" | "download"): Promise<void> {
  const status = q("merge-status");
  status.textContent = "結合中…";
  try {
    const sources = await Promise.all(items.map(async (it) => new Uint8Array(await it.file.arrayBuffer())));
    const merged = await mergePdfs(sources);
    const file = new File([merged as BlobPart], "merged.pdf", { type: "application/pdf" });
    if (mode === "download") {
      const url = URL.createObjectURL(file);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = "ダウンロードしました。";
    } else {
      closeDialog();
      await loadPdfFile(file);
    }
  } catch (err) {
    console.error(err);
    status.textContent = "結合に失敗しました: " + (err instanceof Error ? err.message : String(err));
  }
}

function openDialog(): void {
  q("merge-status").textContent = "";
  q("merge-dialog").classList.remove("hidden");
  render();
}
function closeDialog(): void {
  q("merge-dialog").classList.add("hidden");
}

export function initMergeDialog(): void {
  q("merge-btn").addEventListener("click", openDialog);
  q("merge-close").addEventListener("click", closeDialog);
  q("merge-clear").addEventListener("click", () => {
    items = [];
    render();
  });
  q<HTMLInputElement>("merge-input").addEventListener("change", (e) => {
    const input = e.target as HTMLInputElement;
    Array.from(input.files ?? []).forEach((file) => items.push({ id: nextId++, file }));
    input.value = "";
    render();
  });
  q("merge-open").addEventListener("click", () => void runMerge("open"));
  q("merge-download").addEventListener("click", () => void runMerge("download"));
}
