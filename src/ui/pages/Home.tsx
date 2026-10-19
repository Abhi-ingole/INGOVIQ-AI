import logoFull from '../../assets/logo-full.png';
import { useRef, useState } from 'react';
import type { FileKind } from '../../engine/workbook';

export interface LoadedFile { name: string; size: number; kind: FileKind; handle?: FileSystemFileHandle; lastModified: number }

export function Home({ files, onFiles, onDropItems, onPick, onClearFile, onSetKind, supportsLive, onOpenDashboard, hasData, onReconnect, needReconnect }: {
  files: LoadedFile[]; onFiles: (f: File[]) => void; onDropItems: (x: { file: File; handle?: FileSystemFileHandle }[]) => void; onPick: () => void; onClearFile: (name: string) => void; onSetKind: (name: string, k: FileKind) => void;
  supportsLive: boolean; onOpenDashboard: () => void; hasData: boolean; onReconnect: () => void; needReconnect: boolean;
}) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const kinds: Record<FileKind, string> = { financial: '📊 Financial statements', gst: '🧾 GST analysis', banking: '🏦 Banking analysis', unknown: '❓ Not recognised' };
  return (
    <div className="home">
      <div className="hero">
        <img src={logoFull} alt="INGOVIQ AI" />
        <div>
          <div className="tag">Intelligence in Every Insight.</div>
          <div className="muted">AI-Powered Business Intelligence Platform — credit, financial, GST & banking analysis</div>
          <div className="small muted" style={{ marginTop: 4 }}>Created by Abhishek Ingole</div>
        </div>
      </div>
      <div className={`drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={async (e) => {
          e.preventDefault(); setOver(false);
          // collect synchronously — DataTransfer items expire after the event
          const items = [...e.dataTransfer.items].filter((i) => i.kind === 'file').map((i) => ({
            file: i.getAsFile(),
            hp: (i as DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> }).getAsFileSystemHandle?.(),
          }));
          const out: { file: File; handle?: FileSystemFileHandle }[] = [];
          for (const it of items) {
            if (!it.file || !/\.(xlsx|xlsm|xls|csv)$/i.test(it.file.name)) continue;
            const h = await it.hp?.catch(() => null);
            out.push({ file: it.file, handle: h && h.kind === 'file' ? (h as FileSystemFileHandle) : undefined });
          }
          onDropItems(out);
        }}
        onClick={() => (supportsLive ? onPick() : input.current?.click())}>
        <div style={{ fontSize: 34 }}>📥</div>
        <h2>Get data — drop your Excel files here</h2>
        <div className="muted">Financial report · GST analysis report · Banking analysis report (or bank statement). Upload one, two or all three.</div>
        <div style={{ marginTop: 12 }}><button className="btn primary">Choose Excel files</button></div>
        <div className="small muted" style={{ marginTop: 10 }}>{supportsLive ? '🟢 Live mode available: files opened here are watched — save the Excel and the dashboard refreshes by itself.' : 'Tip: open in Chrome or Edge to enable Live mode (auto-refresh when the Excel file changes).'}</div>
        <input ref={input} type="file" multiple accept=".xlsx,.xlsm,.xls,.csv" hidden onChange={(e) => e.target.files && onFiles([...e.target.files])} />
      </div>
      {needReconnect && <div className="note warn" style={{ marginTop: 12 }}>Your last files are remembered. <button className="btn small" onClick={onReconnect}>Reconnect files for live refresh</button></div>}
      {files.length > 0 && (
        <div className="filelist">
          {files.map((f) => (
            <div className="f" key={f.name}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}><b>{f.name}</b> <span className="small muted">{(f.size / 1024).toFixed(0)} KB {f.handle ? '· live' : ''}</span></span>
              <select value={f.kind} onChange={(e) => onSetKind(f.name, e.target.value as FileKind)} title="Treat as…">
                {(Object.keys(kinds) as FileKind[]).map((k) => <option key={k} value={k}>{kinds[k]}</option>)}
              </select>
              <button className="btn small" onClick={() => onClearFile(f.name)}>Remove</button>
            </div>
          ))}
          {hasData && <div><button className="btn primary" onClick={onOpenDashboard}>Open dashboard →</button></div>}
        </div>
      )}
      <div className="grid g3" style={{ marginTop: 22 }}>
        <div className="card"><div className="card-title">🧹 Auto data cleaning</div><div className="small muted">Detects each report, finds the right sheets, converts text numbers ("2,75,000.00"), aligns financial years, removes duplicate account blocks — no Power Query needed.</div></div>
        <div className="card"><div className="card-title">📐 Exact formulas</div><div className="small muted">All 21 credit parameters, 3-year comparison, GST & banking analytics and reconciliation are computed by fixed formulas — same files, same answer, every time.</div></div>
        <div className="card"><div className="card-title">🔒 Private by design</div><div className="small muted">Files are processed inside your browser. Nothing is uploaded to any server.</div></div>
      </div>
    </div>
  );
}

export function Guide() {
  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div className="page-head"><div><h1>Step-by-step guide</h1><div className="sub">How to use INGOVIQ AI like Power BI Desktop — without Power Query.</div></div></div>
      <div className="steps">
        <div><h4>Get data</h4>Click <b>Get data</b> (ribbon) or drop the Excel files on the start page: Financial report, GST analysis report and Banking analysis report. INGOVIQ recognises each file automatically. If a file is not recognised, use <b>Treat as…</b> next to it.</div>
        <div><h4>Automatic cleaning</h4>Open <b>Data view</b> (left rail, ▦) to see the cleaned tables and the <b>Cleaning log</b> — what was detected, converted and skipped. If any financial value needs correction, type it in the override column; every page recalculates.</div>
        <div><h4>Read the report pages</h4>Use the page tabs at the bottom: Overview → Financials → Ratios → Working Capital → GST → Banking → Reconciliation → Ageing & Bureau → Risk & SWOT → Credit Decision. Section numbers match the credit-analysis format (1–40).</div>
        <div><h4>Filter like Power BI</h4>Use the <b>Filters</b> pane on the right to choose financial years. Click any year bar in a chart to filter by it. On GST and Banking pages use the year / month buttons.</div>
        <div><h4>Change any visual</h4>Hover a chart → <b>⇄</b> to switch type (column, bar, line, area, stacked, pie, donut, table), <b>▦</b> to see its data, <b>⤓</b> to download PNG, <b>⤢</b> for focus mode.</div>
        <div><h4>Build your own visuals & measures</h4><b>My Visuals</b> page: choose data, tick fields, pick a visual type and add it. <b>Model</b> view (ƒx): write DAX-style measures such as <span className="code">DIVIDE([EBITDA], [Interest])</span> or <span className="code">YOY([Revenue])</span>.</div>
        <div><h4>Add what the files don't contain</h4><b>Settings</b>: funding requirement, promoter net worth, principal repayment (for DSCR), CC limit, DP margins. <b>Ageing & Bureau</b> page: debtor / creditor ageing, CIBIL and CMR. <b>Banking → section 22</b>: correct any party's classification (business / internal / promoter / loan…).</div>
        <div><h4>Live data</h4>In Chrome / Edge, files opened through Get data are watched. Turn on <b>Live</b> in the ribbon; when you save the Excel file, the dashboard refreshes within seconds. Otherwise press <b>Refresh</b> and re-select the file.</div>
        <div><h4>Download</h4><b>Export → PDF report</b> creates the complete credit report (every page, disclaimer on each page). <b>Export → Excel</b> gives all cleaned data and calculated tables. <b>PNG</b> saves the current page.</div>
        <div><h4>Next company</h4>Upload the next company's files — later files of the same type replace the earlier ones. Use <b>Clear</b> to start fresh.</div>
      </div>
    </div>
  );
}
