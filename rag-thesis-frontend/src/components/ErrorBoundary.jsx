import { Component } from 'react'
import { AlertTriangle, RotateCcw } from 'lucide-react'

export class ErrorBoundary extends Component {
  constructor(props) {
    super(props)
    this.state = { hasError: false, error: null }
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error }
  }

  componentDidCatch(error, info) {
    console.error('Unhandled UI error:', error, info)
  }

  render() {
    if (!this.state.hasError) return this.props.children
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="glass-strong max-w-md rounded-[1.75rem] p-8 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-3xl bg-flame-500/12">
            <AlertTriangle className="text-flame-500" size={26} />
          </div>
          <h1 className="font-display text-xl font-bold">Something went wrong</h1>
          <p className="mt-2 text-sm opacity-65">
            An unexpected error occurred while rendering this page. Reloading usually fixes it.
          </p>
          <button
            onClick={() => window.location.reload()}
            className="mt-6 inline-flex h-11 items-center gap-2 rounded-2xl bg-gradient-to-br from-forest-600 to-forest-800 px-6 text-sm font-medium text-white shadow-lg transition hover:brightness-110"
          >
            <RotateCcw size={16} /> Reload page
          </button>
        </div>
      </div>
    )
  }
}
