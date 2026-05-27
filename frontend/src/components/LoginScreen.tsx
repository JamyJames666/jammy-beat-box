import { useState, useRef, type FormEvent } from 'react'
import { Music2, Eye, EyeOff } from 'lucide-react'
import { cn } from '@/lib/utils'

interface Props {
  onLogin: (password: string) => Promise<void>
}

export default function LoginScreen({ onLogin }: Props) {
  const [password, setPassword] = useState('')
  const [show,     setShow]     = useState(false)
  const [error,    setError]    = useState('')
  const [loading,  setLoading]  = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    if (!password) return
    setError('')
    setLoading(true)
    try {
      await onLogin(password)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed')
      inputRef.current?.focus()
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-app-bg px-4">
      {/* Background glow */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                        w-[600px] h-[600px] rounded-full
                        bg-app-accent/10 blur-[120px]" />
      </div>

      <div className="relative w-full max-w-sm animate-fade-up">
        <div className="card p-8 text-center space-y-6">
          {/* Icon */}
          <div className="flex justify-center">
            <div className="w-16 h-16 rounded-2xl bg-app-accent/15 border border-app-accent/30
                            flex items-center justify-center">
              <Music2 className="w-8 h-8 text-app-accent" />
            </div>
          </div>

          {/* Heading */}
          <div className="space-y-1">
            <h1 className="text-2xl font-bold text-app-text tracking-tight">Muse</h1>
            <p className="text-sm text-app-muted">Enter your dashboard password</p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4 text-left">
            <div className="relative">
              <input
                ref={inputRef}
                type={show ? 'text' : 'password'}
                className="input pr-10"
                placeholder="Password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={e => setPassword(e.target.value)}
              />
              <button
                type="button"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-app-muted
                           hover:text-app-text transition-colors p-0.5"
                onClick={() => setShow(s => !s)}
                tabIndex={-1}
              >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>

            {error && (
              <p className="text-xs text-app-danger animate-fade-up">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading || !password}
              className={cn(
                'btn-primary w-full py-2.5 text-sm',
                loading && 'opacity-70 cursor-not-allowed',
              )}
            >
              {loading ? 'Signing in…' : 'Sign in'}
            </button>
          </form>
        </div>
      </div>
    </div>
  )
}
