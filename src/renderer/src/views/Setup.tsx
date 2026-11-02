import { useState, type JSX } from 'react'
import type { SetupState } from '@shared/ipc'
import logo from '../assets/mascot/hello.png'

interface Props {
  defaults: SetupState | null
  onDone: (state: SetupState) => void
}

export default function Setup({ defaults, onDone }: Props): JSX.Element {
  const [endpoint, setEndpoint] = useState(defaults?.endpoint ?? 'https://api.meta.ai')
  const [modelId, setModelId] = useState(defaults?.modelId ?? 'muse-wonder-1.0')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    const result = await window.aira.saveSetup({ endpoint, modelId, apiKey })
    setBusy(false)
    if (result.ok) {
      onDone({ configured: true, endpoint, modelId })
    } else {
      setError(
        result.error +
          (result.models?.length ? ` — available: ${result.models.join(', ')}` : '')
      )
    }
  }

  return (
    <div className="setup">
      <div className="card">
        <img src={logo} alt="AIRA" />
        <h2>Connect AIRA to the Gateway</h2>
        <label>
          Endpoint Gateway
          <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} spellCheck={false} />
        </label>
        <label>
          Model ID
          <input value={modelId} onChange={(e) => setModelId(e.target.value)} spellCheck={false} />
        </label>
        <label>
          API Key (stored encrypted via Windows DPAPI)
          <input
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="sk-…"
            spellCheck={false}
          />
        </label>
        {error && <div className="error-text">{error}</div>}
        <button className="btn-send" disabled={busy || apiKey.length < 8} onClick={() => void submit()}>
          {busy ? 'Connecting…' : 'Test Connection & Save'}
        </button>
      </div>
    </div>
  )
}
