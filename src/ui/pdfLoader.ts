/* Browser PDF loader (pdf.js). The worker module runs on the main thread ("fake worker"),
   so it also works inside the single-file HTML export and from file://. Text extraction is
   cached by file content, so live refreshes of an Excel file don't re-read every PDF. */
import type { PdfDoc, PdfItem, PdfLoader } from '../engine/ingest/pdf';
import { PdfPasswordError } from '../engine/ingest/pdf';

type PdfJs = typeof import('pdfjs-dist');
let lib: Promise<PdfJs> | null = null;
function load(): Promise<PdfJs> {
  lib ||= (async () => {
    const worker = await import('pdfjs-dist/build/pdf.worker.mjs');
    (globalThis as unknown as { pdfjsWorker: unknown }).pdfjsWorker = worker;
    return import('pdfjs-dist');
  })();
  return lib;
}

const cache = new Map<string, PdfDoc>();
function keyOf(data: ArrayBuffer, password?: string): string {
  const u = new Uint8Array(data);
  let h = 2166136261;
  const step = Math.max(1, Math.floor(u.length / 65536));
  for (let i = 0; i < u.length; i += step) { h ^= u[i]; h = Math.imul(h, 16777619); }
  return `${u.length}:${h >>> 0}:${password || ''}`;
}

export const browserPdfLoader: PdfLoader = async (data, { password, maxPages }) => {
  const key = keyOf(data, password);
  const hit = cache.get(key);
  if (hit) return hit;
  const pdfjs = await load();
  let doc;
  try {
    doc = await pdfjs.getDocument({ data: new Uint8Array(data.slice(0)), password, isEvalSupported: false, verbosity: 0 }).promise;
  } catch (e) {
    if ((e as { name?: string }).name === 'PasswordException') throw new PdfPasswordError();
    throw e;
  }
  const n = Math.min(doc.numPages, maxPages ?? doc.numPages);
  const pages: PdfItem[][] = [];
  for (let p = 1; p <= n; p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    pages.push(tc.items.filter((i): i is typeof i & { str: string; transform: number[]; width: number } => 'str' in i).map((i) => ({ str: i.str, x: i.transform[4], y: i.transform[5], w: i.width })));
    page.cleanup();
  }
  const out: PdfDoc = { pages, numPages: doc.numPages };
  await doc.destroy();
  cache.set(key, out);
  return out;
};
