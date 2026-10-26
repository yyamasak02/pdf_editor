// フォーム値(項目名 → 値)をPDFへ書き込む。DOMに依存しないため、ブラウザとCLIで共用する。
import {
  PDFCheckBox,
  PDFDocument,
  PDFDropdown,
  PDFFont,
  PDFOptionList,
  PDFRadioGroup,
  PDFTextField,
} from "@cantoo/pdf-lib";
import { needsJpFont, embedJpFont, type JpFontStyle } from "./jpFont";

export type FormValueMap = Record<string, string | boolean | string[]>;

export interface ApplyFormOptions {
  flatten?: boolean;
  jpFont?: (style: JpFontStyle) => Promise<PDFFont>;
}

/** 反映できなかった項目の説明(警告)を返す。例外は投げない(1項目の失敗で全体を止めない)。 */
export async function applyFormValueMap(
  pdfDoc: PDFDocument,
  values: FormValueMap,
  { flatten = false, jpFont }: ApplyFormOptions = {}
): Promise<string[]> {
  const warnings: string[] = [];
  let form;
  try {
    form = pdfDoc.getForm();
  } catch {
    if (Object.keys(values).length) warnings.push("このPDFにはフォーム項目がありません");
    return warnings;
  }
  const getJp = jpFont ?? ((style: JpFontStyle) => embedJpFont(pdfDoc, style));

  for (const [name, value] of Object.entries(values)) {
    try {
      const field = form.getFieldMaybe(name);
      if (!field) {
        warnings.push(`フォーム項目 "${name}" は存在しません`);
        continue;
      }
      if (field instanceof PDFTextField) {
        const text = String(value);
        field.setText(text);
        // 標準フォントで描けない文字(日本語など)は、日本語フォントで外観を作る。
        if (needsJpFont(text)) field.updateAppearances(await getJp("regular"));
      } else if (field instanceof PDFCheckBox) {
        if (value === true || value === "true" || value === "on") field.check();
        else field.uncheck();
      } else if (field instanceof PDFDropdown) {
        field.select(String(value));
      } else if (field instanceof PDFRadioGroup) {
        field.select(String(value));
      } else if (field instanceof PDFOptionList) {
        const selected = Array.isArray(value) ? value : [String(value)];
        if (selected.length) field.select(selected);
      } else {
        warnings.push(`フォーム項目 "${name}" は未対応の種別です`);
      }
    } catch (err) {
      warnings.push(`フォーム項目 "${name}" の反映に失敗: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (flatten) {
    try {
      form.flatten();
    } catch (err) {
      warnings.push(`フォームの確定(flatten)に失敗: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return warnings;
}
