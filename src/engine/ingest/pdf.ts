/* Environment-neutral PDF text model. The browser (pdf.js) or a test script fills it;
   parsers only see positioned text items, grouped into visual lines. */

export interface PdfItem { str: string; x: number; y: number; w: number }
export interface PdfLine { y: number; items: PdfItem[]; text: string }
export interface PdfDoc { pages: PdfItem[][]; numPages: number }

/** Loader signature implemented by the UI (pdf.js) and by node scripts. */
export type PdfLoader = (data: ArrayBuffer, opts: { password?: string; maxPages?: number }) => Promise<PdfDoc>;

export class PdfPasswordError extends Error {
  constructor() { super('Password required'); this.name = 'PdfPasswordError'; }
}

/** Group items into lines (top to bottom), items left to right. */
export function toLines(items: PdfItem[], tol = 2.5): PdfLine[] {
  const sorted = items.filter((i) => i.str.trim()).sort((a, b) => b.y - a.y || a.x - b.x);
  const lines: PdfLine[] = [];
  for (const it of sorted) {
    const l = lines.find((x) => Math.abs(x.y - it.y) <= tol);
    if (l) l.items.push(it);
    else lines.push({ y: it.y, items: [it], text: '' });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    let t = '';
    let prevEnd = -1;
    for (const it of l.items) {
      if (prevEnd >= 0) t += it.x - prevEnd > 1.5 ? ' ' : '';
      t += it.str;
      prevEnd = it.x + it.w;
    }
    l.text = t.replace(/\s+/g, ' ').trim();
  }
  return lines.sort((a, b) => b.y - a.y);
}

export function docText(doc: PdfDoc, maxPages = 3): string {
  return doc.pages.slice(0, maxPages).map((p) => toLines(p).map((l) => l.text).join('\n')).join('\n');
}

/** Candidate passwords hidden in a path: "pass-197650294", "pwd 1234", "password_abcd". */
export function passwordsFromPath(path: string): string[] {
  const out = new Set<string>();
  for (const m of path.matchAll(/(?:pass(?:word)?|pwd)\s*[-_:=]?\s*([A-Za-z0-9@#]{4,20})/gi)) out.add(m[1]);
  return [...out];
}
