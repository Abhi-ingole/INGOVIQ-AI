/* PDF loader for Node scripts / tests (pdf.js legacy build). The browser uses src/ui/pdfLoader.ts. */
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import type { PdfDoc, PdfLoader, PdfItem } from '../src/engine/ingest/pdf';
import { PdfPasswordError } from '../src/engine/ingest/pdf';

export const nodePdfLoader: PdfLoader = async (data, { password, maxPages }) => {
  let doc;
  try {
    doc = await getDocument({ data: new Uint8Array(data.slice(0)), password, isEvalSupported: false, verbosity: 0 }).promise;
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
  const numPages = doc.numPages;
  await doc.destroy();
  return { pages, numPages } satisfies PdfDoc;
};
