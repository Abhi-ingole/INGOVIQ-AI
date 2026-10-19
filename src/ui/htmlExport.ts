/* "Export → Interactive HTML": one self-contained .html file = the full INGOVIQ app + the loaded
   Excel data + manual inputs, visuals and measures. Opens offline in any browser with every page,
   filter, chart switch and export working. "Get data / Refresh" inside it updates with newer Excel. */
import type { ManualInputs } from '../engine/types';
import type { FileKind } from '../engine/workbook';
import type { CustomMeasure, CustomVisual } from './pages/Custom';

export interface EmbeddedFile { name: string; size: number; kind: FileKind; lastModified: number; b64: string }
export interface EmbeddedSnapshot {
  app: 'INGOVIQ AI';
  version: 1;
  company: string;
  createdAt: string;
  files: EmbeddedFile[];
  inputs: ManualInputs;
  visuals: CustomVisual[];
  measures: CustomMeasure[];
}

const DATA_ID = 'ingoviq-data';

async function toB64(buf: ArrayBuffer): Promise<string> {
  const url: string = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result as string);
    r.onerror = () => rej(r.error);
    r.readAsDataURL(new Blob([buf]));
  });
  return url.slice(url.indexOf(',') + 1);
}

export function b64ToBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** Snapshot embedded in the current document (when this page is an exported HTML). */
export function readEmbedded(): EmbeddedSnapshot | null {
  const el = document.getElementById(DATA_ID);
  if (!el?.textContent) return null;
  try {
    const d = JSON.parse(el.textContent) as EmbeddedSnapshot;
    return d.app === 'INGOVIQ AI' && Array.isArray(d.files) ? d : null;
  } catch { return null; }
}

async function template(): Promise<string> {
  // GitHub Pages / normal build: the single-file template is published next to the app
  if (!__INGOVIQ_STANDALONE__ && location.protocol !== 'file:') try {
    const r = await fetch('./ingoviq-standalone.html', { cache: 'no-cache' });
    if (r.ok) {
      const t = await r.text();
      if (t.includes('<div id="root">')) return t;
    }
  } catch { /* opened from file:// or offline */ }
  // Running inside an exported HTML: reuse the pristine copy captured at start-up
  if (window.__INGOVIQ_TEMPLATE__) return window.__INGOVIQ_TEMPLATE__;
  throw new Error('HTML template not available in this build — run "npm run build" (it creates ingoviq-standalone.html).');
}

export async function exportHtml(
  files: { name: string; size: number; kind: FileKind; lastModified: number; buffer: ArrayBuffer }[],
  company: string, inputs: ManualInputs, visuals: CustomVisual[], measures: CustomMeasure[],
) {
  let html = await template();
  // drop any snapshot already inside the template (re-export from an exported file)
  for (let i = html.indexOf(`id="${DATA_ID}"`); i >= 0; i = html.indexOf(`id="${DATA_ID}"`)) {
    const start = html.lastIndexOf('<script', i), end = html.indexOf('</script>', i);
    if (start < 0 || end < 0) break;
    html = html.slice(0, start) + html.slice(end + 9);
  }
  const snap: EmbeddedSnapshot = {
    app: 'INGOVIQ AI', version: 1, company, createdAt: new Date().toISOString(),
    files: await Promise.all(files.map(async (f) => ({ name: f.name, size: f.size, kind: f.kind, lastModified: f.lastModified, b64: await toB64(f.buffer) }))),
    inputs, visuals, measures,
  };
  // JSON inside <script> must never contain "</script" — escape "<"
  const json = JSON.stringify(snap).replace(/</g, '\\u003c');
  const tag = `<script type="application/json" id="${DATA_ID}">${json}</script>`;
  // insert at the LAST </body> (library code inside the bundle can contain the same text)
  const at = html.lastIndexOf('</body>');
  html = at >= 0 ? html.slice(0, at) + tag + '\n' + html.slice(at) : html + tag;
  const t0 = html.indexOf('<title>'), t1 = html.indexOf('</title>', t0);
  if (t0 >= 0 && t1 > t0 && t0 < html.indexOf('<script')) html = html.slice(0, t0) + `<title>INGOVIQ AI — ${company.replace(/[<>&]/g, '')}` + html.slice(t1);
  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `INGOVIQ_Dashboard_${company.replace(/[^\w]+/g, '_').slice(0, 40)}_${new Date().toISOString().slice(0, 10)}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  return blob.size;
}
