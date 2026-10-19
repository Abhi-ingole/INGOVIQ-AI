import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildDataset } from './engine/load';
import { analyse } from './engine/analyse';
import { DEFAULT_INPUTS, type ManualInputs } from './engine/types';
import { readWorkbook, detectKind, type FileKind } from './engine/workbook';
import { sortFYs } from './engine/utils';
import type { PageCtx } from './ui/ctx';
import { Overview } from './ui/pages/Overview';
import { Financials, Ratios, WorkingCapital } from './ui/pages/Financials';
import { Gst } from './ui/pages/Gst';
import { Banking } from './ui/pages/Banking';
import { Recon } from './ui/pages/Recon';
import { AgeingBureau, RiskSwot, Decision } from './ui/pages/Risk';
import { MyVisuals, Measures, type CustomMeasure, type CustomVisual } from './ui/pages/Custom';
import { DataView } from './ui/pages/DataView';
import { Settings } from './ui/pages/Settings';
import { Home, Guide, type LoadedFile } from './ui/pages/Home';
import { idbGet, idbSet, lsGet, lsGetArr, lsSet } from './ui/store';
import { exportExcel, exportPdf, exportPng } from './ui/exporters';
import { ExportMode } from './ui/common';
import logoFull from './assets/logo-full.png';
import logoIcon from './assets/logo-icon.png';
import { exportHtml, readEmbedded, b64ToBuffer, type EmbeddedSnapshot } from './ui/htmlExport';

interface StoredFile extends LoadedFile { buffer: ArrayBuffer }
type View = 'home' | 'report' | 'data' | 'model' | 'settings' | 'guide';
const PAGES = ['Overview', 'Financials', 'Ratios', 'Working Capital', 'GST', 'Banking', 'Reconciliation', 'Ageing & Bureau', 'Risk & SWOT', 'Credit Decision', 'My Visuals'] as const;
type Page = (typeof PAGES)[number];
const PAGE_SUB: Record<Page, string> = {
  Overview: 'Sections 1–2 · Company & credit snapshot, executive AI credit summary',
  Financials: 'Part A · Section 3 · Year-wise statements and three-year comparison',
  Ratios: 'Part A · Section 4 · 21 core financial parameters',
  'Working Capital': 'Part A · Section 5 · Working-capital cycle and requirement',
  GST: 'Part B · Sections 6–13 · Sales, purchases, buyers, suppliers, exports, filing, states, intra-group, HSN',
  Banking: 'Part C · Sections 14–25 · Trend, internal transfers, adjusted inflow, returns, BTO, parties, loans, cash, CC/OD',
  Reconciliation: 'Part D · Sections 26–28 · Financial vs GST vs Banking, buyer & supplier triangulation',
  'Ageing & Bureau': 'Part E · Sections 29–30 · Invoice ageing and CIBIL / CMR',
  'Risk & SWOT': 'Parts F–G · Sections 31–35 · Red flags, SWOT and integrated credit score',
  'Credit Decision': 'Part H · Sections 36–40 · Funding capacity, product mapping, recommendation, analyst remarks',
  'My Visuals': 'Build your own visuals from the cleaned data and measures',
};

const hasFSA = typeof window !== 'undefined' && 'showOpenFilePicker' in window && window.self === window.top;

