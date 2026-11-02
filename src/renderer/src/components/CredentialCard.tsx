import { useState, type JSX } from 'react'
import { IconLock } from './Icons'

export interface CredentialRequest {
  requestId: string
  sessionId: string
  credentialName: string
  url: string
}

interface Props {
  request: CredentialRequest
  onSubmit: (
    requestId: string,
    value: { username: string; password: string; remember: boolean } | null
  ) => void
}

export default function CredentialCard({ request, onSubmit }: Props): JSX.Element {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [remember, setRemember] = useState(true)

  const submit = (): void => {
    if (!username.trim() || !password) return
    onSubmit(request.requestId, { username: username.trim(), password, remember })
  }

  return (
    <div className="credential-card">
      <div className="approval-title">
        <IconLock size={16} /> Login diperlukan
      </div>
      <p className="hint">
        AIRA butuh login untuk <strong>{request.credentialName}</strong>
        {request.url ? ` (${new URL(request.url).host})` : ''}. Isi di sini — data ini dikirim langsung
        ke halaman oleh sistem, <strong>tidak menjadi teks chat</strong> dan tidak terlihat oleh AI.
      </p>
      <div className="two-col">
        <label>
          Username
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            spellCheck={false}
          />
        </label>
        <label>
          Password
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit()
            }}
            spellCheck={false}
          />
        </label>
      </div>
      <label className="checkbox">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        Ingat kredensial ini (tersimpan terenkripsi, tidak perlu diisi lagi)
      </label>
      <div className="approval-actions">
        <button className="btn-send" disabled={!username.trim() || !password} onClick={submit}>
          Login
        </button>
        <button className="btn-stop" onClick={() => onSubmit(request.requestId, null)}>
          Batal
        </button>
      </div>
    </div>
  )
}
