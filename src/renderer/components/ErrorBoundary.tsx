import { Component, type ErrorInfo, type ReactNode } from 'react'

interface Props {
  /** Shown in the fallback, e.g. "event details" */
  area: string
  children: ReactNode
}

interface State {
  error: Error | null
}

/**
 * Contains rendering crashes to one area of the UI. Without this, any render error
 * unmounts the whole React tree and the window turns blank white.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error(`[ui] ${this.props.area} crashed:`, error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <div className="m-4 rounded-lg border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-300">
        <p className="font-medium">Something went wrong in the {this.props.area}.</p>
        <p className="selectable mt-1 font-mono text-xs break-words">{this.state.error.message}</p>
        <button
          className="mt-3 rounded-md border border-red-500/40 bg-slate-900 px-3 py-1 text-xs font-medium hover:bg-red-500/20"
          onClick={() => this.setState({ error: null })}
        >
          Try again
        </button>
      </div>
    )
  }
}
