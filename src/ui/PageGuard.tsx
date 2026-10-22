import { Component, type ReactNode } from 'react';

/** Keeps a crash inside one page / section instead of blanking the whole app. */
export class PageGuard extends Component<{ children: ReactNode; name: string }, { err: Error | null }> {
  state = { err: null as Error | null };
  static getDerivedStateFromError(err: Error) { return { err }; }
  componentDidCatch(err: Error) { console.error(`INGOVIZ: "${this.props.name}" failed`, err); }
  componentDidUpdate(prev: { name: string }) { if (prev.name !== this.props.name && this.state.err) this.setState({ err: null }); }
  render() {
    if (!this.state.err) return this.props.children;
    return (
      <div className="note warn">
        <b>{this.props.name} could not be shown for this data.</b> The rest of the dashboard still works.
        <div className="small muted" style={{ marginTop: 6, whiteSpace: 'pre-wrap' }}>{String(this.state.err.message).slice(0, 300)}</div>
        <button className="btn small" style={{ marginTop: 6 }} onClick={() => this.setState({ err: null })}>Try again</button>
      </div>
    );
  }
}
