import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFForm,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from "@cantoo/pdf-lib";
import { els } from "./dom";
import { state } from "./state";
import type { FieldKind, FormValue, FormValues } from "./types";
import type { JpFontStyle } from "./jpFont";
import { applyFormValueMap } from "./formApply";
import { loadPdfDocument } from "./pdfLoad";
import type { PDFFont } from "@cantoo/pdf-lib";

export async function loadFormFields(): Promise<void> {
  state.formFieldsMeta = [];
  state.hasAcroForm = false;
  els.formFieldsList.innerHTML = "";
  if (!state.originalBytes) return;

  try {
    const doc = await loadPdfDocument(state.originalBytes);
    const form = doc.getForm();
    const fields = form.getFields();

    if (!fields.length) {
      showNoFieldsMessage();
      return;
    }

    state.hasAcroForm = true;
    els.toggleFormPanel.disabled = false;

    fields.forEach((field) => {
      const name = field.getName();
      const row = document.createElement("div");
      row.className = "field-row";

      const label = document.createElement("label");
      label.textContent = name;
      row.appendChild(label);

      let inputEl: HTMLInputElement | HTMLSelectElement;
      let kind: FieldKind;

      // 注意: CDN配信/バンドル後の圧縮版pdf-libではconstructor.nameが短縮され
      // 使えなくなることがあるため、公開クラスへのinstanceofで型判定する。
      if (field instanceof PDFTextField) {
        kind = "text";
        const input = document.createElement("input");
        input.type = "text";
        try {
          input.value = field.getText() ?? "";
        } catch {
          // 既存値が読み取れない場合は空欄のまま
        }
        inputEl = input;
      } else if (field instanceof PDFCheckBox) {
        kind = "checkbox";
        const input = document.createElement("input");
        input.type = "checkbox";
        try {
          input.checked = field.isChecked();
        } catch {
          // noop
        }
        inputEl = input;
      } else if (field instanceof PDFDropdown) {
        kind = "dropdown";
        const select = document.createElement("select");
        field.getOptions().forEach((opt) => select.appendChild(new Option(opt, opt)));
        try {
          const sel = field.getSelected();
          if (sel.length) select.value = sel[0] as string;
        } catch {
          // noop
        }
        inputEl = select;
      } else if (field instanceof PDFRadioGroup) {
        kind = "radio";
        const select = document.createElement("select");
        field.getOptions().forEach((opt) => select.appendChild(new Option(opt, opt)));
        try {
          const sel = field.getSelected();
          if (sel) select.value = sel;
        } catch {
          // noop
        }
        inputEl = select;
      } else if (field instanceof PDFOptionList) {
        kind = "optionlist";
        const select = document.createElement("select");
        select.multiple = true;
        field.getOptions().forEach((opt) => select.appendChild(new Option(opt, opt)));
        inputEl = select;
      } else {
        kind = "unsupported";
        const input = document.createElement("input");
        input.type = "text";
        input.disabled = true;
        input.placeholder = "このフィールド種別は未対応です";
        inputEl = input;
      }

      row.appendChild(inputEl);
      els.formFieldsList.appendChild(row);
      state.formFieldsMeta.push({ name, kind, el: inputEl });
    });
  } catch {
    // AcroFormが無い、または読み取り不可
    showNoFieldsMessage();
  }
}

function showNoFieldsMessage(): void {
  els.formFieldsList.innerHTML = '<p class="hint">このPDFにはフォーム項目がありません。</p>';
  els.toggleFormPanel.disabled = true;
}

/** フォーム欄の現在の入力値(項目名 → 値)。 */
export function collectFormValues(): FormValues {
  const values: FormValues = {};
  for (const { name, kind, el } of state.formFieldsMeta) {
    if (kind === "unsupported") continue;
    if (el instanceof HTMLInputElement) values[name] = kind === "checkbox" ? el.checked : el.value;
    else if (kind === "optionlist") values[name] = Array.from(el.selectedOptions).map((o) => o.value);
    else values[name] = el.value;
  }
  return values;
}

/** 保存しておいた入力値をフォーム欄へ戻す。 */
export function restoreFormValues(values: FormValues): void {
  for (const { name, el } of state.formFieldsMeta) {
    const v: FormValue | undefined = values[name];
    if (v === undefined) continue;
    if (el instanceof HTMLInputElement) {
      if (typeof v === "boolean") el.checked = v;
      else if (typeof v === "string") el.value = v;
    } else if (Array.isArray(v)) {
      Array.from(el.options).forEach((o) => (o.selected = v.includes(o.value)));
    } else if (typeof v === "string") {
      el.value = v;
    }
  }
}

export async function applyFormValues(
  pdfDoc: PDFDocument,
  {
    flatten = els.flattenForm.checked,
    jpFont,
  }: { flatten?: boolean; jpFont?: (style: JpFontStyle) => Promise<PDFFont> } = {}
): Promise<void> {
  if (!state.hasAcroForm) return;
  const warnings = await applyFormValueMap(pdfDoc, collectFormValues(), { flatten, jpFont });
  warnings.forEach((w) => console.warn(w));
}
