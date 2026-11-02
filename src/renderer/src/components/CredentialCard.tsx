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
        <IconLock size={16} /> Sign-in required
      </div>
      <p className="hint">
        AIRA needs to sign in to <strong>{request.credentialName}</strong>
        {request.url ? ` (${new URL(request.url).host})` : ''}. Enter it here — this data is sent straight
        to the page by the system, <strong>never becomes chat text</strong> and is not visible to the AI.
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
        Remember these credentials (stored encrypted, no need to enter them again)
      </label>
      <div className="approval-actions">
        <button className="btn-send" disabled={!username.trim() || !password} onClick={submit}>
          Sign in
        </button>
        <button className="btn-stop" onClick={() => onSubmit(request.requestId, null)}>
          Cancel
        </button>
      </div>
    </div>
  )
}
