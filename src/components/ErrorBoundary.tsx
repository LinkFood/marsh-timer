import { Component, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode | ((reset: () => void) => ReactNode);
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

  reset = () => {
    this.setState({ hasError: false });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return typeof this.props.fallback === 'function'
          ? this.props.fallback(this.reset)
          : this.props.fallback;
      }
      return (
        <div className="flex flex-col items-center justify-center h-full text-white/40 p-4">
          <p className="text-xs font-body mb-2">Something went wrong</p>
          <button
            onClick={this.reset}
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
