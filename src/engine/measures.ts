/* A small, safe DAX-style expression engine for user-defined measures.
   Evaluated per financial year against the cleaned financial model.
   Supports: [Field] references, + - * / ^, comparisons, and functions
   DIVIDE, IF, ABS, MIN, MAX, ROUND, AND, OR, NOT, PREVIOUSYEAR, YOY, BLANK. No eval(). */
import type { FYMap } from './types';
import type { FinAnalysis } from './calcFinancial';

export const BASE_FIELD_LABELS: Record<string, string> = {
  revenue: 'Revenue', other_income: 'Other Income', total_income: 'Total Income', interest: 'Interest', depreciation: 'Depreciation',
  tax: 'Tax', pbt: 'PBT', pat: 'PAT', ebit: 'EBIT', ebitda: 'EBITDA', networth: 'Net Worth', tnw: 'Tangible Net Worth', intangibles: 'Intangible Assets',
  secured_debt: 'Secured Debt', unsecured: 'Unsecured Loans', borrowings: 'Total Debt', tol: 'Total Outside Liabilities', total_ca: 'Current Assets',
  total_cl: 'Current Liabilities', inventories: 'Inventory', receivables: 'Receivables', payables: 'Payables', cash: 'Cash', purchases: 'Purchases',
  cogs: 'COGS', reserves: 'Reserves', total_assets: 'Total Assets', ocf: 'Operating Cash Flow', principal: 'Principal Repayment',
};

export function fieldCatalog(fin: FinAnalysis): Record<string, FYMap> {
  const out: Record<string, FYMap> = {};
  for (const [k, label] of Object.entries(BASE_FIELD_LABELS)) if (fin.base[k]) out[label] = fin.base[k];
  for (const m of [...fin.performance, ...fin.ratios, ...fin.extra]) {
    const name = m.name.replace(/^\d+\.\s*/, '');
    if (!out[name]) out[name] = m.values;
  }
  return out;
}

