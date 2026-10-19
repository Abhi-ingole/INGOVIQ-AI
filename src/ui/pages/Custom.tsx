import { useMemo, useState } from 'react';
import type { PageCtx } from '../ctx';
import { StarterVisuals } from './ExtraVisuals';
import { ChartCard, type ChartType, type ValUnit, type ChartSpec } from '../Chart';
import { Section, Disclaimer, Table, Chip } from '../common';
import { fieldCatalog, evaluateMeasure } from '../../engine/measures';
import { monthLabel } from '../../engine/utils';
import { fmtUnit } from '../../engine/format';
import type { Analysis } from '../../engine/analyse';
import type { FYMap } from '../../engine/types';

export interface CustomMeasure { name: string; formula: string; unit: ValUnit }
export interface CustomVisual { id: string; title: string; dataset: string; fields: string[]; type: ChartType; unit: ValUnit }

type DS = { categories: string[]; fields: Record<string, (number | null)[]>; unit: Record<string, ValUnit> };

export function datasets(a: Analysis, measures: CustomMeasure[]): Record<string, DS> {
  const out: Record<string, DS> = {};
  if (a.fin) {
    const cat = fieldCatalog(a.fin);
    const fys = a.fin.fys;
    const fields: DS['fields'] = {};
    const unit: DS['unit'] = {};
    const allMetrics = [...a.fin.performance, ...a.fin.ratios, ...a.fin.extra];
    for (const [k, v] of Object.entries(cat)) {
      fields[k] = fys.map((f) => v[f] ?? null);
      const m = allMetrics.find((x) => x.name.replace(/^\d+\.\s*/, '') === k);
      unit[k] = (m?.unit === 'text' ? 'num' : (m?.unit as ValUnit)) || 'inr';
    }
    for (const m of measures) {
      const r = evaluateMeasure(m.formula, cat, fys);
      if (!r.error) { fields[`ƒ ${m.name}`] = fys.map((f) => r.values[f] ?? null); unit[`ƒ ${m.name}`] = m.unit; }
    }
    out['Financials (by financial year)'] = { categories: fys, fields, unit };
  }
  if (a.gst) {
    const m = a.gst.monthly;
    out['GST (monthly)'] = { categories: m.map((x) => monthLabel(x.month)), fields: { Sales: m.map((x) => x.revenue), Purchases: m.map((x) => x.purchase), Margin: m.map((x) => x.margin), 'Sales ÷ Purchases': m.map((x) => x.ratio) }, unit: { Sales: 'inr', Purchases: 'inr', Margin: 'inr', 'Sales ÷ Purchases': 'x' } };
    const fy = a.gst.fys[a.gst.fys.length - 1];
    const b = (a.gst.buyers[fy] || []).slice(0, 15);
    out[`GST buyers (${fy})`] = { categories: b.map((x) => x.name.slice(0, 30)), fields: { Sales: b.map((x) => x.total), Share: b.map((x) => x.share) }, unit: { Sales: 'inr', Share: 'pct' } };
    const s = (a.gst.suppliers[fy] || []).slice(0, 15);
    out[`GST suppliers (${fy})`] = { categories: s.map((x) => x.name.slice(0, 30)), fields: { Purchases: s.map((x) => x.total), Share: s.map((x) => x.share) }, unit: { Purchases: 'inr', Share: 'pct' } };
    const st = a.gst.states.find((x) => x.fy === fy)?.rows || [];
    out[`GST state-wise (${fy})`] = { categories: st.map((x) => x.state), fields: { Sales: st.map((x) => x.sales), Purchases: st.map((x) => x.purchase) }, unit: { Sales: 'inr', Purchases: 'inr' } };
  }
  if (a.bank) {
    const m = a.bank.monthly;
    out['Banking (monthly)'] = { categories: m.map((x) => monthLabel(x.month)), fields: { Inflow: m.map((x) => x.inflow), Outflow: m.map((x) => x.outflow), 'Adjusted inflow': m.map((x) => x.adjustedInflow), 'Closing balance': m.map((x) => x.closing), 'Cash deposits': m.map((x) => x.cash), EMI: m.map((x) => x.emi), Interest: m.map((x) => x.interest), 'Credit entries': m.map((x) => x.credits) }, unit: { Inflow: 'inr', Outflow: 'inr', 'Adjusted inflow': 'inr', 'Closing balance': 'inr', 'Cash deposits': 'inr', EMI: 'inr', Interest: 'inr', 'Credit entries': 'num' } };
    const p = a.bank.parties.inflow.slice(0, 15);
    out['Bank inflow parties (top 15)'] = { categories: p.map((x) => x.party.slice(0, 30)), fields: { Amount: p.map((x) => x.amount), Share: p.map((x) => x.share) }, unit: { Amount: 'inr', Share: 'pct' } };
  }
  out['Credit scorecard'] = { categories: a.risk.scores.map((s) => s.name), fields: { Score: a.risk.scores.map((s) => s.score) }, unit: { Score: 'num' } };
  return out;
}

