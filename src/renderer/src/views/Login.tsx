import { useState, type FormEvent, type JSX } from 'react'
import type { AuthSession } from '@shared/ipc'
import logo from '../assets/mascot/hello.png'

interface Props {
  /** false = database login tidak terjangkau. Layar tetap tampil, tapi dengan sebabnya. */
  ready: boolean
  onLoggedIn: (session: AuthSession) => void
}

/**
 * Gerbang masuk AIRA. Tampil sebelum apa pun yang lain.
 *
 * Layar ini sengaja TIDAK memuat cara lain masuk — tidak ada "lewati", tidak ada
 * mode tamu. Penguncian sesungguhnya ada di main process (`chatSend` menolak
 * mode yang tidak diizinkan role, dan menolak sama sekali bila belum login),
 * jadi layar ini hanya pintunya, bukan kuncinya.
 */
export default function Login({ ready, onLoggedIn }: Props): JSX.Element {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault()
    if (busy || username.trim().length === 0 || password.length === 0) return
    setBusy(true)
    setError(null)
    try {
      const hasil = await window.aira.login({ username: username.trim(), password })
      if (hasil.ok && hasil.session) {
        // Password dibuang dari state begitu tidak dipakai lagi — tidak ada
        // alasan ia tetap hidup di memory renderer sesudah login berhasil.
        setPassword('')
        onLoggedIn(hasil.session)
      } else {
        setError(hasil.error ?? 'Sign-in failed.')
        setPassword('')
      }
    } catch (err) {
      setError(String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="setup">
      <form className="card login-card" onSubmit={(e) => void submit(e)}>
        <img src={logo} alt="AIRA" />
        <h2>Sign in to AIRA</h2>
        <p className="hint">AI Lab Assistant</p>

        {!ready && (
          <div className="error-text">
            The sign-in database is unreachable. Make sure you are connected to the network
            (use the VPN when you are away from the office), then reopen AIRA.
          </div>
        )}

        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            spellCheck={false}
            autoFocus
            autoComplete="username"
            disabled={busy}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            spellCheck={false}
            autoComplete="current-password"
            disabled={busy}
          />
        </label>

        {error && <div className="error-text">{error}</div>}

        <button
          className="btn-send"
          type="submit"
          disabled={busy || !ready || username.trim().length === 0 || password.length === 0}
        >
          {busy ? 'Checking…' : 'Sign in'}
        </button>

        <p className="hint login-note">
          Every sign-in attempt is recorded together with the computer name and IP address. AIRA
          usage (time, menu, questions typed, and tools used) is also recorded and can be
          reviewed by an admin.
        </p>
      </form>
    </div>
  )
}
