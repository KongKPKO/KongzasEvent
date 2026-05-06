import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
}

export default class ErrorBoundary extends React.Component<React.PropsWithChildren, ErrorBoundaryState> {
  state: ErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('[ErrorBoundary] Unhandled render error:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
          <div className="max-w-md rounded-xl border border-red-100 bg-white p-6 text-center shadow-sm">
            <h1 className="text-lg font-black text-gray-900 mb-2">Something went wrong</h1>
            <p className="text-sm text-gray-600 mb-4">
              Please refresh the page. If this keeps happening, contact the booth owner or support.
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="rounded-lg bg-pink-600 px-4 py-2 text-sm font-bold text-white hover:bg-pink-700"
            >
              Reload Page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
