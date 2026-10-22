import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { safeAnalyse, effectiveDataset } from './engine/analyse';
import { DEFAULT_INPUTS, type ManualInputs, type Dataset } from './engine/types';
import { buildDatasetFromFiles, autoInputs, mergeInputs, selectSources } from './engine/ingest/pack';
import { browserPdfLoader } from './ui/pdfLoader';
import { type Incoming, ACCEPT, fromFileList, pickDirectory } from './ui/fileIntake';
import { LoanFile } from './ui/pages/LoanFile';
import { Swot } from './ui/pages/Swot';
import { Assistant } from './ui/Assistant';
import { buildEvidence } from './engine/evidence';
import { PageGuard } from './ui/PageGuard';
import { readWorkbook, detectKind, type FileKind } from './engine/workbook';
import { buildInWorker, detectKindsInWorker } from './ui/workerClient';
import { sortFYs, fyOfMonth, monthLabel } from './engine/utils';
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
import { ExportMode, HideCtx, HideBox, useSectionHiding, DisclaimerInExport, DISCLAIMER, type HideState } from './ui/common';
import logoFull from './assets/logo-full.png';
import logoIcon from './assets/logo-icon.png';
import { exportHtml, readEmbedded, b64ToBuffer, type EmbeddedSnapshot } from './ui/htmlExport';

interface StoredFile extends LoadedFile { buffer: ArrayBuffer }
type View = 'home' | 'report' | 'data' | 'model' | 'settings' | 'guide';
const PAGES = ['Overview', 'Financials', 'Ratios', 'Working Capital', 'GST', 'Banking', 'Reconciliation', 'Ageing & Bureau', 'Risk & SWOT', 'SWOT', 'Credit Decision', 'Loan File', 'My Visuals'] as const;
type Page = (typeof PAGES)[number];
/* tab captions carry the section numbers of the 40-section report format */
const TAB_LABEL: Partial<Record<Page, string>> = {
  Overview: '1–2 Overview', Financials: '3 Financials', Ratios: '4 Ratios', 'Working Capital': '5 Working Capital', GST: '6–13 GST', Banking: '14–25 Banking',
  Reconciliation: '26–28 Reconciliation', 'Ageing & Bureau': '29–30 Ageing & Bureau', 'Risk & SWOT': '31–35 Risk & Score', SWOT: '34 SWOT (evidence)', 'Credit Decision': '36–40 Credit Decision',
};
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
  SWOT: 'Automatic SWOT — evidence, severity and recommendations · download as PDF / Excel',
  'Loan File': 'Every document received — inventory, statement coverage, GSTR-3B, loans, bureau, ageing, Tally ledgers',
  'My Visuals': 'Build your own visuals from the cleaned data and measures',
};
const EMPTY_DS: Dataset = { financial: null, gst: null, banking: null, files: [], log: [] };
const EXCEL_RE = /\.(xlsx|xlsm|xls|csv)$/i;

const hasFSA = typeof window !== 'undefined' && 'showOpenFilePicker' in window && window.self === window.top;

