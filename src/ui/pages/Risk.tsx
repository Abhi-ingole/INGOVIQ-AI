import type { PageCtx } from '../ctx';
import { ChartCard, Gauge, Radar } from '../Chart';
import { Section, Chip, Disclaimer, Table, Kpi } from '../common';
import { fmtINR, fmtPct, fmtCr } from '../../engine/format';

const numIn = (v: string) => (v.trim() === '' ? null : Number(v.replace(/,/g, '')));

export function AgeingBureau({ a, inp, setInp, themeKey }: PageCtx) {
  const tot = (k: 'receivable' | 'payable') => inp.ageing.reduce((s, b) => s + (b[k] || 0), 0);
  const setAge = (i: number, k: 'receivable' | 'payable', v: string) => setInp({ ageing: inp.ageing.map((b, j) => (j === i ? { ...b, [k]: Number(v.replace(/,/g, '')) || 0 } : b)) });
  const bureauScore = a.risk.scores.find((s) => s.key === 'bureau');
  return (
    <>
      <Section num="29" title="Invoice ageing" />
      <div className="note small">Ageing is not part of the financial / GST / banking files. Type the debtor and creditor ageing here (from the latest ageing statement) — every score and chart updates immediately.</div>
      <div className="grid g2">
        <div className="tbl-wrap">
          <table className="tbl">
            <thead><tr><th>Age</th><th className="num">Receivables (₹)</th><th className="num">%</th><th className="num">Payables (₹)</th><th className="num">%</th></tr></thead>
            <tbody>
              {inp.ageing.map((b, i) => (
                <tr key={b.bucket}>
                  <td>{b.bucket}</td>
                  <td className="num"><input className="cell" value={b.receivable || ''} onChange={(e) => setAge(i, 'receivable', e.target.value)} placeholder="0" /></td>
                  <td className="num">{fmtPct(tot('receivable') ? b.receivable / tot('receivable') : null)}</td>
                  <td className="num"><input className="cell" value={b.payable || ''} onChange={(e) => setAge(i, 'payable', e.target.value)} placeholder="0" /></td>
                  <td className="num">{fmtPct(tot('payable') ? b.payable / tot('payable') : null)}</td>
                </tr>
              ))}
              <tr className="sub"><td>Total</td><td className="num">{fmtINR(tot('receivable'))}</td><td></td><td className="num">{fmtINR(tot('payable'))}</td><td></td></tr>
            </tbody>
          </table>
        </div>
        <ChartCard title="Receivable vs payable ageing" themeKey={themeKey} spec={{ categories: inp.ageing.map((b) => b.bucket), unit: 'inr', type: 'bar', series: [{ name: 'Receivables', data: inp.ageing.map((b) => b.receivable) }, { name: 'Payables', data: inp.ageing.map((b) => b.payable), slot: 1 }] }} />
      </div>
      {tot('receivable') > 0 && (
        <div className="card" style={{ marginTop: 10 }}>
          <div className="card-title">AI observations</div>
          <ul className="clean">
            <li>Old debtors (&gt; 90 days): {fmtINR(inp.ageing.slice(3).reduce((s, b) => s + b.receivable, 0))} — {fmtPct(inp.ageing.slice(3).reduce((s, b) => s + b.receivable, 0) / tot('receivable'))} of receivables.</li>
            <li>Debtors above 180 days: {fmtPct(inp.ageing[4].receivable / tot('receivable'))} {inp.ageing[4].receivable / tot('receivable') > 0.1 ? '— collection delays / stressed buyers likely.' : '— within comfort.'}</li>
            {tot('payable') > 0 && <li>Old creditors (&gt; 90 days): {fmtPct(inp.ageing.slice(3).reduce((s, b) => s + b.payable, 0) / tot('payable'))} of payables {inp.ageing.slice(3).reduce((s, b) => s + b.payable, 0) / tot('payable') > 0.25 ? '— indicates supplier-payment pressure.' : ''}</li>}
          </ul>
        </div>
      )}

      <Section num="30" title="CIBIL / CMR analysis" right={<Chip s={a.risk.snapshot['CIBIL/CMR Conduct']} />} />
      <div className="form">
        <label>CIBIL score (promoter / commercial)<input type="number" value={inp.cibilScore ?? ''} onChange={(e) => setInp({ cibilScore: numIn(e.target.value) })} placeholder="e.g. 760" /></label>
        <label>CMR rank (1–10)<input type="number" min={1} max={10} value={inp.cmrRank ?? ''} onChange={(e) => setInp({ cmrRank: numIn(e.target.value) })} placeholder="e.g. 4" /></label>
        <label>DPD / SMA / overdue observed?<select value={inp.dpdObserved ? 'yes' : 'no'} onChange={(e) => setInp({ dpdObserved: e.target.value === 'yes' })}><option value="no">No</option><option value="yes">Yes</option></select></label>
        <label style={{ gridColumn: 'span 2' }}>Bureau notes (existing loans, sanctioned limits, outstanding, EMI, enquiries, settled / written-off accounts)<textarea rows={3} value={inp.bureauNotes} onChange={(e) => setInp({ bureauNotes: e.target.value })} /></label>
      </div>
      <div className="note small" style={{ marginTop: 10 }}>Bureau score for the scorecard: <b>{bureauScore?.score ?? 'not scored'}</b> — {bureauScore?.basis}. {a.risk.flags.find((f) => f.area === 'Bureau')?.text}</div>
      <Disclaimer />
    </>
  );
}

