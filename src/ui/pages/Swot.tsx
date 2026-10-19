import { useMemo, useState } from 'react';
import type { PageCtx } from '../ctx';
import { SwotVisuals } from './ExtraVisuals';
import { Section, Chip, Kpi, DISCLAIMER } from '../common';
import type { SwotType, Severity } from '../../engine/swot';
import { buildEvidence } from '../../engine/evidence';
import { swotPdf, swotExcel } from '../report/swotExport';

const TYPES: { t: SwotType; label: string; cls: string }[] = [
  { t: 'Strength', label: 'Strengths', cls: 'up' }, { t: 'Weakness', label: 'Weaknesses', cls: 'down' },
  { t: 'Opportunity', label: 'Opportunities', cls: 'opp' }, { t: 'Threat', label: 'Threats', cls: 'thr' },
];
const sevTone = (s: Severity): 'critical' | 'warn' | 'good' => (s === 'High' ? 'critical' : s === 'Medium' ? 'warn' : 'good');

/** Automatic, evidence-based SWOT (also used inside Risk & SWOT, section 34). */
export function SwotView({ a, ds, inp, compact = false, exporting }: PageCtx & { compact?: boolean }) {
  const [sev, setSev] = useState<'All' | Severity>('All');
  const sw = a.swot;
  const ev = useMemo(() => buildEvidence(ds), [ds]);
  const show = (s: Severity, t: SwotType) => sev === 'All' || ((t === 'Weakness' || t === 'Threat') && s === sev);
  return (
    <>
      {!compact && (
        <div className="grid g5" style={{ marginBottom: 10 }}>
          <Kpi label="Strengths" value={sw.counts.Strength} />
          <Kpi label="Weaknesses" value={sw.counts.Weakness} />
          <Kpi label="Opportunities" value={sw.counts.Opportunity} />
          <Kpi label="Threats" value={sw.counts.Threat} />
          <Kpi label="High-severity risks" value={sw.highRisks} deltaGood={!sw.highRisks} delta={`built from ${sw.generatedFrom.join(', ') || '—'}`} />
        </div>
      )}
      {!exporting && (
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 8 }}>
          <span className="small">Risk severity:</span>
          {(['All', 'High', 'Medium', 'Low'] as const).map((s) => <button key={s} className={`btn small ${sev === s ? 'primary' : ''}`} onClick={() => setSev(s)}>{s}</button>)}
          {compact && <span style={{ marginLeft: 'auto', display: 'flex', gap: 6 }}>
            <button className="btn small" onClick={() => swotPdf(a.company, sw, ev.items, !!inp.pdfDisclaimer, DISCLAIMER)}>⤓ SWOT PDF</button>
            <button className="btn small" onClick={() => swotExcel(a.company, sw, ev.items)}>⤓ SWOT Excel</button>
          </span>}
        </div>
      )}
      <div className="swot2">
        {TYPES.map(({ t, label, cls }) => (
          <div key={t} className={`swq ${cls}`}>
            <h4>{label} <span className="muted small">({sw.items.filter((i) => i.type === t).length})</span></h4>
            {sw.items.filter((i) => i.type === t && show(i.severity, t)).map((i, k) => (
              <div key={k} className="swi">
                <div className="swi-h"><b>{i.title}</b>{(t === 'Weakness' || t === 'Threat') && <Chip s={i.severity} tone={sevTone(i.severity)} />}</div>
                <div className="small">{i.detail}</div>
                <div className="swi-ev small"><span>📏 {i.metric}: <b>{i.value}</b> (benchmark {i.benchmark})</span><span>📁 {i.source} · section {i.section}</span></div>
                {i.recommendation && <div className="swi-rec small">💡 {i.recommendation}</div>}
              </div>
            ))}
            {!sw.items.some((i) => i.type === t && show(i.severity, t)) && <div className="small muted">None for this filter.</div>}
          </div>
        ))}
      </div>
    </>
  );
}

export function Swot(ctx: PageCtx) {
  const c = ctx;
  return (
    <>
      <Section title="Automatic SWOT — every point with its ratio, data source, severity and recommendation" />
      <SwotView {...c} />
      <SwotVisuals {...ctx} />
    </>
  );
}