export default function App() {
  const [files, setFiles] = useState<StoredFile[]>([]);
  const [inp, setInpState] = useState<ManualInputs>(() => ({ ...DEFAULT_INPUTS, ...lsGet('ingoviq.inputs', DEFAULT_INPUTS) }));
  const [builtDs, setBuiltDs] = useState<Dataset>(EMPTY_DS);
  const [frozenDs, setFrozenDs] = useState<Dataset | null>(null);
  const [customize, setCustomize] = useState(false);
  const [progress, setProgress] = useState('');
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
  const [exportPages, setExportPages] = useState<Page[] | null>(null);
  const exporting = !!exportPages;
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [needReconnect, setNeedReconnect] = useState(false);
  const [snapshot, setSnapshot] = useState<EmbeddedSnapshot | null>(null);
  const pageRef = useRef<HTMLDivElement>(null);
  const exportRef = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const folderInput = useRef<HTMLInputElement>(null);

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
      if (emb.dataset) setFrozenDs(emb.dataset);
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

  /** replaceAll: a folder / zip is a new loan file, so it replaces whatever was loaded before */
  const addFiles = useCallback(async (list: Incoming[], replaceAll = false) => {
    if (!list.length) return;
    setBusy(`Reading ${list.length} file(s)…`);
    const added: StoredFile[] = [];
    for (const { file, handle, path } of list) {
      if (/(^|\/)(\.DS_Store|Thumbs\.db|desktop\.ini)$|(^|\/)\._/i.test(path)) continue;
      const buffer = await file.arrayBuffer();
      added.push({ name: path || file.name, size: file.size, kind: 'unknown', handle, lastModified: file.lastModified, buffer });
    }
    // report kind of each Excel file — read in a background worker so the page stays responsive
    const xl = added.filter((f) => EXCEL_RE.test(f.name));
    const kinds = await (detectKindsInWorker(xl.map((f) => ({ name: f.name, data: f.buffer })))?.catch(() => null) ?? Promise.resolve(null));
    xl.forEach((f, i) => {
      let kind: FileKind = kinds?.[i] ?? 'unknown';
      if (!kinds) try { kind = detectKind(readWorkbook(f.buffer, f.name)); } catch { /* reported in cleaning log */ }
      f.kind = kind;
    });
    const pack = replaceAll || added.length > 3 || added.some((f) => /\.(zip|pdf)$/i.test(f.name));
    setFiles((cur) => {
      // a new file of the same kind replaces the old one (next company / new version); a folder / zip replaces everything
      const kept = pack && replaceAll ? [] : cur.filter((c) => !added.some((a) => a.name === c.name || (a.kind !== 'unknown' && a.kind === c.kind)));
      const next = [...kept, ...added];
      persist(next);
      return next;
    });
    setBusy('');
    setSnapshot(null);
    setFrozenDs(null);
    setLastRefresh(new Date());
    say(added.length > 3 ? `Loaded ${added.length} files — building the report…` : `Loaded ${added.map((a) => `${a.name} (${a.kind})`).join(', ')}`);
  }, [say]);

  const pickFolder = async () => {
    try {
      const got = await pickDirectory();
      if (got) { await addFiles(got, true); setNeedReconnect(false); return; }
    } catch (e) { if ((e as Error).name === 'AbortError') return; }
    folderInput.current?.click();
  };

  const pick = async () => {
    if (!hasFSA) { fileInput.current?.click(); return; }
    try {
      const handles: FileSystemFileHandle[] = await (window as unknown as { showOpenFilePicker: (o: object) => Promise<FileSystemFileHandle[]> }).showOpenFilePicker({ multiple: true, types: [{ description: 'Excel, PDF or zip', accept: { 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': ['.xlsx', '.xlsm'], 'application/vnd.ms-excel': ['.xls'], 'text/csv': ['.csv'], 'application/pdf': ['.pdf'], 'application/zip': ['.zip'] } }] });
      await addFiles(await Promise.all(handles.map(async (h) => { const file = await h.getFile(); return { file, path: file.name, handle: h }; })));
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

  // build the dataset (async: PDFs are read with pdf.js); a newer build cancels an older one
  const pwKey = (inp.pdfPasswords || []).join('\u0001');
  useEffect(() => {
    let cancelled = false;
    if (!files.length) { setBuiltDs(EMPTY_DS); return; }
    const many = files.length > 3 || files.some((f) => /\.(zip|pdf)$/i.test(f.name));
    if (many) setProgress('Reading files…');
    const packFiles = files.map((f) => ({ path: f.name, data: f.buffer, size: f.size, forceKind: EXCEL_RE.test(f.name) && f.kind !== 'unknown' ? f.kind : undefined }));
    const onProgress = (d: number, t: number, path: string) => { if (!cancelled && many) setProgress(d < t ? `Reading ${d + 1} of ${t}: ${path.split('/').pop()}` : 'Calculating…'); };
    const mainThread = () => buildDatasetFromFiles(packFiles, browserPdfLoader, { passwords: inp.pdfPasswords, onProgress });
    // Excel-only loan files are read in a background worker (no UI freeze); PDFs need pdf.js on the main thread
    const excelOnly = files.every((f) => EXCEL_RE.test(f.name));
    if (!many) setProgress('Reading files…');
    (excelOnly ? (buildInWorker(packFiles, inp.pdfPasswords, onProgress)?.catch(() => mainThread()) ?? mainThread()) : mainThread()).then((d) => { if (!cancelled) { setBuiltDs(d); setProgress(''); } })
      .catch((e) => { if (!cancelled) { setProgress(''); say(`Could not build the report: ${(e as Error).message}`); } });
    return () => { cancelled = true; };
  }, [files, pwKey, say]); // eslint-disable-line react-hooks/exhaustive-deps

  const dsAll = frozenDs || builtDs;
  // Data-source tick boxes in the Filters pane: an unticked source is left out of every calculation
  const excluded = useMemo(() => inp.excludedSources || [], [inp.excludedSources]);
  const ds0 = useMemo(() => selectSources(dsAll, excluded), [dsAll, excluded]);
  const auto = useMemo(() => autoInputs(ds0), [ds0]);
  const effInp = useMemo(() => mergeInputs({ ...DEFAULT_INPUTS, ...inp }, auto, DEFAULT_INPUTS), [inp, auto]);
  const ds = useMemo(() => effectiveDataset(ds0, effInp), [ds0, effInp]);
  const a = useMemo(() => safeAnalyse(ds, effInp), [ds, effInp]);
  const hidden = effInp.hidden || [];
  const toggleHidden = useCallback((k: string) => setInpState((s) => { const h = s.hidden || []; const n = { ...s, hidden: h.includes(k) ? h.filter((x) => x !== k) : [...h, k] }; lsSet('ingoviq.inputs', n); return n; }), []);
  const hideFor = (p: string, exp = false): HideState => ({ page: p, hidden, customize: customize && !exp, toggle: toggleHidden });
  // only the reports the uploaded files can feed get a tab
  const pageHasData = (p: Page): boolean => {
    const x = ds.extra;
    switch (p) {
      case 'Financials': case 'Ratios': case 'Working Capital': return !!ds.financial;
      case 'GST': return !!ds.gst;
      case 'Banking': return !!ds.banking;
      case 'Reconciliation': return [ds.financial, ds.gst, ds.banking].filter(Boolean).length >= 2;
      case 'Ageing & Bureau': return !!(x && (x.ageing.length || x.cibil.length)) || effInp.ageing.some((b) => b.receivable || b.payable) || effInp.cibilScore !== null || effInp.cmrRank !== null;
      case 'Loan File': return !!(ds.docs && ds.docs.some((d) => !/analysis report/i.test(d.type)));
      default: return true;
    }
  };
  const availablePages = PAGES.filter(pageHasData);
  const visiblePages = availablePages.filter((p) => customize || !hidden.includes(`page:${p}`));
  useEffect(() => { if (view === 'report' && visiblePages.length && !visiblePages.includes(page)) setPage(visiblePages[0]); }, [visiblePages.join('|'), view]); // eslint-disable-line react-hooks/exhaustive-deps
  useSectionHiding(pageRef, [page, view, hidden, customize, ds]);
  useSectionHiding(exportRef, [exporting, hidden]);
  const hasData = !!(ds.financial || ds.gst || ds.banking || ds.docs?.length);
  const allFYs = useMemo(() => sortFYs(new Set([...(a.fin?.fys || []), ...(a.gst?.fys || []), ...(a.bank?.months || []).map(fyOfMonth)])), [a]);
  const toggleFY = useCallback((fy: string) => { if (!/^FY /.test(fy)) return; setFySel((s) => (s.includes(fy) ? s.filter((x) => x !== fy) : [...s, fy])); }, []);
  const ctx: PageCtx = { a, ds, inp: effInp, setInp, fySel, toggleFY, themeKey };

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
      case 'Loan File': return <LoanFile {...c} />;
      case 'SWOT': return <Swot {...c} />;
      case 'My Visuals': return <MyVisuals {...c} visuals={visuals} setVisuals={setVisuals} measures={measures} />;
    }
  };

  const doPdf = async (only?: Page) => {
    if (!hasData) return;
    setExportPages(only ? [only] : availablePages.filter((p) => (p !== 'My Visuals' || visuals.length) && !hidden.includes(`page:${p}`)));
    setBusy(only ? `Preparing ${only} PDF…` : 'Preparing PDF report…');
    await new Promise((r) => setTimeout(r, 1500)); // let every chart render in light theme
    try {
      exportRef.current?.querySelectorAll('details').forEach((d) => { (d as HTMLDetailsElement).open = true; });
      await new Promise((r) => setTimeout(r, 300));
      const secs = [...(exportRef.current?.querySelectorAll<HTMLElement>('.export-sec') || [])];
      await exportPdf(secs, a.company, setBusy, only, !!effInp.pdfDisclaimer);
      say(only ? `${only} PDF downloaded` : 'PDF report downloaded');
    } catch (e) { say(`PDF export failed: ${(e as Error).message}`); }
    setExportPages(null);
    setBusy('');
  };

  const doReport = async () => {
    if (!hasData) return;
    setBusy('Building the credit analysis report…');
    try {
      const [{ buildCreditReport }, { chartImage, toDataUrl }] = await Promise.all([import('./ui/report/creditReport'), import('./ui/report/chartImage')]);
      const pdf = await buildCreditReport(a, ds, effInp, { includeDisclaimer: !!effInp.pdfDisclaimer, minPages: 50, maxPages: 70, chartImage, logo: await toDataUrl(logoFull), onProgress: setBusy });
      pdf.save(`INGOVIZ_Credit_Analysis_Report_${a.company.replace(/[^\w]+/g, '_').slice(0, 40)}_${new Date().toISOString().slice(0, 10)}.pdf`);
      say(`Credit analysis report downloaded (${pdf.getNumberOfPages()} pages)`);
    } catch (e) { say(`Report failed: ${(e as Error).message}`); console.error(e); }
    setBusy('');
  };

  const doPowerBi = async () => {
    try {
      const { buildPowerBiProject } = await import('./ui/report/powerbi');
      const r = buildPowerBiProject(a, ds, effInp);
      const el = document.createElement('a');
      el.href = URL.createObjectURL(r.blob); el.download = r.fileName; document.body.appendChild(el); el.click(); el.remove();
      setTimeout(() => URL.revokeObjectURL(el.href), 10000);
      say(`Power BI project downloaded (${r.tables} tables, ${r.rows.toLocaleString('en-IN')} rows) — unzip and double-click the .pbip file`);
    } catch (e) { say(`Power BI export failed: ${(e as Error).message}`); }
  };

  const doHtml = async () => {
    setBusy('Building interactive HTML…');
    try {
      const size = await exportHtml(files, a.company, inp, visuals, measures, ds0);
      say(`Interactive HTML downloaded (${(size / 1048576).toFixed(1)} MB) — open it in any browser, works offline`);
    } catch (e) { say(`HTML export failed: ${(e as Error).message}`); }
    setBusy('');
  };

  const clearAll = () => {
    if (!confirm('Remove all loaded files from this browser?')) return;
    setFiles([]); persist([]); setView('home'); setFySel([]); setFrozenDs(null); setSnapshot(null);
  };

  // data sources, from what was actually read out of the uploaded files
  const span = (ms: string[]) => (ms.length ? `${monthLabel(ms[0])} → ${monthLabel(ms[ms.length - 1])}` : '');
  const docsOf = (re: RegExp) => (ds.docs || []).filter((d) => d.status === 'used' && re.test(d.type));
  const fileNames = (re: RegExp, kind: string) => [...docsOf(re).map((d) => d.path.split('/').pop() || d.path), ...files.filter((f) => f.kind === kind).map((f) => f.name)];
  const sources = [
    { key: 'financial', label: 'Financials', ok: !!ds.financial, live: files.some((f) => f.kind === 'financial' && f.handle), files: fileNames(/financial/i, 'financial'),
      detail: ds.financial ? `${ds.financial.fys.join(', ') || 'no years'}${!ds0.financial && ds.financial ? ' · typed in Data view' : ''}` : (ds.docs || []).some((d) => d.status === 'scanned' && /financial|itr/i.test(d.type)) ? 'Scanned PDFs only — add years in Data view' : '' },
    { key: 'gst', label: 'GST', ok: !!ds.gst, live: files.some((f) => f.kind === 'gst' && f.handle), files: fileNames(/gst/i, 'gst'),
      detail: ds.gst ? `${ds.gst.gstins.length} GSTIN · ${span(ds.gst.months)}${ds.extra?.gstr3b.length ? ` · ${ds.extra.gstr3b.length} GSTR-3B` : ''}` : '' },
    { key: 'banking', label: 'Banking', ok: !!ds.banking, live: files.some((f) => f.kind === 'banking' && f.handle), files: fileNames(/bank/i, 'banking'),
      detail: ds.banking ? `${ds.banking.accounts.length || new Set(ds.banking.txns.map((t) => t.account)).size} account(s) · ${ds.banking.txns.length.toLocaleString('en-IN')} txns · ${span(ds.banking.months)}` : '' },
    ...(dsAll.extra && dsAll.docs?.length ? [
      { key: 'bureau', label: 'CIBIL / CMR', ok: (ds.extra?.cibil.length ?? 0) > 0, live: false, files: fileNames(/cibil/i, '-'), detail: (ds.extra?.cibil || []).map((c) => (c.kind === 'commercial' ? `CMR-${c.cmr ?? '?'}` : `${c.score ?? '?'}`)).join(' · ') },
      { key: 'ledgers', label: 'Ledgers / ageing', ok: (ds.extra?.ledgerParties.length ?? 0) + (ds.extra?.ageing.length ?? 0) + (ds.extra?.momSales.length ?? 0) > 0, live: false, files: fileNames(/ledger|ageing|mom/i, '-'), detail: [ds.extra?.ledgerParties.length ? `${ds.extra.ledgerParties.length} Tally parties` : '', ds.extra?.ageing.length ? `${ds.extra.ageing.length} ageing file(s)` : ''].filter(Boolean).join(' · ') },
      { key: 'loans', label: 'Loans & net worth', ok: (ds.extra?.loans.length ?? 0) + (ds.extra?.networth.length ?? 0) > 0, live: false, files: fileNames(/loan|net-worth/i, '-'), detail: [ds.extra?.loans.length ? `${ds.extra.loans.length} loans` : '', ds.extra?.networth.length ? `${ds.extra.networth.length} net-worth cert.` : ''].filter(Boolean).join(' · ') },
    ] : []),
  ];

  const homeFiles: LoadedFile[] = files.map(({ buffer: _b, ...f }) => f); // eslint-disable-line @typescript-eslint/no-unused-vars
  const liveCapable = files.some((f) => f.handle);

  return (
    <div className="app">
      <div className="titlebar">
        <div className="brand" title="INGOVIZ AI by INGOVIQ AI"><img src={logoIcon} alt="INGOVIQ AI" />INGOVIZ <span className="ai">AI</span><span className="by">by INGOVIQ AI</span></div>
        <div className="doc">{hasData ? `${a.company}` : 'Untitled'} {snapshot && <span className="chip warn" style={{ margin: '0 6px' }} title="Data is embedded in this HTML file. Use Get data / Refresh to load newer Excel files.">Offline snapshot</span>}{lastRefresh && <span>· {snapshot ? 'data as of' : 'refreshed'} {lastRefresh.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>}</div>
        {liveCapable && live && !needReconnect && <span className="small" style={{ display: 'flex', alignItems: 'center', gap: 6 }}><span className="live-dot" /> Live</span>}
        <button className="tb-btn" onClick={() => setTheme(theme === 'light' ? 'dark' : theme === 'dark' ? 'auto' : 'light')} title="Theme">{theme === 'light' ? '☀ Light' : theme === 'dark' ? '☾ Dark' : '◐ Auto'}</button>
      </div>

      <div className="ribbon">
        <div className="group">
          <button className="rb" onClick={() => { setView('home'); }}><span className="ic">📥</span>Get data</button>
          <button className="rb" onClick={pick}><span className="ic">📂</span>Files</button>
          <button className="rb" onClick={pickFolder} title="Load a whole loan-file folder (all sub-folders)"><span className="ic">🗂</span>Folder</button>
          <button className="rb" disabled={!files.length} onClick={refresh}><span className="ic">⟳</span>Refresh</button>
          <button className={`rb ${live && liveCapable ? 'on' : ''}`} disabled={!liveCapable} onClick={() => setLive(!live)} title={liveCapable ? 'Auto-refresh when the Excel file is saved' : 'Open files with Get data in Chrome/Edge to enable'}><span className="ic">{live && liveCapable ? '🟢' : '⚪'}</span>Live</button>
          <button className="rb" disabled={!files.length} onClick={clearAll}><span className="ic">🗑</span>Clear</button>
        </div>
        <div className="group">
          <button className="rb" disabled={!hasData} onClick={() => { setView('report'); setPage('My Visuals'); }}><span className="ic">📊</span>New visual</button>
          <button className="rb" disabled={!hasData} onClick={() => setView('model')}><span className="ic">ƒx</span>New measure</button>
          <button className="rb" disabled={!hasData} onClick={() => setView('data')}><span className="ic">▦</span>Transform data</button>
          <button className={`rb ${customize ? 'on' : ''}`} disabled={!hasData} onClick={() => { setCustomize(!customize); if (!customize) setView('report'); }} title="Tick / untick pages, sections and visuals to show or hide them — also in PDF and HTML"><span className="ic">☑</span>Show / hide</button>
        </div>
        <div className="group">
          <button className="rb" disabled={!hasData} onClick={doReport} title="Credit Analysis Report (sections 1–40) — searchable PDF, 50–70 pages, every figure with its evidence"><span className="ic">📑</span>Credit report</button>
          <button className="rb" disabled={!hasData} onClick={() => doPdf()} title="Dashboard as it looks on screen — every visible page"><span className="ic">📄</span>Dashboard PDF</button>
          <button className="rb" disabled={!hasData} onClick={() => exportExcel(a, ds, measures, hidden)}><span className="ic">📗</span>Excel</button>
          <button className="rb" disabled={!hasData} onClick={doPowerBi} title="Power BI Desktop project (.pbip) with the reconciled data and a ready dashboard — unzip and double-click"><span className="ic">📊</span>Power BI</button>
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
              onFiles={(fs) => addFiles(fromFileList(fs))} onDropItems={(x, isFolder) => addFiles(x, isFolder)} onPick={pick} onPickFolder={pickFolder} onOpenDashboard={() => setView('report')}
              progress={progress} docs={ds.docs || []} passwords={inp.pdfPasswords || []} onPasswords={(p) => setInp({ pdfPasswords: p })}
              onClearFile={(n) => setFiles((c) => { const x = c.filter((f) => f.name !== n); persist(x); return x; })}
              onSetKind={(n, k) => setFiles((c) => { const x = c.map((f) => (f.name === n ? { ...f, kind: k } : f)); persist(x); return x; })} />
          )}
          {view !== 'home' && (
            <div className="page" ref={pageRef}>
              {view === 'report' && hasData && (
                <>
                  <div className="page-head"><div><h1>{page}</h1><div className="sub">{PAGE_SUB[page]} · {a.company}</div></div>
                    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                      {fySel.length > 0 && <span className="small">Filtered: {fySel.join(', ')} <button className="btn small" onClick={() => setFySel([])}>Clear filter</button></span>}
                      <button className="btn small" title={`Download only the ${page} report as PDF`} onClick={() => (page === 'SWOT' ? import('./ui/report/swotExport').then((m) => m.swotPdf(a.company, a.swot, buildEvidence(ds).items, !!effInp.pdfDisclaimer, DISCLAIMER)) : doPdf(page))}>⤓ {page} PDF</button>
                      <button className="btn small" title={`Download only the ${page} data as Excel`} onClick={() => (page === 'SWOT' ? import('./ui/report/swotExport').then((m) => m.swotExcel(a.company, a.swot, buildEvidence(ds).items)) : exportExcel(a, ds, measures, hidden, page))}>⤓ {page} Excel</button>
                      <button className="btn small" title="Save this page as an image" onClick={() => pageRef.current && exportPng(pageRef.current, `${a.company}_${page}`)}>⤓ PNG</button>
                    </div></div>
                  {customize && (
                    <div className="note customize-bar">
                      <b>Show / hide mode.</b> Untick a page tab, a section title or a visual to hide it from the dashboard, the PDF report and the HTML export. Hidden items stay dimmed here so you can tick them back.
                      <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
                        {hidden.length > 0 && <button className="btn small" onClick={() => setInp({ hidden: [] })}>Show everything ({hidden.length} hidden)</button>}
                        <button className="btn small primary" onClick={() => setCustomize(false)}>Done</button>
                      </span>
                    </div>
                  )}
                  {hidden.includes(`page:${page}`) && <div className="note warn">This page is hidden — it is left out of the tab bar, PDF and HTML. <button className="btn small" onClick={() => toggleHidden(`page:${page}`)}>Show page</button></div>}
                  <HideCtx.Provider value={hideFor(page)}><PageGuard name={page}>{renderPage(page, ctx)}</PageGuard></HideCtx.Provider>
                </>
              )}
              {view === 'data' && hasData && <PageGuard name="Data view"><DataView {...ctx} /></PageGuard>}
              {view === 'model' && hasData && <PageGuard name="Model"><Measures {...ctx} measures={measures} setMeasures={setMeasures} /></PageGuard>}
              {view === 'settings' && <PageGuard name="Settings"><Settings {...ctx} /></PageGuard>}
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
                  {sources.map((x) => {
                    const off = excluded.includes(x.key);
                    return (
                      <label key={x.label} className="small src-row" style={{ padding: '3px 0', display: 'block', cursor: x.ok || off ? 'pointer' : 'default', opacity: x.ok || off ? 1 : 0.6 }} title={(x.ok || off) ? `${off ? 'Tick to use' : 'Untick to leave out'} ${x.label} in every page${x.files.length ? '\n\n' + x.files.slice(0, 30).join('\n') : ''}` : 'No file of this type uploaded'}>
                        <input type="checkbox" disabled={!x.ok && !off} checked={x.ok && !off} onChange={() => setInp({ excludedSources: off ? excluded.filter((k) => k !== x.key) : [...excluded, x.key] })} style={{ marginRight: 6 }} />
                        <b style={{ fontWeight: 600 }}>{x.label}</b>{x.live && <span className="muted"> · live</span>}{off && <span className="muted"> · left out</span>}
                        {(x.detail || off) && <div className="muted" style={{ paddingLeft: 22, fontSize: 11 }}>{off ? 'Not used in the report — tick to include' : x.detail}</div>}
                      </label>
                    );
                  })}
                  {!files.length && <div className="small muted">No files loaded</div>}
                  {files.length > 0 && <div className="small muted" style={{ marginTop: 4 }}>{ds.docs?.length || files.length} file(s){progress ? ' · reading…' : ''}</div>}
                </div>
                {hasData && (
                  <div className="filter-card">
                    <h4>Credit score</h4>
                    <div style={{ fontSize: 22, fontWeight: 700 }}>{a.risk.overall.score ?? '—'}<span className="small muted">/100</span></div>
                    <div className="small">{a.risk.overall.risk} risk · {a.risk.decision.decision}</div>
                    <div className="small muted" style={{ marginTop: 4 }}>Based on {a.risk.overall.covered} of {a.risk.scores.length} dimensions</div>
                    {a.risk.overall.covered < 5 && <div className="small" style={{ marginTop: 4, color: 'var(--warn-text, #8a5a00)' }}>▲ Provisional — upload financials, GST and banking for a reliable score</div>}
                  </div>
                )}
              </div>
            </>
          ) : <button className="icon-btn" style={{ margin: 6 }} onClick={() => setPane(true)} title="Filters">«</button>}
        </aside>
      </div>

      <div className="tabs">
        {view === 'report' && hasData ? visiblePages.map((p) => <button key={p} className={`tab ${p === page ? 'on' : ''} ${hidden.includes(`page:${p}`) ? 'tab-hidden' : ''}`} onClick={() => setPage(p)}>{customize && <HideCtx.Provider value={hideFor(p)}><HideBox k={`page:${p}`} /></HideCtx.Provider>}{TAB_LABEL[p] || p}</button>) : <span className="small muted" style={{ paddingLeft: 8 }}>{view === 'home' ? 'Get data' : view === 'data' ? 'Data view' : view === 'model' ? 'Model' : view === 'settings' ? 'Settings' : 'Guide'}</span>}
        <span className="statusbar">{view === 'report' && hasData ? `Page ${visiblePages.indexOf(page) + 1} of ${visiblePages.length} · ` : ''}{files.length} file(s) · processed locally</span>
      </div>

      <input ref={fileInput} type="file" multiple accept={ACCEPT} hidden onChange={(e) => { if (e.target.files) addFiles(fromFileList(e.target.files)); e.target.value = ''; }} />
      <input ref={folderInput} type="file" multiple hidden {...{ webkitdirectory: '', directory: '' }} onChange={(e) => { if (e.target.files) addFiles(fromFileList(e.target.files), true); e.target.value = ''; }} />
      {hasData && !exporting && <Assistant a={a} ds={ds} inp={effInp} />}
      {(toast || busy || progress) && <div className="toast">{busy || progress || toast}</div>}

      {exportPages && (
        <ExportMode.Provider value={true}><DisclaimerInExport.Provider value={!!effInp.pdfDisclaimer}><div className="export-root" ref={exportRef}>
          {exportPages.length > 1 && <div className="page export-sec" data-title="Cover">
            <div style={{ display: 'flex', alignItems: 'center', gap: 24, padding: '30px 10px' }}>
              <img src={logoFull} alt="" style={{ width: 420 }} />
              <div><h1 style={{ margin: 0 }}>Integrated Financial, GST, Banking & Credit Analysis Report</h1><h2 style={{ margin: '8px 0', fontWeight: 500 }}>{a.company}</h2>
                <div className="muted">Generated {new Date().toLocaleString('en-IN')} · Overall AI credit score {a.risk.overall.score ?? '—'}/100 · {a.risk.decision.decision}</div>
                <div className="muted small" style={{ marginTop: 8 }}>Contents: {exportPages.join(' · ')}</div></div>
            </div>
          </div>}
          {exportPages.map((p) => (
            <div key={p} className="page export-sec" data-title={p}>
              <div className="page-head"><div><h1>{p}</h1><div className="sub">{PAGE_SUB[p]} · {a.company}</div></div></div>
              <HideCtx.Provider value={hideFor(p, true)}><PageGuard name={p}>{renderPage(p, { ...ctx, themeKey, exporting: true })}</PageGuard></HideCtx.Provider>
            </div>
          ))}
        </div></DisclaimerInExport.Provider></ExportMode.Provider>
      )}
    </div>
  );
}
