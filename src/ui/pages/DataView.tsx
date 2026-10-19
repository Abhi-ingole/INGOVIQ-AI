import { useState } from 'react';
import type { PageCtx } from '../ctx';
import { Table, Chip } from '../common';
import { ITEM_LABELS } from '../../engine/parseFinancial';
import { fmtINR, fmtDate } from '../../engine/format';
import { monthLabel } from '../../engine/utils';

const TABS = ['Financial line items', 'Source rows', 'GST monthly', 'GST customers', 'GST suppliers', 'GST filings', 'Bank transactions', 'Cleaning log'] as const;

export function DataView({ a, ds, inp, setInp }: PageCtx) {
  const [tab, setTab] = useState<(typeof TABS)[number]>('Financial line items');
  const [q, setQ] = useState('');
  const fin = ds.financial;
  const setOv = (key: string, fy: string, v: string) => {
    const cur = { ...(inp.financialOverrides[key] || {}) };
    if (v.trim() === '') delete cur[fy]; else cur[fy] = Number(v.replace(/,/g, ''));
    setInp({ financialOverrides: { ...inp.financialOverrides, [key]: cur } });
  };
  const filt = <T,>(rows: T[], f: (r: T) => string) => (q ? rows.filter((r) => f(r).toLowerCase().includes(q.toLowerCase())) : rows);
  return (
    <>
      <div className="page-head">
        <div><h1>Data view</h1><div className="sub">Cleaned tables produced automatically from your files — like Power Query output. Edit a financial value to override it; every page recalculates.</div></div>
        <input placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ padding: '6px 10px', border: '1px solid var(--border-strong)', borderRadius: 6, background: 'var(--surface)', width: 240 }} />
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>{TABS.map((t) => <button key={t} className={`btn small ${t === tab ? 'primary' : ''}`} onClick={() => setTab(t)}>{t}</button>)}</div>

      {tab === 'Financial line items' && (fin ? (
        <div className="tbl-wrap" style={{ maxHeight: 640 }}>
          <table className="tbl">
            <thead><tr><th>Line item</th>{fin.fys.map((f) => <th key={f} className="num">{f} (source)</th>)}{fin.fys.map((f) => <th key={'o' + f} className="num">{f} override</th>)}</tr></thead>
            <tbody>
              {Object.keys(ITEM_LABELS).filter((k) => ITEM_LABELS[k].toLowerCase().includes(q.toLowerCase())).map((k) => (
                <tr key={k}>
                  <td>{ITEM_LABELS[k]} {!fin.items[k] && <Chip s="not found" tone="neutral" />}{inp.financialOverrides[k] && Object.keys(inp.financialOverrides[k]).length > 0 && <Chip s="overridden" tone="warn" />}</td>
                  {fin.fys.map((f) => <td key={f} className="num">{fmtINR(fin.items[k]?.[f])}</td>)}
                  {fin.fys.map((f) => <td key={'o' + f} className="num"><input className="cell" placeholder="—" value={inp.financialOverrides[k]?.[f] ?? ''} onChange={(e) => setOv(k, f, e.target.value)} /></td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <div className="note warn">Financial file not loaded.</div>)}

      {tab === 'Source rows' && fin && (
        <Table rows={filt(fin.rawRows, (r) => r.label + r.sheet)} maxHeight={640} cols={[
          { key: 'sheet', label: 'Sheet' }, { key: 'label', label: 'Row label in file', wrap: true },
          { key: 'key', label: 'Mapped to', render: (r) => (r.key ? (r.key.startsWith('reported:') ? <Chip s="reported ratio" tone="neutral" /> : <Chip s={ITEM_LABELS[r.key] || r.key} tone="info" />) : <span className="muted small">not used</span>) },
          ...fin.fys.map((f) => ({ key: f, label: f, num: true, render: (r: (typeof fin.rawRows)[number]) => (r.values[f] === null || r.values[f] === undefined ? '—' : r.values[f]!.toLocaleString('en-IN', { maximumFractionDigits: 2 })) })),
        ]} />
      )}

      {tab === 'GST monthly' && a.gst && (
        <Table rows={a.gst.monthly} maxHeight={640} cols={[{ key: 'month', label: 'Month', render: (r) => monthLabel(r.month) }, { key: 'fy', label: 'FY' }, { key: 'revenue', label: 'Sales', num: true, render: (r) => fmtINR(r.revenue) }, { key: 'purchase', label: 'Purchases', num: true, render: (r) => fmtINR(r.purchase) }, { key: 'margin', label: 'Margin', num: true, render: (r) => fmtINR(r.margin) }]} />
      )}
      {(tab === 'GST customers' || tab === 'GST suppliers') && ds.gst && (() => {
        const rows = tab === 'GST customers' ? ds.gst.customers : ds.gst.suppliers;
        const fys = a.gst?.fys || [];
        return <Table rows={filt(rows, (r) => r.name + r.gstin)} maxHeight={640} cols={[{ key: 'name', label: 'Party', wrap: true, sort: (r) => r.name }, { key: 'gstin', label: 'GSTIN' }, ...fys.map((f) => ({ key: f, label: f, num: true, sort: (r: (typeof rows)[number]) => r.byFY[f] ?? 0, render: (r: (typeof rows)[number]) => fmtINR(r.byFY[f]) }))]} />;
      })()}
      {tab === 'GST filings' && a.gst && (
        <Table rows={filt(a.gst.filing.rows, (r) => r.gstin + r.state + r.period)} maxHeight={640} cols={[{ key: 'gstin', label: 'GSTIN' }, { key: 'state', label: 'State' }, { key: 'returnType', label: 'Return' }, { key: 'period', label: 'Period' }, { key: 'due', label: 'Due' }, { key: 'filed', label: 'Filed' }, { key: 'delayDays', label: 'Delay', num: true }]} />
      )}
      {tab === 'Bank transactions' && a.bank && (
        <Table rows={filt(a.bank.txns, (r) => r.description + r.counterparty + r.cls + r.category)} maxHeight={640} cols={[
          { key: 'date', label: 'Date', sort: (r) => r.date, render: (r) => <span style={{ whiteSpace: 'nowrap' }}>{fmtDate(r.date)}</span> }, { key: 'account', label: 'Account', render: (r) => r.account.slice(-4) },
          { key: 'description', label: 'Narration', wrap: true, render: (r) => <span className="small">{r.description}</span> },
          { key: 'category', label: 'Bank category' }, { key: 'counterparty', label: 'Party' },
          { key: 'debit', label: 'Debit', num: true, sort: (r) => r.debit, render: (r) => (r.debit ? fmtINR(r.debit, 2) : '') },
          { key: 'credit', label: 'Credit', num: true, sort: (r) => r.credit, render: (r) => (r.credit ? fmtINR(r.credit, 2) : '') },
          { key: 'balance', label: 'Balance', num: true, render: (r) => fmtINR(r.balance, 2) },
          { key: 'cls', label: 'INGOVIQ class', render: (r) => <span className="small">{r.cls}</span> },
        ]} />
      )}
      {tab === 'Cleaning log' && (
        <Table rows={ds.log} maxHeight={640} cols={[{ key: 'level', label: '', render: (r) => <Chip s={r.level === 'warn' ? 'Check' : 'Done'} tone={r.level === 'warn' ? 'warn' : 'good'} /> }, { key: 'source', label: 'File', wrap: true }, { key: 'message', label: 'What INGOVIQ did', wrap: true }]} />
      )}
    </>
  );
}
