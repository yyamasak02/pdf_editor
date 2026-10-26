function getEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} が見つかりません`);
  return el as T;
}

export const els = {
  fileInput: getEl<HTMLInputElement>("file-input"),
  saveBtn: getEl<HTMLButtonElement>("save-btn"),
  prevPage: getEl<HTMLButtonElement>("prev-page"),
  nextPage: getEl<HTMLButtonElement>("next-page"),
  pageInfo: getEl<HTMLSpanElement>("page-info"),
  zoomSelect: getEl<HTMLSelectElement>("zoom-select"),
  toggleFormPanel: getEl<HTMLButtonElement>("toggle-form-panel"),
  stage: getEl<HTMLDivElement>("stage"),
  emptyState: getEl<HTMLDivElement>("empty-state"),
  toolBtns: Array.from(document.querySelectorAll<HTMLButtonElement>(".tool-btn[data-tool]")),
  editModeToggle: getEl<HTMLButtonElement>("edit-mode-toggle"),
  imageInput: getEl<HTMLInputElement>("image-input"),
  colorInput: getEl<HTMLInputElement>("color-input"),
  fillInput: getEl<HTMLInputElement>("fill-input"),
  fillEnabled: getEl<HTMLInputElement>("fill-enabled"),
  strokeWidth: getEl<HTMLInputElement>("stroke-width"),
  strokeWidthValue: getEl<HTMLSpanElement>("stroke-width-value"),
  fontSize: getEl<HTMLInputElement>("font-size"),
  deleteSelected: getEl<HTMLButtonElement>("delete-selected"),
  propsPanel: getEl<HTMLElement>("props-panel"),
  formPanel: getEl<HTMLDivElement>("form-panel"),
  formFieldsList: getEl<HTMLDivElement>("form-fields-list"),
  flattenForm: getEl<HTMLInputElement>("flatten-form"),
};
