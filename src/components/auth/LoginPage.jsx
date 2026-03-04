import { useState } from 'react'
import { useAuth } from '../../contexts/AuthContext'
import { toast } from 'sonner'

export function LoginPage() {
  const { signIn, resetPassword } = useAuth()
  const [mode, setMode] = useState('signin')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleSignIn = async (e) => {
    e.preventDefault()
    setLoading(true)
    const { error } = await signIn(email, password)
    if (error) toast.error(error.message)
    setLoading(false)
  }

  const handleForgot = async (e) => {
    e.preventDefault()
    setLoading(true)
    const { error } = await resetPassword(email)
    if (error) {
      toast.error(error.message)
    } else {
      toast.success('Check your email for a password reset link.')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="w-full max-w-sm">
        <div className="text-center mb-8">
          <img src="/favicon.png" alt="CFSC" className="w-12 h-12 mx-auto mb-3" />
          <h1 className="text-xl font-semibold text-gray-900">CFSC Food Rescue</h1>
          <p className="text-sm text-gray-500 mt-1">
            {mode === 'signin' ? 'Sign in to your account' : 'Reset your password'}
          </p>
        </div>

        <form
          onSubmit={mode === 'signin' ? handleSignIn : handleForgot}
          className="bg-white border border-gray-200 rounded-lg p-6 space-y-4 shadow-sm"
        >
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email</label>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm
                focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              placeholder="you@example.com"
            />
          </div>

          {mode === 'signin' && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm
                  focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
                placeholder="••••••••"
                minLength={6}
              />
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-2.5 bg-green-600 text-white font-medium rounded-md
              hover:bg-green-700 disabled:opacity-50 transition-colors text-sm"
          >
            {loading ? 'Please wait...' :
              mode === 'signin' ? 'Sign In' : 'Send Reset Link'}
          </button>
        </form>

        <div className="mt-4 text-center text-sm text-gray-500">
          {mode === 'signin' ? (
            <button onClick={() => setMode('forgot')} className="text-green-600 hover:underline">
              Forgot password?
            </button>
          ) : (
            <button onClick={() => setMode('signin')} className="text-green-600 hover:underline">
              Back to sign in
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
