"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "@/components/ui/button";

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}
interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ProStudio] Unhandled UI error", error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-4 p-8 text-center"
      >
        <h1 className="text-lg font-semibold">{this.props.fallbackTitle ?? "Something went wrong"}</h1>
        <p className="text-sm text-muted-foreground">
          {this.state.error.message || "An unexpected error occurred."} Your saved projects are stored locally and are
          not affected.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => this.setState({ error: null })}>
            Try again
          </Button>
          {/* Full reload on purpose: the React tree is in an error state. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- intentional full reload */}
          <a
            href="/"
            className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground"
          >
            Go home
          </a>
        </div>
      </div>
    );
  }
}
