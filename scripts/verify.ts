/* Developer check: parse local sample workbooks and print key figures.
   Usage: SAMPLES=/path/to/folder npx tsx scripts/verify.ts   (sample files are NOT committed) */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { buildDataset } from '../src/engine/load';
import { analyse } from '../src/engine/analyse';
import { DEFAULT_INPUTS } from '../src/engine/types';

const dir = process.env.SAMPLES || './samples';
const files = readdirSync(dir).filter((f) => /\.xlsx?$/i.test(f)).map((f) => {
  const b = readFileSync(join(dir, f));
  return { name: f, size: b.length, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
});
const ds = buildDataset(files);
for (const l of ds.log) console.log(`[${l.level}] ${l.source}: ${l.message}`);
const a = analyse(ds, DEFAULT_INPUTS);
const show = (label: string, v: unknown) => console.log(label.padEnd(36), typeof v === 'object' ? JSON.stringify(v) : v);
if (process.argv.includes('--json')) console.log(JSON.stringify(a, null, 1).slice(0, 200000));
else {
  show('FYs', a.fin?.fys);
  for (const r of a.fin?.ratios || []) show(r.name, r.values);
  show('GST revenue FY', a.gst?.revenueFY);
  show('GST top5 buyers', a.gst?.concentration.buyers);
  show('GST filings', a.gst?.filing.summary);
  show('Bank totals', a.bank?.totals);
  show('Bank adjusted', a.bank?.adjusted);
  show('Utilisation', a.bank?.utilisation);
  show('Reconciliation', a.recon?.fyRows);
  show('Overlap', a.recon?.overlap);
  show('Score', a.risk?.overall);
  show('Decision', a.risk?.decision);
}
