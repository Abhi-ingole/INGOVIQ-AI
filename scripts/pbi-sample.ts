/* Developer check: build the Power BI project from local sample files (not committed).
   Usage: SAMPLES=/path/to/folder OUT=out.zip npx tsx scripts/pbi-sample.ts */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildDatasetFromFiles } from '../src/engine/ingest/pack';
import { analyse } from '../src/engine/analyse';
import { DEFAULT_INPUTS } from '../src/engine/types';
import { buildPowerBiProject } from '../src/ui/report/powerbi';

const dir = process.env.SAMPLES || './samples';
const files = readdirSync(dir).filter((f) => /\.(xlsx?|pdf|zip)$/i.test(f)).map((f) => { const b = readFileSync(join(dir, f)); return { path: f, size: b.length, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer }; });
const ds = await buildDatasetFromFiles(files, null);
const a = analyse(ds, DEFAULT_INPUTS);
const r = buildPowerBiProject(a, ds, DEFAULT_INPUTS);
writeFileSync(process.env.OUT || 'powerbi.zip', Buffer.from(await r.blob.arrayBuffer()));
console.log(r.fileName, r.tables, 'tables', r.rows, 'rows');