export function RiskSwot({ a, themeKey }: PageCtx) {
  const risk = a.risk;
  const groups: ('Financial' | 'GST' | 'Banking' | 'Reconciliation' | 'Bureau')[] = ['Financial', 'GST', 'Banking', 'Reconciliation', 'Bureau'];
  const sec: Record<string, string> = { Financial: '31', GST: '32', Banking: '33', Reconciliation: '33', Bureau: '33' };
  return (
    <>
      <div className="grid g4">
        <Kpi label="High-severity flags" value={risk.flags.filter((f) => f.severity === 'High').length} deltaGood={!risk.flags.some((f) => f.severity === 'High')} delta="need resolution" />
        <Kpi label="Medium flags" value={risk.flags.filter((f) => f.severity === 'Medium').length} />
        <Kpi label="Low flags" value={risk.flags.filter((f) => f.severity === 'Low').length} />
        <Kpi label="Overall AI credit score" value={`${risk.overall.score ?? '—'}/100`} delta={<Chip s={risk.overall.risk} />} />
      </div>
      {groups.map((g) => {
        const list = risk.flags.filter((f) => f.area === g);
        if (!list.length) return null;
        return (
          <div key={g}>
            <Section num={sec[g]} title={`${g} red flags`} />
            <ul className="clean">{list.map((f, i) => <li key={i}><Chip s={f.severity} tone={f.severity === 'High' ? 'critical' : f.severity === 'Medium' ? 'warn' : 'neutral'} /> {f.text}</li>)}</ul>
          </div>
        );
      })}

      <Section num="34" title="AI SWOT analysis" />
      <div className="swot">
        <div><h4 className="up">Strengths</h4><ul className="clean">{risk.swot.strengths.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        <div><h4 className="down">Weaknesses</h4><ul className="clean">{risk.swot.weaknesses.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        <div><h4 style={{ color: 'var(--brand-600)' }}>Opportunities</h4><ul className="clean">{risk.swot.opportunities.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
        <div><h4 style={{ color: 'var(--serious-ink)' }}>Threats</h4><ul className="clean">{risk.swot.threats.map((x, i) => <li key={i}>{x}</li>)}</ul></div>
      </div>

      <Section num="35" title="Integrated AI credit scorecard" />
      <div className="grid g3">
        <div className="span2">
          <Table rows={risk.scores} cols={[
            { key: 'name', label: 'Assessment', render: (s) => <b>{s.name}</b> },
            { key: 'score', label: 'Score', num: true, render: (s) => (s.score === null ? '—' : `${s.score}/100`) },
            { key: 'classification', label: 'Risk classification', render: (s) => <Chip s={s.classification} /> },
            { key: 'basis', label: 'Basis', wrap: true, render: (s) => <span className="small">{s.basis}</span> },
          ]} />
        </div>
        <div className="card">
          <Gauge value={risk.overall.score} label={`OVERALL · ${risk.overall.risk}`} themeKey={themeKey} height={190} />
          <Radar indicators={risk.scores.filter((s) => s.score !== null).map((s) => s.name.replace('Financial-GST-Banking ', ''))} values={risk.scores.filter((s) => s.score !== null).map((s) => s.score)} height={250} themeKey={themeKey} />
        </div>
      </div>
      <div className="note small">Overall score is the average of the dimensions with data ({risk.overall.covered}/13). Score bands: ≥ 75 Low · 60–74 Moderate · 45–59 High · &lt; 45 Very High. Scoring weights, benchmarks and cut-offs should be separately defined and approved before the model is used for production credit decisions.</div>
      <Disclaimer />
    </>
  );
}

export function Decision({ a, inp }: PageCtx) {
  const risk = a.risk;
  const d = risk.decision;
  const tone = d.decision === 'GO' ? 'go' : d.decision === 'NO-GO' ? 'no' : 'cond';
  const list = (t: string, xs: string[]) => <div className="card"><div className="card-title">{t}</div><ol style={{ margin: '6px 0', paddingLeft: 18 }}>{xs.map((x, i) => <li key={i} style={{ margin: '4px 0' }}>{x}</li>)}</ol></div>;
  return (
    <>
      <Section num="36" title="Funding capacity" />
      <div className="grid g3">
        <Kpi label="Indicative additional debt capacity" value={fmtCr(risk.funding.additionalDebt)} />
        <Kpi label="Indicative working-capital gap" value={fmtCr(risk.funding.wcGap)} />
        <Kpi label="Funding requirement (input)" value={inp.fundingRequirement ? fmtCr(inp.fundingRequirement) : 'Not provided'} />
      </div>
      <div className="card" style={{ marginTop: 10 }}><div className="card-title">How it is calculated</div><ul className="clean">{risk.funding.method.map((m, i) => <li key={i} className="small">{m}</li>)}</ul></div>

      <Section num="37" title="Product mapping" />
      <Table rows={risk.products} cols={[{ key: 'name', label: 'Suitable product', render: (p) => <b>{p.name}</b> }, { key: 'why', label: 'Why', wrap: true }]} />
      <div className="note small">Final product recommendation remains subject to lender policy and eligibility.</div>

      <Section num="38" title="Final AI credit recommendation" />
      <div className={`decision ${tone}`}>
        <div><div className="muted small">Credit decision</div><div className="big">{d.decision}</div></div>
        <div className="grid g3" style={{ flex: 1, minWidth: 280 }}>
          <div><div className="muted small">Recommended funding</div><b>{d.recommendedFunding !== null && d.recommendedFunding <= 0 ? 'Nil additional (no headroom)' : fmtCr(d.recommendedFunding)}</b></div>
          <div><div className="muted small">Recommended product</div><b>{d.product}</b></div>
          <div><div className="muted small">Indicative tenure</div><b>{d.tenure}</b></div>
          <div><div className="muted small">Repayment capacity</div><Chip s={d.repayment} /></div>
          <div><div className="muted small">Security requirement</div><span className="small">{d.security}</span></div>
          <div><div className="muted small">Additional collateral / FLDG</div><span className="small">{d.collateral}</span></div>
        </div>
      </div>
      <div className="grid g3" style={{ marginTop: 10 }}>
        {list('Key strengths', d.strengths)}
        {list('Key risks', d.risks)}
        {list('Risk mitigants', d.mitigants)}
        {list('Conditions before funding', d.conditions)}
        {list('Additional documents / clarifications', d.documents)}
      </div>

      <Section num="39" title="Final credit analyst remarks" />
      <div className="card"><p style={{ margin: 0, lineHeight: 1.6 }}>{risk.analystNote}</p></div>
      <div style={{ marginTop: 10 }}>
        <Table rows={risk.qa} cols={[{ key: 'n', label: '#', render: (x) => risk.qa.indexOf(x) + 1, width: 30 }, { key: 'q', label: 'Question', render: (x) => <b>{x.q}</b>, wrap: true }, { key: 'a', label: 'INGOVIQ answer', wrap: true }]} />
      </div>
      <Section num="40" title="Report disclaimer / declaration" />
      <Disclaimer />
    </>
  );
}
