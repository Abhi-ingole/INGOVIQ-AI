/* Reads and analyses Excel workbooks off the main thread so the dashboard never freezes while files load. */
import { buildDatasetFromFiles, type PackFile } from '../engine/ingest/pack';
import { readWorkbook, detectKind } from '../engine/workbook';

type Req = { id: number; op: 'detect'; files: { name: string; data: ArrayBuffer }[] } | { id: number; op: 'build'; files: PackFile[]; passwords?: string[] };
const post = (m: unknown) => (self as unknown as Worker).postMessage(m);

self.onmessage = async (e: MessageEvent<Req>) => {
  const r = e.data;
  try {
    if (r.op === 'detect') {
      post({ id: r.id, result: r.files.map((f) => { try { return detectKind(readWorkbook(f.data, f.name)); } catch { return 'unknown'; } }) });
    } else {
      const ds = await buildDatasetFromFiles(r.files, null, { passwords: r.passwords, onProgress: (d, t, p) => post({ id: r.id, progress: [d, t, p] }) });
      post({ id: r.id, result: ds });
    }
  } catch (err) {
    post({ id: r.id, error: (err as Error).message || String(err) });
  }
};
