import { Component } from "react";

// Catches render errors so a bad view shows a recoverable message, not a white screen.
export default class ErrorBoundary extends Component {
  constructor(props) { super(props); this.state = { err: null }; }
  static getDerivedStateFromError(err) { return { err }; }
  componentDidCatch(err, info) { console.error("Clayco UI error:", err, info); }
  render() {
    if (this.state.err) {
      return (
        <div className="h-full grid place-items-center p-8 text-center">
          <div className="max-w-lg">
            <div className="text-lg text-white/80 mb-2">Something went wrong rendering this view.</div>
            <div className="text-xs text-white/40 mb-4 break-words">{String(this.state.err?.message || this.state.err)}</div>
            <button onClick={() => { this.setState({ err: null }); location.hash = ""; location.reload(); }}
              className="px-3 py-1.5 rounded bg-amber-500/20 text-amber-300 text-sm hover:bg-amber-500/30">Reload</button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
