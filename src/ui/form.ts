/** Tiny helpers for dense inspector forms: one labelled control per row. */

export interface NumberField {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  onChange: (v: number) => void;
}

export function row(label: string, control: HTMLElement | Text, note = ""): HTMLElement {
  const r = document.createElement("label");
  r.className = "frow";
  const l = document.createElement("span");
  l.textContent = label;
  const n = document.createElement("span");
  n.className = "dim";
  n.textContent = note;
  r.append(l, control, n);
  return r;
}

/** Range slider + live numeric readout; fires onChange on release (tuning can be slow). */
export function numberRow(f: NumberField): HTMLElement {
  const input = document.createElement("input");
  input.type = "range";
  input.min = String(f.min);
  input.max = String(f.max);
  input.step = String(f.step);
  input.value = String(f.value);
  const out = document.createElement("output");
  const decimals = Math.max(0, -Math.floor(Math.log10(f.step)));
  const show = () => (out.textContent = `${Number(input.value).toFixed(decimals)}${f.unit ?? ""}`);
  show();
  input.oninput = show;
  input.onchange = () => f.onChange(Number(input.value));
  const wrap = document.createElement("span");
  wrap.className = "fnum";
  wrap.append(input, out);
  return row(f.label, wrap);
}

export function selectRow<T extends string>(label: string, value: T, options: readonly T[], onChange: (v: T) => void): HTMLElement {
  const s = document.createElement("select");
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o;
    opt.textContent = o;
    s.append(opt);
  }
  s.value = value;
  s.onchange = () => onChange(s.value as T);
  return row(label, s);
}

export function colorRow(label: string, value: string, onChange: (v: string) => void): HTMLElement {
  const c = document.createElement("input");
  c.type = "color";
  c.value = value.startsWith("#") && value.length === 7 ? value : "#ff3b30";
  c.onchange = () => onChange(c.value);
  return row(label, c);
}

export function checkRow(label: string, value: boolean, onChange: (v: boolean) => void, note = ""): HTMLElement {
  const c = document.createElement("input");
  c.type = "checkbox";
  c.checked = value;
  c.onchange = () => onChange(c.checked);
  return row(label, c, note);
}

export function buttons(...defs: [string, () => void, string?][]): HTMLElement {
  const d = document.createElement("div");
  d.className = "fbtns";
  for (const [label, onClick, title] of defs) {
    const b = document.createElement("button");
    b.textContent = label;
    if (title) b.title = title;
    b.onclick = onClick;
    d.append(b);
  }
  return d;
}

export function heading(text: string): HTMLElement {
  const h = document.createElement("div");
  h.className = "fhead";
  h.textContent = text;
  return h;
}