export function specFor(d: DS | undefined, v: CustomVisual): ChartSpec | null {
  if (!d) return null;
  const fs = v.fields.filter((f) => d.fields[f]);
  if (!fs.length) return null;
  return { categories: d.categories, unit: v.unit, type: v.type, series: fs.map((f, i) => ({ name: f.replace(/^ƒ /, ''), data: d.fields[f], slot: i })) };
}

export function MyVisuals(ctx: PageCtx & { visuals: CustomVisual[]; setVisuals: (v: CustomVisual[]) => void; measures: CustomMeasure[] }) {
  const { a, themeKey, visuals, setVisuals, measures } = ctx;
  const ds = useMemo(() => datasets(a, measures), [a, measures]);
  const names = Object.keys(ds);
  const [draft, setDraft] = useState<CustomVisual>({ id: '', title: '', dataset: names[0] || '', fields: [], type: 'bar', unit: 'inr' });
  const d = ds[draft.dataset];
  const preview = specFor(d, draft);
  const add = () => {
    if (!preview) return;
    setVisuals([...visuals, { ...draft, id: String(Date.now()), title: draft.title || `${draft.fields.map((f) => f.replace(/^ƒ /, '')).join(', ')} — ${draft.dataset}` }]);
    setDraft({ ...draft, fields: [], title: '' });
  };
  const move = (i: number, dir: -1 | 1) => { const v = [...visuals]; const j = i + dir; if (j < 0 || j >= v.length) return; [v[i], v[j]] = [v[j], v[i]]; setVisuals(v); };
  return (
    <>
      <Section title="Build a visual" right={<span className="small muted">Pick data → fields → visual type. Saved visuals update live when files change.</span>} />
      <div className="card">
        <div className="builder">
          <label>Data<select value={draft.dataset} onChange={(e) => setDraft({ ...draft, dataset: e.target.value, fields: [] })}>{names.map((n) => <option key={n}>{n}</option>)}</select></label>
          <label>Visual type<select value={draft.type} onChange={(e) => setDraft({ ...draft, type: e.target.value as ChartType })}>{['bar', 'hbar', 'line', 'area', 'stacked', 'pie', 'donut', 'table'].map((t) => <option key={t}>{t}</option>)}</select></label>
          <label>Number format<select value={draft.unit} onChange={(e) => setDraft({ ...draft, unit: e.target.value as ValUnit })}><option value="inr">₹ amount</option><option value="pct">Percent</option><option value="x">Times (x)</option><option value="days">Days</option><option value="num">Number</option></select></label>
          <label>Title<input value={draft.title} onChange={(e) => setDraft({ ...draft, title: e.target.value })} placeholder="Optional" /></label>
          <button className="btn primary" disabled={!preview} onClick={add}>＋ Add to My Visuals</button>
        </div>
        <div style={{ marginTop: 10, display: 'flex', flexWrap: 'wrap', gap: 6 }}>
          {d && Object.keys(d.fields).map((f) => (
            <label key={f} className={`chip ${draft.fields.includes(f) ? 'info' : 'neutral'}`} style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={draft.fields.includes(f)} style={{ margin: 0 }} onChange={() => {
                const fields = draft.fields.includes(f) ? draft.fields.filter((x) => x !== f) : [...draft.fields, f];
                setDraft({ ...draft, fields, unit: fields.length === 1 || !draft.fields.length ? d.unit[f] || draft.unit : draft.unit });
              }} />{f}
            </label>
          ))}
        </div>
        {preview && <div style={{ marginTop: 12 }}><ChartCard title={draft.title || 'Preview'} themeKey={themeKey} spec={preview} /></div>}
      </div>

      <Section title={`My Visuals (${visuals.length})`} />
      {!visuals.length && <div className="note">No custom visuals yet. Build one above — it is saved in this browser.</div>}
      <div className="grid g2">
        {visuals.map((v, i) => {
          const spec = specFor(ds[v.dataset], v);
          return (
            <div key={v.id} style={{ position: 'relative' }}>
              {spec ? <ChartCard title={v.title} sub={v.dataset} themeKey={themeKey} spec={spec} /> : <div className="note warn">"{v.title}" — its data is not loaded right now.</div>}
              <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                <button className="btn small" onClick={() => move(i, -1)}>← Move</button>
                <button className="btn small" onClick={() => move(i, 1)}>Move →</button>
                <button className="btn small" onClick={() => setVisuals(visuals.filter((x) => x.id !== v.id))}>Remove</button>
              </div>
            </div>
          );
        })}
      </div>
      <Disclaimer />
      {visuals.length < 4 && <StarterVisuals {...ctx} />}
    </>
  );
}

