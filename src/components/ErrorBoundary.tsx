import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
}

export default class ErrorBoundary extends Component<Props, State> {
  state = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error) {
    console.error('[ErrorBoundary]', error);
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback || (
        <div className="flex flex-col items-center justify-center h-full text-white/40 p-4">
          <p className="text-xs font-body mb-2">Something went wrong</p>
          <button
            onClick={() => this.setState({ hasError: false })}
            className="text-[11px] text-cyan-400 hover:text-cyan-300"
          >
            Try again
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
