import type { PageCtx } from '../ctx';
import { pickFYs } from '../ctx';
import { ChartCard, Gauge, Radar } from '../Chart';
import { Kpi, Section, Chip, Disclaimer, Table } from '../common';
import { fmtCr, fmtPct, fmtINR } from '../../engine/format';
import { monthLabel, shortFY } from '../../engine/utils';

export function Overview({ a, ds, inp, fySel, toggleFY, themeKey }: PageCtx) {
  const fin = a.fin, gst = a.gst, bank = a.bank, risk = a.risk;
  const fys = fin ? pickFYs(fin.fys, fySel) : [];
  const lastFY = fin?.fys[fin.fys.length - 1];
  const P = (k: string) => fin?.performance.find((m) => m.key === k);
  const rev = P('revenue');
  const fd = ds.financial;
  const prof = fd?.profile || {};
  const incorporated = prof['Date of Incorporation'];
  const vintage = incorporated ? (() => { const m = incorporated.match(/(\d{4})/); return m ? `${new Date().getFullYear() - +m[1]} years (incorporated ${incorporated})` : incorporated; })() : '—';
  const openCharges = (fd?.charges || []).filter((c) => !c.satisfied || c.satisfied === '-');
  const wcLimits = openCharges.filter((c) => /book debts|current|stock|hypothecation/i.test(c.assets)).reduce((s, c) => s + c.amount, 0);
  const val = (k: string) => (lastFY ? fin?.performance.find((m) => m.key === k)?.values[lastFY] ?? null : null);

  const snapshotRows: [string, string][] = [
    ['Company Name', a.company],
    ['Constitution', prof['Type'] || prof['Category'] || prof['Sub Category'] || '—'],
    ['Industry', prof['Corpository Sector'] || prof['Industry'] || '—'],
    ['Business Activity', prof['Product/Services'] || '—'],
    ['Business Vintage', vintage],
    ['Promoters / Directors', (fd?.directors || []).filter((d) => !d.ceased || d.ceased === '-').map((d) => d.name).join(', ') || '—'],
    ['Registered Office', prof['Full Address'] || '—'],
    ['PAN', prof['PAN'] || '—'],
    ['GSTIN', (ds.gst?.gstins.length ? ds.gst.gstins : [...new Set((fd?.gstFilings || []).map((f) => f.gstin))]).join(', ') || '—'],
    ['Latest Turnover', `${fmtCr(val('revenue'))} (${lastFY || '—'})`],
    ['EBITDA', fmtCr(val('ebitda'))],
    ['PAT', fmtCr(val('pat'))],
    ['Tangible Net Worth', fmtCr(val('tnw'))],
    ['Total Debt', fmtCr(val('total_debt'))],
    ['Existing Working Capital Limits', wcLimits ? `${fmtCr(wcLimits)} (open charges on current assets)` : '—'],
    ['Promoter Net Worth', inp.promoterNetWorth ? fmtCr(inp.promoterNetWorth) : 'Not provided'],
    ['CIBIL', inp.cibilScore ? String(inp.cibilScore) : 'Not provided'],
    ['CMR', inp.cmrRank ? `CMR-${inp.cmrRank}` : 'Not provided'],
    ['External Rating, if available', prof['Rating'] || '—'],
    ['Funding Requirement', inp.fundingRequirement ? fmtCr(inp.fundingRequirement) : 'Not provided'],
    ['Purpose of Funding', inp.purpose || '—'],
    ['Proposed Product', inp.proposedProduct || risk.decision.product],
  ];

  const decTone = risk.decision.decision === 'GO' ? 'go' : risk.decision.decision === 'NO-GO' ? 'no' : 'cond';
  return (
    <>
      <div className="grid g5">
        <Kpi label={`Turnover ${lastFY ? shortFY(lastFY) : ''}`} value={fmtCr(val('revenue'))} delta={rev && lastFY && rev.yoy[lastFY] != null ? `${(rev.yoy[lastFY]! * 100).toFixed(1)}% YoY` : undefined} deltaGood={rev && lastFY ? (rev.yoy[lastFY] ?? 0) >= 0 : null} />
        <Kpi label="PAT" value={fmtCr(val('pat'))} delta={`Margin ${fmtPct(lastFY ? fin?.performance.find((m) => m.key === 'pat_margin')?.values[lastFY] : null)}`} />
        <Kpi label="Net Worth" value={fmtCr(val('networth'))} delta={`Debt ${fmtCr(val('total_debt'))}`} />
        <Kpi label="GST Sales (latest FY)" value={gst ? fmtCr(gst.revenueFY[gst.fys[gst.fys.length - 1]]) : '—'} delta={gst ? `${gst.fys[gst.fys.length - 1]} · ${gst.monthly.filter((m) => m.fy === gst.fys[gst.fys.length - 1] && m.revenue).length} months` : 'GST not loaded'} />
        <Kpi label="Adjusted Bank Inflow" value={bank ? fmtCr(bank.adjusted.adjusted) : '—'} delta={bank ? `${bank.months.length} months · gross ${fmtCr(bank.adjusted.gross)}` : 'Banking not loaded'} />
      </div>

      <Section num="2" title="Executive AI Credit Summary" />
      <div className="grid g3">
        <div className="card">
          <div className="card-title">Overall AI Credit Score</div>
          <Gauge value={risk.overall.score} label={`${risk.overall.risk} risk · ${risk.overall.covered}/13 dimensions`} themeKey={themeKey} />
        </div>
        <div className={`decision ${decTone}`} style={{ flexDirection: 'column', alignItems: 'flex-start', justifyContent: 'center' }}>
          <div className="muted small">Final Recommendation</div>
          <div className="big">{risk.decision.decision}</div>
          <div>Indicative Funding Eligibility: <b>{risk.decision.recommendedFunding !== null && risk.decision.recommendedFunding <= 0 ? 'Nil additional — no headroom at current leverage' : fmtCr(risk.decision.recommendedFunding)}</b></div>
          <div className="small muted">Product: {risk.decision.product} · Repayment capacity: {risk.decision.repayment}</div>
        </div>
        <div className="card">
          <div className="card-title">Score by dimension</div>
          <Radar indicators={risk.scores.filter((s) => s.score !== null).map((s) => s.name.replace('Financial-GST-Banking ', ''))} values={risk.scores.filter((s) => s.score !== null).map((s) => s.score)} height={230} themeKey={themeKey} />
        </div>
      </div>
      <div className="snap" style={{ marginTop: 12 }}>
        {Object.entries(risk.snapshot).map(([k, v]) => <div className="item" key={k}><div className="k">{k}</div><Chip s={v} /></div>)}
      </div>

      <div className="grid g2" style={{ marginTop: 12 }}>
        {fin && <ChartCard title="Revenue, EBITDA & PAT" sub="Click a year to filter the report" themeKey={themeKey} onCategoryClick={toggleFY}
          spec={{ categories: fys, unit: 'inr', type: 'bar', series: ['revenue', 'ebitda', 'pat'].map((k) => ({ name: P(k)!.name, data: fys.map((f) => P(k)!.values[f] ?? null) })) }} />}
        {gst && <ChartCard title="GST Sales vs Purchases (monthly)" sub="Adjusted values as per GST returns" themeKey={themeKey}
          spec={{ categories: gst.monthly.map((m) => monthLabel(m.month)), unit: 'inr', type: 'line', series: [{ name: 'Sales', data: gst.monthly.map((m) => m.revenue) }, { name: 'Purchases', data: gst.monthly.map((m) => m.purchase), slot: 1 }] }} />}
        {bank && <ChartCard title="Banking: inflow vs outflow" sub="All operative accounts, monthly" themeKey={themeKey}
          spec={{ categories: bank.monthly.map((m) => monthLabel(m.month)), unit: 'inr', type: 'bar', series: [{ name: 'Inflow', data: bank.monthly.map((m) => m.inflow) }, { name: 'Outflow', data: bank.monthly.map((m) => m.outflow), slot: 1 }] }} />}
        <div className="card">
          <div className="card-title">Top red flags</div>
          <ul className="clean">
            {risk.flags.slice(0, 7).map((f, i) => <li key={i}><Chip s={f.severity} tone={f.severity === 'High' ? 'critical' : f.severity === 'Medium' ? 'warn' : 'neutral'} /> <b>{f.area}:</b> {f.text}</li>)}
            {!risk.flags.length && <li className="muted">No red flags identified</li>}
          </ul>
        </div>
      </div>

      <Section num="1" title="Company & Credit Snapshot" />
      <Table rows={snapshotRows} cols={[{ key: 'k', label: 'Particular', render: (r) => <b>{r[0]}</b>, width: 260 }, { key: 'v', label: 'Details', render: (r) => r[1], wrap: true }]} />
      {openCharges.length > 0 && (
        <>
          <Section title="Open charges (existing secured borrowings)" />
          <Table rows={openCharges} cols={[
            { key: 'holder', label: 'Charge holder' }, { key: 'amount', label: 'Amount', num: true, render: (r) => fmtINR(r.amount) },
            { key: 'created', label: 'Created' }, { key: 'assets', label: 'Assets under charge', wrap: true }, { key: 'rate', label: 'Rate' },
          ]} />
        </>
      )}
      <Disclaimer />
    </>
  );
}
