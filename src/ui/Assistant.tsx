import { useEffect, useRef, useState } from 'react';
import type { Analysis } from '../engine/analyse';
import type { Dataset, ManualInputs } from '../engine/types';
import { ask, EXAMPLES, type Answer } from '../engine/assistant';

interface Msg { who: 'me' | 'bot'; text: string; ans?: Answer }

/** "Ask INGOVIQ" — chat over the loaded report. Runs in the browser, no API key; answers only from the data. */
export function Assistant({ a, ds, inp }: { a: Analysis; ds: Dataset; inp: ManualInputs }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => { end.current?.scrollIntoView({ behavior: 'smooth' }); }, [msgs, open]);
  const send = (text: string) => {
    const t = text.trim();
    if (!t) return;
    let ans: Answer;
    try { ans = ask(t, a, ds, inp); } catch (e) { ans = { text: `Sorry — could not answer that (${(e as Error).message}).`, sources: [], found: false }; }
    setMsgs((m) => [...m, { who: 'me', text: t }, { who: 'bot', text: ans.text, ans }]);
    setQ('');
  };
  return (
    <>
      <button className="ai-fab" onClick={() => setOpen(!open)} title="Ask questions about this report">{open ? '✕' : '🤖'} <span>Ask INGOVIQ</span></button>
      {open && (
        <div className="ai-panel" role="dialog" aria-label="INGOVIQ assistant">
          <div className="ai-head"><b>🤖 INGOVIQ Assistant</b><span className="small muted">answers from {a.company}'s data · English / Hinglish / Marathi</span></div>
          <div className="ai-body">
            {!msgs.length && (
              <div className="small">
                <div className="muted" style={{ marginBottom: 6 }}>Ask anything about the loaded report. Every answer shows its source; if the data does not have it, I say so.</div>
                <div className="ai-chips">{EXAMPLES.map((e) => <button key={e} className="chip neutral" onClick={() => send(e)}>{e}</button>)}</div>
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={`ai-msg ${m.who}`}>
                <div style={{ whiteSpace: 'pre-wrap' }}>{m.text}</div>
                {m.ans?.bullets && <ul className="clean small">{m.ans.bullets.map((b, k) => <li key={k}>{b}</li>)}</ul>}
                {m.ans?.table && (
                  <div className="tbl-wrap" style={{ maxHeight: 260, marginTop: 6 }}><table className="tbl small"><thead><tr>{m.ans.table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                    <tbody>{m.ans.table.rows.map((r, k) => <tr key={k}>{r.map((c, j) => <td key={j} className={/^-?₹|^\d|%$|x$/.test(c) ? 'num' : 'wrap'}>{c}</td>)}</tr>)}</tbody></table></div>
                )}
                {m.ans && m.ans.sources.length > 0 && <div className="ai-src">📁 Source: {m.ans.sources.join(' · ')}</div>}
              </div>
            ))}
            <div ref={end} />
          </div>
          <form className="ai-input" onSubmit={(e) => { e.preventDefault(); send(q); }}>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. Top 5 buyers FY 2025-26 / GST filing late hai kya?" autoFocus />
            <button className="btn primary small" type="submit">Ask</button>
          </form>
        </div>
      )}
    </>
  );
}
