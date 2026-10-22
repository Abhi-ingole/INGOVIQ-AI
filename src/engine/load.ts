import type { Dataset, CleaningLog } from './types';
import { readWorkbook, detectKind, type FileKind } from './workbook';
import { parseFinancial } from './parseFinancial';
import { parseGst } from './parseGst';
import { parseBanking } from './parseBanking';

export interface InputFile { name: string; data: ArrayBuffer; size: number; forceKind?: FileKind }

/** Parse every uploaded workbook into one cleaned dataset. Later files of the same kind replace earlier ones. */
export function buildDataset(files: InputFile[]): Dataset {
  const log: CleaningLog[] = [];
  const ds: Dataset = { financial: null, gst: null, banking: null, files: [], log };
  for (const f of files) {
    let kind: FileKind = 'unknown';
    try {
      const wb = readWorkbook(f.data, f.name);
      kind = f.forceKind && f.forceKind !== 'unknown' ? f.forceKind : detectKind(wb);
      log.push({ source: f.name, level: 'info', message: `Detected as ${kind.toUpperCase()} report (${wb.sheetOrder.length} sheets).` });
      if (kind === 'financial') ds.financial = parseFinancial(wb, log);
      else if (kind === 'gst') ds.gst = parseGst(wb, log);
      else if (kind === 'banking') ds.banking = parseBanking(wb, log);
      else log.push({ source: f.name, level: 'warn', message: 'Could not recognise this file. Use "Treat as…" to tell INGOVIZ what it is.' });
    } catch (e) {
      log.push({ source: f.name, level: 'warn', message: `Failed to read file: ${(e as Error).message}` });
    }
    ds.files.push({ name: f.name, kind, size: f.size, loadedAt: new Date().toISOString() });
  }
  return ds;
}
