import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  error?: Error;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
          <section className="w-full max-w-md space-y-4 text-center">
            <p className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Modern Trivia
            </p>
            <h1 className="text-2xl font-bold">Something went wrong</h1>
            <p className="text-sm text-muted-foreground">Reload the app to get back to the game.</p>
            <Button type="button" onClick={() => window.location.reload()}>
              Reload
            </Button>
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}