type Tok = { t: 'num' | 'field' | 'id' | 'op' | 'lp' | 'rp' | 'comma'; v: string };
function lex(s: string): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < s.length) {
    const c = s[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === '[') { const j = s.indexOf(']', i); if (j < 0) throw new Error('Missing ]'); out.push({ t: 'field', v: s.slice(i + 1, j).trim() }); i = j + 1; continue; }
    if (/[0-9.]/.test(c)) { let j = i; while (j < s.length && /[0-9.]/.test(s[j])) j++; out.push({ t: 'num', v: s.slice(i, j) }); i = j; continue; }
    if (/[A-Za-z_]/.test(c)) { let j = i; while (j < s.length && /[A-Za-z_0-9]/.test(s[j])) j++; out.push({ t: 'id', v: s.slice(i, j).toUpperCase() }); i = j; continue; }
    if (c === '(') { out.push({ t: 'lp', v: c }); i++; continue; }
    if (c === ')') { out.push({ t: 'rp', v: c }); i++; continue; }
    if (c === ',') { out.push({ t: 'comma', v: c }); i++; continue; }
    const two = s.slice(i, i + 2);
    if (['<=', '>=', '<>', '&&', '||'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
    if ('+-*/^<>=&'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
    throw new Error(`Unexpected "${c}"`);
  }
  return out;
}

type Node = { k: 'num'; v: number } | { k: 'field'; v: string } | { k: 'un'; op: string; a: Node } | { k: 'bin'; op: string; a: Node; b: Node } | { k: 'call'; f: string; args: Node[] };

function parse(tokens: Tok[]): Node {
  let p = 0;
  const peek = () => tokens[p];
  const take = () => tokens[p++];
  const prec: Record<string, number> = { '||': 1, '&&': 2, '=': 3, '<>': 3, '<': 4, '>': 4, '<=': 4, '>=': 4, '&': 5, '+': 6, '-': 6, '*': 7, '/': 7, '^': 8 };
  function primary(): Node {
    const t = take();
    if (!t) throw new Error('Unexpected end of formula');
    if (t.t === 'num') return { k: 'num', v: parseFloat(t.v) };
    if (t.t === 'field') return { k: 'field', v: t.v };
    if (t.t === 'op' && (t.v === '-' || t.v === '+')) return { k: 'un', op: t.v, a: expr(7) };
    if (t.t === 'lp') { const e = expr(0); if (take()?.t !== 'rp') throw new Error('Missing )'); return e; }
    if (t.t === 'id') {
      if (t.v === 'TRUE') return { k: 'num', v: 1 };
      if (t.v === 'FALSE') return { k: 'num', v: 0 };
      if (peek()?.t !== 'lp') throw new Error(`Unknown name ${t.v} — wrap fields in [ ]`);
      take();
      const args: Node[] = [];
      if (peek()?.t !== 'rp') { args.push(expr(0)); while (peek()?.t === 'comma') { take(); args.push(expr(0)); } }
      if (take()?.t !== 'rp') throw new Error('Missing )');
      return { k: 'call', f: t.v, args };
    }
    throw new Error(`Unexpected "${t.v}"`);
  }
  function expr(min: number): Node {
    let a = primary();
    while (peek()?.t === 'op' && prec[peek().v] > min) {
      const op = take().v;
      const b = expr(op === '^' ? prec[op] - 1 : prec[op]);
      a = { k: 'bin', op, a, b };
    }
    return a;
  }
  const n = expr(0);
  if (p < tokens.length) throw new Error(`Unexpected "${tokens[p].v}"`);
  return n;
}

export function evaluateMeasure(formula: string, fields: Record<string, FYMap>, fys: string[]): { values: FYMap; error: string | null } {
  // strip "Name =" prefix written DAX-style
  const body = formula.includes('=') && /^[^[(=]+=/.test(formula) && !/^[^[(]*[<>]=/.test(formula) ? formula.slice(formula.indexOf('=') + 1) : formula;
  let ast: Node;
  try { ast = parse(lex(body)); } catch (e) { return { values: {}, error: (e as Error).message }; }
  const lookup = (name: string) => {
    const k = Object.keys(fields).find((f) => f.toLowerCase() === name.toLowerCase());
    if (!k) throw new Error(`Unknown field [${name}]`);
    return fields[k];
  };
  const values: FYMap = {};
  try {
    for (let i = 0; i < fys.length; i++) {
      const ev = (n: Node, fyIdx: number): number | null => {
        const fy = fys[fyIdx];
        switch (n.k) {
          case 'num': return n.v;
          case 'field': return fy === undefined ? null : lookup(n.v)[fy] ?? null;
          case 'un': { const a = ev(n.a, fyIdx); return a === null ? null : n.op === '-' ? -a : a; }
          case 'bin': {
            const a = ev(n.a, fyIdx), b = ev(n.b, fyIdx);
            if (n.op === '&&') return a && b ? 1 : 0;
            if (n.op === '||') return a || b ? 1 : 0;
            if (a === null || b === null) return null;
            switch (n.op) {
              case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return b === 0 ? null : a / b; case '^': return a ** b;
              case '=': return a === b ? 1 : 0; case '<>': return a !== b ? 1 : 0; case '<': return a < b ? 1 : 0; case '>': return a > b ? 1 : 0; case '<=': return a <= b ? 1 : 0; case '>=': return a >= b ? 1 : 0;
            }
            return null;
          }
          case 'call': {
            const A = (j: number, idx = fyIdx) => (n.args[j] ? ev(n.args[j], idx) : null);
            switch (n.f) {
              case 'DIVIDE': { const a = A(0), b = A(1); return a === null || b === null || b === 0 ? (n.args[2] ? A(2) : null) : a / b; }
              case 'IF': return A(0) ? A(1) : n.args[2] ? A(2) : null;
              case 'ABS': { const a = A(0); return a === null ? null : Math.abs(a); }
              case 'MIN': { const xs = n.args.map((_, j) => A(j)).filter((x): x is number => x !== null); return xs.length ? Math.min(...xs) : null; }
              case 'MAX': { const xs = n.args.map((_, j) => A(j)).filter((x): x is number => x !== null); return xs.length ? Math.max(...xs) : null; }
              case 'ROUND': { const a = A(0); const d = A(1) ?? 0; return a === null ? null : Math.round(a * 10 ** d) / 10 ** d; }
              case 'AND': return A(0) && A(1) ? 1 : 0;
              case 'OR': return A(0) || A(1) ? 1 : 0;
              case 'NOT': return A(0) ? 0 : 1;
              case 'BLANK': return null;
              case 'PREVIOUSYEAR': return fyIdx > 0 ? A(0, fyIdx - 1) : null;
              case 'YOY': { const c = A(0), p = fyIdx > 0 ? A(0, fyIdx - 1) : null; return c === null || p === null || p === 0 ? null : (c - p) / Math.abs(p); }
            }
            throw new Error(`Unknown function ${n.f}`);
          }
        }
      };
      values[fys[i]] = ev(ast, i);
    }
  } catch (e) {
    return { values: {}, error: (e as Error).message };
  }
  return { values, error: null };
}