export function Measures({ a, measures, setMeasures }: PageCtx & { measures: CustomMeasure[]; setMeasures: (m: CustomMeasure[]) => void }) {
  const [name, setName] = useState('Gross Margin %');
  const [formula, setFormula] = useState('DIVIDE([Revenue] - [Purchases], [Revenue])');
  const [unit, setUnit] = useState<ValUnit>('pct');
  if (!a.fin) return <div className="note warn">Load the financial statements to use measures.</div>;
  const fys = a.fin.fys;
  const cat = fieldCatalog(a.fin);
  const test = evaluateMeasure(formula, cat, fys);
  const all = [...a.fin.performance, ...a.fin.ratios, ...a.fin.extra];
  return (
    <>
      <div className="page-head"><div><h1>Model & Measures</h1><div className="sub">Every number on the dashboard is a measure with a DAX-style formula. Add your own — they recalculate on every refresh.</div></div></div>
      <Section title="New measure (DAX-style)" />
      <div className="card">
        <div className="builder">
          <label>Measure name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Format<select value={unit} onChange={(e) => setUnit(e.target.value as ValUnit)}><option value="inr">₹ amount</option><option value="pct">Percent</option><option value="x">Times (x)</option><option value="days">Days</option><option value="num">Number</option></select></label>
        </div>
        <textarea className="code" style={{ marginTop: 8 }} value={formula} onChange={(e) => setFormula(e.target.value)} spellCheck={false} />
        <div className="small" style={{ margin: '6px 0' }}>
          {test.error ? <span className="down">⚠ {test.error}</span> : <>Result: {fys.map((f) => <span key={f} style={{ marginRight: 12 }}><b>{f}</b> {fmtUnit(test.values[f], unit)}</span>)}</>}
        </div>
        <button className="btn primary" disabled={!!test.error || !name.trim()} onClick={() => setMeasures([...measures.filter((m) => m.name !== name.trim()), { name: name.trim(), formula, unit }])}>Save measure</button>
        <div className="small muted" style={{ marginTop: 8 }}>
          Functions: DIVIDE(a, b, alt) · IF(cond, a, b) · ABS · MIN · MAX · ROUND(x, n) · AND · OR · NOT · PREVIOUSYEAR([X]) · YOY([X]) · BLANK(). Operators + − * / ^ = &lt;&gt; &lt; &gt; &lt;= &gt;=.
          <br />Fields: {Object.keys(cat).map((k) => <code key={k} className="code" style={{ marginRight: 6, cursor: 'pointer' }} onClick={() => setFormula((f) => `${f}[${k}]`)}>[{k}]</code>)}
        </div>
      </div>

      {measures.length > 0 && (
        <>
          <Section title="My measures" />
          <Table rows={measures} cols={[
            { key: 'name', label: 'Measure', render: (m) => <b>{m.name}</b> },
            { key: 'formula', label: 'Formula', render: (m) => <span className="code">{m.formula}</span>, wrap: true },
            ...fys.map((f) => ({ key: f, label: f, num: true, render: (m: CustomMeasure) => { const r = evaluateMeasure(m.formula, cat, fys); return r.error ? <span className="down">error</span> : fmtUnit(r.values[f], m.unit); } })),
            { key: 'del', label: '', render: (m) => <button className="btn small" onClick={() => setMeasures(measures.filter((x) => x.name !== m.name))}>Delete</button> },
          ]} />
        </>
      )}

      <Section title={`Built-in measures (${all.length})`} />
      <Table rows={all} maxHeight={640} cols={[
        { key: 'group', label: 'Group', render: (m) => <Chip s={m.group} tone="info" />, sort: (m) => m.group },
        { key: 'name', label: 'Measure', render: (m) => <b>{m.name}</b>, sort: (m) => m.name },
        { key: 'dax', label: 'DAX', render: (m) => <span className="code small">{m.dax}</span>, wrap: true },
        ...fys.map((f) => ({ key: f, label: f, num: true, render: (m: (typeof all)[number]) => fmtUnit(m.values[f], m.unit) })),
      ]} />
    </>
  );
}

export type { FYMap };
