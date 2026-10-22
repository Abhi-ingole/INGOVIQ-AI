import logoFull from '../../assets/logo-full.png';
import { useRef, useState } from 'react';
import type { FileKind } from '../../engine/workbook';
import type { DocEntry } from '../../engine/types';
import { type Incoming, ACCEPT, fromDrop } from '../fileIntake';

export interface LoadedFile { name: string; size: number; kind: FileKind; handle?: FileSystemFileHandle; lastModified: number }

export function Home({ files, onFiles, onDropItems, onPick, onPickFolder, onClearFile, onSetKind, supportsLive, onOpenDashboard, hasData, onReconnect, needReconnect, progress, docs, passwords, onPasswords }: {
  files: LoadedFile[]; onFiles: (f: File[]) => void; onDropItems: (x: Incoming[], isFolder: boolean) => void; onPick: () => void; onPickFolder: () => void; onClearFile: (name: string) => void; onSetKind: (name: string, k: FileKind) => void;
  supportsLive: boolean; onOpenDashboard: () => void; hasData: boolean; onReconnect: () => void; needReconnect: boolean;
  progress: string; docs: DocEntry[]; passwords: string[]; onPasswords: (p: string[]) => void;
}) {
  const [over, setOver] = useState(false);
  const [pw, setPw] = useState('');
  const [showAll, setShowAll] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const needPw = docs.filter((d) => d.status === 'needs password');
  const docOf = (name: string) => docs.find((d) => d.path === name);
  const kinds: Record<FileKind, string> = { financial: '📊 Financial statements', gst: '🧾 GST analysis', banking: '🏦 Banking analysis', unknown: '❓ Not recognised' };
  return (
    <div className="home">
      <div className="hero">
        <div className="hero-product">
          <div className="hero-eyebrow">AI-Powered Business Intelligence Platform</div>
          <h1 className="hero-name">INGOVIZ <span className="ai">AI</span></h1>
          <div className="tag">Turn Data Into Intelligence.</div>
          <div className="hero-line">Create Dashboards. Discover Insights. Make Smarter Decisions.</div>
          <div className="small muted" style={{ marginTop: 6 }}>Credit, financial, GST &amp; banking analysis · Created by Abhishek Ingole</div>
        </div>
        <div className="hero-company">
          <span className="small muted">A product of</span>
          <img src={logoFull} alt="INGOVIQ AI" />
        </div>
      </div>
      <div className={`drop ${over ? 'over' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
        onDrop={async (e) => {
          e.preventDefault(); setOver(false);
          const got = await fromDrop(e.dataTransfer);
          onDropItems(got, got.some((g) => g.path.includes('/')) || got.some((g) => /\.zip$/i.test(g.path)));
        }}
        onClick={() => (supportsLive ? onPick() : input.current?.click())}>
        <div style={{ fontSize: 34 }}>📥</div>
        <h2>Get data — drop a loan-file folder, a zip or individual files here</h2>
        <div className="muted">Analysis reports (Financial · GST · Banking Excel) <b>or</b> the raw loan file: bank-statement PDFs, GSTR-3B PDFs, CIBIL / CMR, net-worth certificates, MCA data, Tally ledgers, ageing, loan obligation sheet, KYC. INGOVIZ reads every file and builds the full report.</div>
        <div style={{ marginTop: 12, display: 'flex', gap: 8, justifyContent: 'center', flexWrap: 'wrap' }}>
          <button className="btn primary" onClick={(e) => { e.stopPropagation(); onPickFolder(); }}>🗂 Upload folder</button>
          <button className="btn primary" onClick={(e) => { e.stopPropagation(); input.current?.click(); }}>🗜 Upload zip / files</button>
          {supportsLive && <button className="btn" onClick={(e) => { e.stopPropagation(); onPick(); }}>📂 Excel with live refresh</button>}
        </div>
        <div className="small muted" style={{ marginTop: 10 }}>{supportsLive ? '🟢 Live mode available: files opened here are watched — save the Excel and the dashboard refreshes by itself.' : 'Tip: open in Chrome or Edge to enable Live mode (auto-refresh when the Excel file changes).'}</div>
        <input ref={input} type="file" multiple accept={ACCEPT} hidden onClick={(e) => e.stopPropagation()} onChange={(e) => { if (e.target.files) onFiles([...e.target.files]); e.target.value = ''; }} />
      </div>
      {progress && <div className="note" style={{ marginTop: 12 }}><span className="live-dot" /> {progress}</div>}
      {(needPw.length > 0 || passwords.length > 0) && (
        <div className={`note ${needPw.length ? 'warn' : ''}`} style={{ marginTop: 12 }}>
          <b>PDF passwords.</b> {needPw.length ? `${needPw.length} PDF(s) are password-protected: ${needPw.slice(0, 4).map((d) => d.path.split('/').pop()).join(', ')}${needPw.length > 4 ? '…' : ''}. ` : ''}
          Passwords written in folder / file names (e.g. "pass-1234") are tried automatically. Add others here — they stay in this browser only.
          <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
            <input value={pw} onChange={(e) => setPw(e.target.value)} placeholder="Password" style={{ padding: '4px 8px', border: '1px solid var(--border-strong)', borderRadius: 6 }} onKeyDown={(e) => { if (e.key === 'Enter' && pw.trim()) { onPasswords([...new Set([...passwords, pw.trim()])]); setPw(''); } }} />
            <button className="btn small primary" disabled={!pw.trim()} onClick={() => { onPasswords([...new Set([...passwords, pw.trim()])]); setPw(''); }}>Add & retry</button>
            {passwords.map((p) => <span key={p} className="chip neutral">{'•'.repeat(Math.min(p.length, 8))} <button className="clear" onClick={() => onPasswords(passwords.filter((x) => x !== p))}>✕</button></span>)}
          </div>
        </div>
      )}
      {needReconnect && <div className="note warn" style={{ marginTop: 12 }}>Your last files are remembered. <button className="btn small" onClick={onReconnect}>Reconnect files for live refresh</button></div>}
      {files.length > 0 && (
        <div className="filelist">
          {docs.length > 0 && <div className="small muted">{docs.length} files read · {docs.filter((d) => d.status === 'used').length} used · {docs.filter((d) => d.status === 'scanned').length} scanned · {needPw.length} need password — full list on the <b>Loan File</b> page.</div>}
          {(showAll ? files : files.slice(0, 12)).map((f) => (
            <div className="f" key={f.name}>
              <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={f.name}><b>{f.name.split('/').pop()}</b> <span className="small muted">{(f.size / 1024).toFixed(0)} KB {f.handle ? '· live' : ''} {f.name.includes('/') ? `· ${f.name.split('/').slice(0, -1).join(' / ')}` : ''}</span></span>
              {/\.(xlsx|xlsm|xls|csv)$/i.test(f.name) && !docOf(f.name)?.type.match(/ledger|ageing|obligation|MOM|template/i) ? (
                <select value={f.kind} onChange={(e) => onSetKind(f.name, e.target.value as FileKind)} title="Treat as…">
                  {(Object.keys(kinds) as FileKind[]).map((k) => <option key={k} value={k}>{kinds[k]}</option>)}
                </select>
              ) : <span className="small">{docOf(f.name)?.type || (/\.zip$/i.test(f.name) ? 'Zip archive' : '')}</span>}
              <button className="btn small" onClick={() => onClearFile(f.name)}>Remove</button>
            </div>
          ))}
          {files.length > 12 && <button className="btn small" onClick={() => setShowAll(!showAll)}>{showAll ? 'Show fewer' : `Show all ${files.length} files`}</button>}
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
      <div className="page-head"><div><h1>Step-by-step guide</h1><div className="sub">How to use INGOVIZ AI like Power BI Desktop — without Power Query.</div></div></div>
      <div className="steps">
        <div><h4>Get data</h4>Click <b>Get data</b> (ribbon) or drop the Excel files on the start page: Financial report, GST analysis report and Banking analysis report. INGOVIZ recognises each file automatically. If a file is not recognised, use <b>Treat as…</b> next to it.</div>
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
