import { useState, type JSX } from 'react'
import type { SetupState } from '@shared/ipc'
import logo from '../assets/aira-logo.png'

interface Props {
  defaults: SetupState | null
  onDone: (state: SetupState) => void
}

export default function Setup({ defaults, onDone }: Props): JSX.Element {
  const [endpoint, setEndpoint] = useState(defaults?.endpoint ?? 'https://gateway.internal.example')
  const [modelId, setModelId] = useState(defaults?.modelId ?? 'old-think-model')
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
          (result.models?.length ? ` — tersedia: ${result.models.join(', ')}` : '')
      )
    }
  }

  return (
    <div className="setup">
      <div className="card">
        <img src={logo} alt="AIRA" />
        <h2>Hubungkan AIRA ke Gateway</h2>
        <label>
          Endpoint Gateway
          <input value={endpoint} onChange={(e) => setEndpoint(e.target.value)} spellCheck={false} />
        </label>
        <label>
          Model ID
          <input value={modelId} onChange={(e) => setModelId(e.target.value)} spellCheck={false} />
        </label>
        <label>
          API Key (disimpan terenkripsi via Windows DPAPI)
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
          {busy ? 'Menghubungkan…' : 'Test Koneksi & Simpan'}
        </button>
      </div>
    </div>
  )
}
