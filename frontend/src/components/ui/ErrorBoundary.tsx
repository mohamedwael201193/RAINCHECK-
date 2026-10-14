import React from "react";
import { Link } from "react-router-dom";

type Props = {
  children: React.ReactNode;
};

type State = {
  error: Error | null;
};

/**
 * ErrorBoundary — the app-wide crash catcher (one per app, in App.tsx).
 * A render crash anywhere becomes a friendly screen with a retry — never a
 * white page, never a lost user. Retry resets the boundary; if the crash
 * repeats, the home link is the escape hatch.
 */
export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    // Logged for diagnostics; never rendered (no stack traces in user copy).
    console.error("RAINCHECK UI crash:", error, info.componentStack);
  }

  private retry = () => {
    this.setState({ error: null });
  };

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <main className="flex min-h-screen items-center justify-center bg-ink px-6 text-ice">
        <div className="w-full max-w-xl text-center">
          <p className="mb-4 font-display text-sm font-bold uppercase tracking-[0.3em] text-rain">
            Something broke on our side
          </p>
          <h1 className="mb-4 font-display text-4xl font-black uppercase leading-none sm:text-5xl">
            This screen crashed.
          </h1>
          <p className="mx-auto mb-8 max-w-md text-base leading-relaxed text-ice/70">
            The page hit an unexpected error and couldn&apos;t render. Your
            wallet is untouched — nothing moves on-chain unless you sign a
            transaction in your wallet and it mines.
          </p>
          <div className="flex flex-wrap items-center justify-center gap-4">
            <button type="button" onClick={this.retry} className="rc-btn-primary">
              Try again
            </button>
            <Link to="/" className="rc-btn-outline-ice">
              Back home
            </Link>
          </div>
        </div>
      </main>
    );
  }
}