export default function App() {
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [inp, setInpState] = useState<ManualInputs>(() => lsGet('ingoviq.inputs', DEFAULT_INPUTS));
  const [visuals, setVisualsState] = useState<CustomVisual[]>(() => lsGetArr('ingoviq.visuals'));
  const [measures, setMeasuresState] = useState<CustomMeasure[]>(() => lsGetArr('ingoviq.measures'));
  const [view, setView] = useState<View>('home');
  const [page, setPage] = useState<Page>('Overview');
  const [fySel, setFySel] = useState<string[]>([]);
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>(() => { try { return (localStorage.getItem('ingoviq.theme') as 'auto' | 'light' | 'dark') || 'light'; } catch { return 'light'; } });
  const [systemDark, setSystemDark] = useState(() => window.matchMedia?.('(prefers-color-scheme: dark)').matches ?? false);
  const [live, setLive] = useState(true);
  const [pane, setPane] = useState(true);
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState('');
  const [exporting, setExporting] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [needReconnect, setNeedReconnect] = useState(false);
  const [snapshot, setSnapshot] = useState<EmbeddedSnapshot | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const say = useCallback((m: string) => { setToast(m); window.setTimeout(() => setToast((t) => (t === m ? '' : t)), 3500); }, []);
  const setInp = useCallback((p: Partial<ManualInputs>) => setInpState((s) => { const n = { ...s, ...p }; lsSet('ingoviq.inputs', n); return n; }), []);
  const setVisuals = (v: CustomVisual[]) => { setVisualsState(v); lsSet('ingoviq.visuals', v); };
  const setMeasures = (m: CustomMeasure[]) => { setMeasuresState(m); lsSet('ingoviq.measures', m); };

  // theme
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    const h = () => setSystemDark(mq.matches);
    mq?.addEventListener?.('change', h);
    return () => mq?.removeEventListener?.('change', h);
  }, []);
  const effTheme = exporting ? 'light' : theme === 'auto' ? (systemDark ? 'dark' : 'light') : theme;
  // set synchronously so charts computed in this render read the right CSS colours
  if (document.documentElement.dataset.theme !== effTheme) document.documentElement.dataset.theme = effTheme;
  useEffect(() => { try { localStorage.setItem('ingoviq.theme', theme); } catch { /* storage blocked */ } }, [theme]);
  const themeKey = `${effTheme}-${exporting ? 'x' : ''}`;

  // restore: data embedded in an exported HTML wins, else the last session in this browser
  useEffect(() => {
    const emb = readEmbedded();
    if (emb) {
      setSnapshot(emb);
      setFiles(emb.files.map((f) => ({ name: f.name, size: f.size, kind: f.kind, lastModified: f.lastModified, buffer: b64ToBuffer(f.b64) })));
      setInpState({ ...DEFAULT_INPUTS, ...emb.inputs });
      setVisualsState(emb.visuals || []);
      setMeasuresState(emb.measures || []);
      setView('report');
      setLastRefresh(new Date(emb.createdAt));
      return;
    }
    idbGet<StoredFile[]>('files').then(async (saved) => {
      if (!saved?.length) return;
      setFiles(saved);
      setView('report');
      setLastRefresh(new Date(Math.max(...saved.map((f) => f.lastModified))));
      if (saved.some((f) => f.handle)) {
        const states = await Promise.all(saved.filter((f) => f.handle).map((f) => (f.handle as FileSystemFileHandle & { queryPermission?: (o: object) => Promise<string> }).queryPermission?.({ mode: 'read' }).catch(() => 'denied')));
        if (states.some((s) => s !== 'granted')) setNeedReconnect(true);
      }
    });
  }, []);
  const persist = (fs: StoredFile[]) => { idbSet('files', fs); };

  const addFiles = useCallback(async (list: { file: File; handle?: FileSystemFileHandle }[]) => {
    if (!list.length) return;
    setBusy('Reading and cleaning files…');
    const added: StoredFile[] = [];
    for (const { file, handle } of list) {
      const buffer = await file.arrayBuffer();
      let kind: FileKind = 'unknown';
      try { kind = detectKind(readWorkbook(buffer, file.name)); } catch { /* reported in cleaning log */ }
      added.push({ name: file.name, size: file.size, kind, handle, lastModified: file.lastModified, buffer });
    }
    setFiles((cur) => {
      // a new file of the same kind replaces the old one (next company / new version)
      const kept = cur.filter((c) => !added.some((a) => a.name === c.name || (a.kind !== 'unknown' && a.kind === c.kind)));
      const next = [...kept, ...added];
      persist(next);
      return next;
    });
    setBusy('');
    setSnapshot(null);
    setLastRefresh(new Date());
    say(`Loaded ${added.map((a) => `${a.name} (${a.kind})`).join(', ')}`);
  }, [say]);

  const pick = async () => {
    if (!hasFSA) { fileInput.current?.click(); return; }
    try {
      const handles: FileSystemFileHandle[] = await (window as unknown as { showOpenFilePicker: (o: object) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker({ multiple: true, types: [{ description: 'Excel workbooks', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx', '.xlsm'], 'application/vnd.ms-excel': ['.xls'], 'text/csv': ['.csv'] } }] });
      await addFiles(await Promise.all(handles.map(async (h) => ({ file: await h.getFile(), handle: h }))));
      setNeedReconnect(false);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') fileInput.current?.click();
    }
  };

  const reconnect = async () => {
    let ok = true;
    for (const f of files) {
      const h = f.handle as (FileSystemFileHandle & { requestPermission?: (o: object) => Promise<string> }) | undefined;
      if (h?.requestPermission) ok = (await h.requestPermission({ mode: 'read' }).catch(() => 'denied')) === 'granted' && ok;
    }
    setNeedReconnect(!ok);
    if (ok) { say('Files reconnected — live refresh is on'); refreshFromHandles(true); }
  };

  const refreshFromHandles = useCallback(async (force = false) => {
    const withH = files.filter((f) => f.handle);
    if (!withH.length) return false;
    let changed = false;
    const next: StoredFile[] = [];
    for (const f of files) {
      if (!f.handle) { next.push(f); continue; }
      try {
        const file = await f.handle.getFile();
        if (force || file.lastModified !== f.lastModified) {
          next.push({ ...f, lastModified: file.lastModified, size: file.size, buffer: await file.arrayBuffer() });
          changed = true;
        } else next.push(f);
      } catch { next.push(f); }
    }
    if (changed) {
      setFiles(next);
      persist(next);
      setLastRefresh(new Date());
      say(`Data refreshed from Excel at ${new Date().toLocaleTimeString('en-IN')}`);
    }
    return true;
  }, [files, say]);

  // live polling
  useEffect(() => {
    if (!live || needReconnect || !files.some((f) => f.handle)) return;
    const t = window.setInterval(() => refreshFromHandles(false), 3000);
    return () => window.clearInterval(t);
  }, [live, needReconnect, files, refreshFromHandles]);

  const refresh = async () => {
    const ok = await refreshFromHandles(true);
    if (!ok) { say('Select the updated Excel file(s) to refresh'); pick(); }
  };

  const ds = useMemo(() => buildDataset(files.map((f) => ({ name: f.name, data: f.buffer, size: f.size, forceKind: f.kind }))), [files]);
  const a = useMemo(() => analyse(ds, inp), [ds, inp]);
  const hasData = !!(ds.financial || ds.gst || ds.banking);
  const allFYs = useMemo(() => sortFYs([...(a.fin?.fys || []), ...(a.gst?.fys || [])]), [a]);
  const toggleFY = useCallback((fy: string) => { if (!/^FY /.test(fy)) return; setFySel((s) => (s.includes(fy) ? s.filter((x) => x !== fy) : [...s, fy])); }, []);
  const ctx: PageCtx = { a, ds, inp, setInp, fySel, toggleFY, themeKey };

  const renderPage = (p: Page, c: PageCtx) => {
    switch (p) {
      case 'Overview': return <Overview {...c} />;
      case 'Financials': return <Financials {...c} />;
      case 'Ratios': return <Ratios {...c} />;
      case 'Working Capital': return <WorkingCapital {...c} />;
      case 'GST': return <Gst {...c} />;
      case 'Banking': return <Banking {...c} />;
      case 'Reconciliation': return <Recon {...c} />;
      case 'Ageing & Bureau': return <AgeingBureau {...c} />;
      case 'Risk & SWOT': return <RiskSwot {...c} />;
      case 'Credit Decision': return <Decision {...c} />;
      case 'My Visuals': return <MyVisuals {...c} visuals={visuals} setVisuals={setVisuals} measures={measures} />;
    }
  };

  const doPdf = async () => {
    if (!hasData) return;
    setExporting(true);
    setBusy('Preparing PDF report…');
    await new Promise((r) => setTimeout(r, 1500)); // let every chart render in light theme
    try {
      const secs = [...(exportRef.current?.querySelectorAll<HTMLElement>('.export-sec') || [])];
      await exportPdf(secs, a.company, setBusy);
      say('PDF report downloaded');
    } catch (e) { say(`PDF export failed: ${(e as Error).message}`); }
    setExporting(false);
    setBusy('');
  };

  const doHtml = async () => {
    setBusy('Building interactive HTML…');
    try {
      const size = await exportHtml(files, a.company, inp, visuals, measures);
      say(`Interactive HTML downloaded (${(size / 1048576).toFixed(1)} MB) — open it in any browser, works offline`);
    } catch (e) { say(`HTML export failed: ${(e as Error).message}`); }
    setBusy('');
  };

  const clearAll = () => {
    if (!confirm('Remove all loaded files from this browser?')) return;
    setFiles([]); persist([]); setView('home'); setFySel([]);
  };

  const homeFiles: LoadedFile[] = files.map(({ buffer: _b, ...f }) => f); // eslint-disable-line @typescript-eslint/no-unused-vars
  const liveCapable = files.some((f) => f.handle);

  return (
    <div className="app">
      <div className="titlebar">
        <div className="brand"><img src={logoIcon} alt="" />INGOVIQ <span className="ai">AI</span></div>
        <div className="doc">{hasData ? `${a.company}` : 'Untitled'} {snapshot && <span className="chip warn" style={{ margin: '0 6px' }} title="Data is embedded in this HTML file. Use Get data / Refresh to load newer Excel files.">Offline snapshot</span>}{lastRefresh && <span>· {snapshot ? 'data as of' : 'refreshed'} {lastRefresh.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}</div>
        {liveCapable && live && !needReconnect && <span className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="live-dot" /> Live</span>}
        <button className="tb-btn" onClick={() => setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'auto' : 'light')} title="Theme">{theme === 'light' ? '☀ Light' : theme === 'dark' ? '☾ Dark' : '◐ Auto'}</button>
      </div>

      <div className="ribbon">
        <div className="group">
          <button className="rb" onClick={() => { setView('home'); }}><span className="ic">📥</span>Get data</button>
          <button className="rb" onClick={pick}><span className="ic">📂</span>Excel workbook</button>
          <button className="rb" disabled={!files.length} onClick={refresh}><span className="ic">⟳</span>Refresh</button>
          <button className={`rb ${live && liveCapable ? 'on' : ''}`} disabled={!liveCapable} onClick={() => setLive(!live)} title={liveCapable ? 'Auto-refresh when the Excel file is saved' : 'Open files with Get data in Chrome/Edge to enable'}><span className="ic">{live && liveCapable ? '🟢' : '⚪'}</span>Live</button>
          <button className="rb" disabled={!files.length} onClick={clearAll}><span className="ic">🗑</span>Clear</button>
        </div>
        <div className="group">
          <button className="rb" disabled={!hasData} onClick={() => { setView('report'); setPage('My Visuals'); }}><span className="ic">📊</span>New visual</button>
          <button className="rb" disabled={!hasData} onClick={() => setView('model')}><span className="ic">ƒx</span>New measure</button>
          <button className="rb" disabled={!hasData} onClick={() => setView('data')}><span className="ic">▦</span>Transform data</button>
        </div>
        <div className="group">
          <button className="rb" disabled={!hasData} onClick={doPdf}><span className="ic">📄</span>PDF report</button>
          <button className="rb" disabled={!hasData} onClick={() => exportExcel(a, ds, measures)}><span className="ic">📗</span>Excel</button>
          <button className="rb" disabled={!hasData} title="One offline HTML file with the full interactive dashboard and data" onClick={doHtml}><span className="ic">🌐</span>HTML</button>
          <button className="rb" disabled={!hasData || view === 'home'} onClick={() => pageRef.current && exportPng(pageRef.current, `${a.company}_${view === 'report' ? page : view}`)}><span className="ic">🖼</span>PNG page</button>
        </div>
        <div className="group">
          <button className={`rb ${pane ? 'on' : ''}`} onClick={() => setPane(!pane)}><span className="ic">⏷</span>Filters</button>
          <button className="rb" onClick={() => setView('settings')}><span className="ic">⚙</span>Settings</button>
          <button className="rb" onClick={() => setView('guide')}><span className="ic">?</span>Guide</button>
        </div>
      </div>

      <div className="workspace">
        <nav className="rail">
          <button className={view === 'home' ? 'on' : ''} title="Get data" onClick={() => setView('home')}>⌂</button>
          <button className={view === 'report' ? 'on' : ''} title="Report view" disabled={!hasData} onClick={() => setView('report')}>📊</button>
          <button className={view === 'data' ? 'on' : ''} title="Data view" disabled={!hasData} onClick={() => setView('data')}>▦</button>
          <button className={view === 'model' ? 'on' : ''} title="Model & measures (DAX)" disabled={!hasData} onClick={() => setView('model')}>ƒ</button>
          <button className={view === 'settings' ? 'on' : ''} title="Settings & manual inputs" onClick={() => setView('settings')}>⚙</button>
          <button className={view === 'guide' ? 'on' : ''} title="Step-by-step guide" onClick={() => setView('guide')}>?</button>
        </nav>

        <main className="canvas">
          {view === 'home' && (
            <Home files={homeFiles} supportsLive={hasFSA} hasData={hasData} needReconnect={needReconnect} onReconnect={reconnect}
              onFiles={(fs) => addFiles(fs.map((file) => ({ file })))} onDropItems={(x) => addFiles(x)} onPick={pick} onOpenDashboard={() => setView('report')}
              onClearFile={(n) => setFiles((c) => { const x = c.filter((f) => f.name !== n); persist(x); return x; })}
              onSetKind={(n, k) => setFiles((c) => { const x = c.map((f) => (f.name === n ? { ...f, kind: k } : f)); persist(x); return x; })} />
          )}
          {view !== 'home' && (
            <div className="page" ref={pageRef}>
              {view === 'report' && hasData && (
                <>
                  <div className="page-head"><div><h1>{page}</h1><div className="sub">{PAGE_SUB[page]} · {a.company}</div></div>
                    {fySel.length > 0 && <div className="small">Filtered: {fySel.join(', ')} <button className="btn small" onClick={() => setFySel([])}>Clear filter</button></div>}</div>
                  {renderPage(page, ctx)}
                </>
              )}
              {view === 'data' && hasData && <DataView {...ctx} />}
              {view === 'model' && hasData && <Measures {...ctx} measures={measures} setMeasures={setMeasures} />}
              {view === 'settings' && <Settings {...ctx} />}
              {view === 'guide' && <Guide />}
              {!hasData && (view === 'report' || view === 'data' || view === 'model') && <div className="note">Load files from <b>Get data</b> first.</div>}
            </div>
          )}
        </main>

        <aside className={`pane ${pane ? '' : 'closed'}`}>
          {pane ? (
            <>
              <div className="pane-head">Filters <button onClick={() => setPane(false)} title="Collapse">»</button></div>
              <div className="pane-body">
                <div className="filter-card">
                  <h4>Financial year {fySel.length > 0 && <button className="clear" onClick={() => setFySel([])}>clear</button>}</h4>
                  {allFYs.map((f) => <label key={f}><input type="checkbox" checked={fySel.includes(f)} onChange={() => toggleFY(f)} />{f}</label>)}
                  {!allFYs.length && <div className="small muted">No data loaded</div>}
                  <div className="small muted" style={{ marginTop: 4 }}>{fySel.length ? `${fySel.length} selected` : 'All years'}</div>
                </div>
                <div className="filter-card">
                  <h4>Data sources</h4>
                  {(['financial', 'gst', 'banking'] as const).map((k) => {
                    const f = files.find((x) => x.kind === k);
                    return <div key={k} className="small" style={{ padding: '3px 0' }}>{f ? '✅' : '⬜'} {k === 'financial' ? 'Financials' : k === 'gst' ? 'GST' : 'Banking'} {f && <span className="muted">· {f.handle ? 'live' : 'static'}</span>}</div>;
                  })}
                </div>
                {hasData && (
                  <div className="filter-card">
                    <h4>Credit score</h4>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>{a.risk.overall.score ?? '—'}<span className="small muted">/100</span></div>
                    <div className="small">{a.risk.overall.risk} risk · {a.risk.decision.decision}</div>
                  </div>
                )}
              </div>
            </>
          ) : <button className="icon-btn" style={{ margin: 6 }} onClick={() => setPane(true)} title="Filters">«</button>}
        </aside>
      </div>

      <div className="tabs">
        {view === 'report' && hasData ? PAGES.map((p) => <button key={p} className={`tab ${p === page ? 'on' : ''}`} onClick={() => setPage(p)}>{p}</button>) : <span className="small muted" style={{ paddingLeft: 8 }}>{view === 'home' ? 'Get data' : view === 'data' ? 'Data view' : view === 'model' ? 'Model' : view === 'settings' ? 'Settings' : 'Guide'}</span>}
        <span className="statusbar">{view === 'report' && hasData ? `Page ${PAGES.indexOf(page) + 1} of ${PAGES.length} · ` : ''}{files.length} file(s) · processed locally</span>
      </div>

      <input ref={fileInput} type="file" multiple accept=".xlsx,.xlsm,.xls,.csv" hidden onChange={(e) => { if (e.target.files) addFiles([...e.target.files].map((file) => ({ file }))); e.target.value = ''; }} />
      {(toast || busy) && <div className="toast">{busy || toast}</div>}

      {exporting && (
        <ExportMode.Provider value={true}><div className="export-root" ref={exportRef}>
          <div className="page export-sec" data-title="Cover">
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '30px 10px' }}>
              <img src={logoFull} alt="" style={{ width: 420 }} />
              <div><h1 style={{ margin: 0 }}>Integrated Financial, GST, Banking & Credit Analysis Report</h1><h2 style={{ margin: '8px 0', fontWeight: 500 }}>{a.company}</h2>
                <div className="muted">Generated {new Date().toLocaleString('en-IN')} · Overall AI credit score {a.risk.overall.score ?? '—'}/100 · {a.risk.decision.decision}</div></div>
            </div>
          </div>
          {PAGES.filter((p) => p !== 'My Visuals' || visuals.length).map((p) => (
            <div key={p} className="page export-sec" data-title={p}>
              <div className="page-head"><div><h1>{p}</h1><div className="sub">{PAGE_SUB[p]} · {a.company}</div></div></div>
              {renderPage(p, { ...ctx, themeKey, exporting: true })}
            </div>
          ))}
        </div></ExportMode.Provider>
      )}
    </div>
  );
}
