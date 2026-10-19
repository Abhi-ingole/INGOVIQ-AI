/* Getting files in: single files, a whole folder (input / picker / drag-drop) or zips. Paths are kept
   ("Company/Banking/HDFC – pass-1234/Jan.pdf") because folder names often carry passwords and context. */
export interface Incoming { file: File; path: string; handle?: FileSystemFileHandle }

export const ACCEPT = '.xlsx,.xlsm,.xls,.csv,.pdf,.zip,.jpg,.jpeg,.png,.docx';

export function fromFileList(list: FileList | File[]): Incoming[] {
  return [...list].map((file) => ({ file, path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name }));
}

type Entry = { isFile: boolean; isDirectory: boolean; name: string; fullPath: string; file?: (ok: (f: File) => void, err: (e: unknown) => void) => void; createReader?: () => { readEntries: (ok: (e: Entry[]) => void, err: (e: unknown) => void) => void } };

async function walkEntry(e: Entry, out: Incoming[]) {
  if (e.isFile && e.file) {
    const f = await new Promise<File>((ok, err) => e.file!(ok, err));
    out.push({ file: f, path: e.fullPath.replace(/^\//, '') });
  } else if (e.isDirectory && e.createReader) {
    const r = e.createReader();
    for (;;) {
      const batch = await new Promise<Entry[]>((ok, err) => r.readEntries(ok, err));
      if (!batch.length) break;
      for (const c of batch) await walkEntry(c, out);
    }
  }
}

/** Drag & drop: files, folders (recursively) and – for plain Excel files in Chrome/Edge – live handles. */
export async function fromDrop(dt: DataTransfer): Promise<Incoming[]> {
  // collect synchronously — DataTransfer items expire after the event handler yields
  const items = [...dt.items].filter((i) => i.kind === 'file').map((i) => ({
    entry: (i as DataTransferItem & { webkitGetAsEntry?: () => Entry | null }).webkitGetAsEntry?.() || null,
    file: i.getAsFile(),
    hp: (i as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.(),
  }));
  const out: Incoming[] = [];
  for (const it of items) {
    if (it.entry?.isDirectory) { await walkEntry(it.entry, out); continue; }
    if (!it.file) continue;
    const h = await it.hp?.catch(() => null);
    out.push({ file: it.file, path: it.file.name, handle: h && h.kind === 'file' && /\.(xlsx|xlsm|xls|csv)$/i.test(it.file.name) ? (h as FileSystemFileHandle) : undefined });
  }
  return out;
}

/** Chrome / Edge folder picker. Excel files inside keep a live handle. */
export async function pickDirectory(): Promise<Incoming[] | null> {
  const w = window as unknown as { showDirectoryPicker?: (o?: object) => Promise<FileSystemDirectoryHandle> };
  if (!w.showDirectoryPicker || window.self !== window.top) return null;
  const root = await w.showDirectoryPicker({ mode: 'read' });
  const out: Incoming[] = [];
  const walk = async (dir: FileSystemDirectoryHandle, prefix: string) => {
    for await (const h of (dir as unknown as { values: () => AsyncIterable<FileSystemHandle> }).values()) {
      if (h.kind === 'directory') await walk(h as FileSystemDirectoryHandle, `${prefix}${h.name}/`);
      else {
        const fh = h as FileSystemFileHandle;
        const file = await fh.getFile();
        out.push({ file, path: `${prefix}${h.name}`, handle: /\.(xlsx|xlsm|xls|csv)$/i.test(h.name) ? fh : undefined });
      }
    }
  };
  await walk(root, `${root.name}/`);
  return out;
}
