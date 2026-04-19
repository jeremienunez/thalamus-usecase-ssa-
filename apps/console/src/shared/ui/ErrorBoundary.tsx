import { Component, type ReactNode } from "react";

type Props = { children: ReactNode; fallback?: ReactNode };
type State = { error: Error | null };

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    if (typeof console !== "undefined") {
      console.error("[ErrorBoundary]", error, info?.componentStack);
    }
  }

  reset = () => this.setState({ error: null });

  render() {
    if (this.state.error) {
      if (this.props.fallback) return this.props.fallback;
      return <FaultPanel error={this.state.error} onReset={this.reset} />;
    }
    return this.props.children;
  }
}

function FaultPanel({ error, onReset }: { error: Error; onReset: () => void }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-base p-8">
      <div className="w-full max-w-xl border border-hairline-hot bg-panel/95 shadow-pop">
        <div className="flex items-center gap-2 border-b border-hairline-hot px-3 py-2">
          <span className="h-1.5 w-1.5 bg-hot" />
          <span className="label text-nano text-hot">SUBSYSTEM FAULT</span>
          <span className="ml-auto mono text-nano text-dim">UNCAUGHT EXCEPTION</span>
        </div>
        <div className="px-4 py-4">
          <div className="mono mb-3 text-caption text-primary tabular-nums">
            {error.name}: {error.message}
          </div>
          {error.stack && (
            <pre className="mb-4 max-h-48 overflow-auto border border-hairline bg-base px-3 py-2 mono text-nano text-muted">
              {error.stack.split("\n").slice(0, 8).join("\n")}
            </pre>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={onReset}
              className="border border-hairline bg-elevated px-3 py-1 mono text-caption text-cyan transition-colors duration-fast ease-palantir hover:bg-hover cursor-pointer"
            >
              RETRY
            </button>
            <button
              onClick={() => location.reload()}
              className="border border-hairline bg-elevated px-3 py-1 mono text-caption text-muted transition-colors duration-fast ease-palantir hover:bg-hover cursor-pointer"
            >
              RELOAD CONSOLE
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
