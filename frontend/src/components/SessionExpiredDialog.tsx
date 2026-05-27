import { useState, type FormEvent } from 'react'
import * as Dialog from '@radix-ui/react-dialog'
import { Lock } from 'lucide-react'

interface Props {
  open: boolean
  onLogin: (password: string) => Promise<void>
}

export default function SessionExpiredDialog({ open, onLogin }: Props) {
  const [password, setPassword] = useState('')
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      await onLogin(password)
      setPassword('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog.Root open={open}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 animate-fade-up" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
                     z-50 w-full max-w-sm animate-slide-down"
          onOpenAutoFocus={e => e.preventDefault()}
        >
          <div className="card p-6 space-y-5 mx-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-app-accent/15 flex items-center justify-center">
                <Lock size={16} className="text-app-accent" />
              </div>
              <div>
                <Dialog.Title className="text-base font-semibold text-app-text">
                  Session expired
                </Dialog.Title>
                <p className="text-xs text-app-muted mt-0.5">Sign in again to continue</p>
              </div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <input
                type="password"
                className="input"
                placeholder="Password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
              {error && <p className="text-xs text-app-danger">{error}</p>}
              <button
                type="submit"
                disabled={loading || !password}
                className="btn-primary w-full py-2 text-sm"
              >
                {loading ? 'Signing in…' : 'Sign in'}
              </button>
            </form>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
