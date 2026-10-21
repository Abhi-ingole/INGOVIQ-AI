/* Main-thread side of buildWorker: returns null when a worker cannot be used, so callers fall back to the main thread
   (the offline single-file HTML export has no separate worker file and simply reads on the main thread). */
import BuildWorker from './buildWorker?worker';
import type { PackFile } from '../engine/ingest/pack';
import type { Dataset } from '../engine/types';
import type { FileKind } from '../engine/workbook';

let worker: Worker | null = null;
let broken = false;
let seq = 0;
const waiting = new Map<number, { ok: (v: unknown) => void; fail: (e: Error) => void; progress?: (d: number, t: number, p: string) => void }>();

function get(): Worker | null {
  if (broken || typeof Worker === 'undefined') return null;
  if (worker) return worker;
  try {
    worker = new BuildWorker();
    worker.onmessage = (e: MessageEvent<{ id: number; result?: unknown; error?: string; progress?: [number, number, string] }>) => {
      const w = waiting.get(e.data.id);
      if (!w) return;
      if (e.data.progress) { w.progress?.(...e.data.progress); return; }
      waiting.delete(e.data.id);
      if (e.data.error !== undefined) w.fail(new Error(e.data.error)); else w.ok(e.data.result);
    };
    worker.onerror = () => { broken = true; for (const w of waiting.values()) w.fail(new Error('worker failed')); waiting.clear(); worker?.terminate(); worker = null; };
    return worker;
  } catch { broken = true; return null; }
}

function call<T>(msg: Record<string, unknown>, progress?: (d: number, t: number, p: string) => void): Promise<T> | null {
  const w = get();
  if (!w) return null;
  const id = ++seq;
  return new Promise<T>((ok, fail) => {
    waiting.set(id, { ok: ok as (v: unknown) => void, fail, progress });
    try { w.postMessage({ id, ...msg }); } catch (e) { waiting.delete(id); fail(e as Error); }
  });
}

/** detect report kinds (financial / gst / banking) for Excel files in the background */
export function detectKindsInWorker(files: { name: string; data: ArrayBuffer }[]): Promise<FileKind[]> | null {
  return call<FileKind[]>({ op: 'detect', files });
}
/** build the dataset in the background (Excel / zip of Excel only — PDFs need pdf.js on the main thread) */
export function buildInWorker(files: PackFile[], passwords: string[] | undefined, progress?: (d: number, t: number, p: string) => void): Promise<Dataset> | null {
  return call<Dataset>({ op: 'build', files, passwords }, progress);
}
