import { Component, type ReactNode } from "react";
import { ShieldAlert, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
}
interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error) {
    console.error("[Sky Guardian] Unhandled error:", error);
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div className="flex min-h-screen items-center justify-center bg-background px-4">
        <div className="hud-panel max-w-md w-full px-10 py-12 text-center">
          <ShieldAlert className="mx-auto h-10 w-10 text-destructive mb-4" />
          <div className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">
            SYSTEM ERROR
          </div>
          <h1 className="mt-2 text-xl font-bold uppercase tracking-widest text-foreground">
            Module Failure
          </h1>
          <p className="mt-3 text-xs text-muted-foreground font-mono break-all">
            {this.state.error?.message ?? "Unknown error"}
          </p>
          <button
            onClick={() => this.setState({ hasError: false, error: undefined })}
            className="mt-6 inline-flex items-center gap-2 border border-hud bg-hud/10 px-5 py-2 text-xs font-bold uppercase tracking-[0.2em] text-hud hover:bg-hud/20"
          >
            <RefreshCw className="h-3 w-3" />
            Reinitialize Module
          </button>
        </div>
      </div>
    );
  }
}
