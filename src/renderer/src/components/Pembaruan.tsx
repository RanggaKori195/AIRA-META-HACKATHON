import { useEffect, useState, type JSX } from 'react'
import type { StatusUpdate } from '@shared/ipc'

// Tampilan auto-update: spanduk "versi baru siap" + bagian di Settings.
// Keputusannya (kapan cek, boleh pasang atau tidak) ada di main process
// (`main/update/service.ts`); komponen ini hanya menampilkan dan meneruskan klik.

/** Status update terkini: ditanyakan sekali, lalu mengikuti event dari main. */
export function useStatusUpdate(): StatusUpdate | null {
  const [status, setStatus] = useState<StatusUpdate | null>(null)
  useEffect(() => {
    let hidup = true
    // Ditanyakan, bukan hanya didengar: event yang terkirim sebelum komponen ini
    // berlangganan hilang tanpa jejak.
    void window.aira
      .updateStatus()
      .then((s) => hidup && setStatus(s))
      .catch(() => undefined)
    const lepas = window.aira.onUpdateBerubah((s) => setStatus(s))
    return () => {
      hidup = false
      lepas()
    }
  }, [])
  return status
}

async function pasang(setPesan: (p: string) => void): Promise<void> {
  try {
    const hasil = await window.aira.updatePasang()
    setPesan(hasil.pesan)
  } catch (err) {
    setPesan(err instanceof Error ? err.message : String(err))
  }
}

/** Spanduk tipis di atas aplikasi — hanya muncul saat versi baru SIAP dipasang. */
export function SpandukPembaruan(): JSX.Element | null {
  const status = useStatusUpdate()
  const [tutup, setTutup] = useState<string | null>(null)
  const [pesan, setPesan] = useState<string | null>(null)
  if (!status || status.tahap !== 'siap' || tutup === status.versiBaru) return null
  return (
    <div className="spanduk-update" role="status">
      <span>
        <strong>AIRA {status.versiBaru}</strong> has been downloaded and is ready to install.
        {pesan ? ` ${pesan}` : ' AIRA will close briefly and reopen.'}
      </span>
      <button className="btn-send" onClick={() => void pasang(setPesan)}>
        Install now
      </button>
      <button
        className="btn-teks"
        title="The update still installs automatically when AIRA is quit from the tray"
        onClick={() => setTutup(status.versiBaru)}
      >
        Later
      </button>
    </div>
  )
}

const waktu = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString('en-US', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      })
    : 'never'

function kalimat(s: StatusUpdate): string {
  switch (s.tahap) {
    case 'mati':
      return s.pesan ?? 'Automatic updates are off.'
    case 'diam':
      return 'Waiting for the first check.'
    case 'memeriksa':
      return 'Checking for a new version…'
    case 'mengunduh':
      return `Downloading AIRA ${s.versiBaru ?? ''}… ${s.persen ?? 0}%`
    case 'siap':
      return `AIRA ${s.versiBaru} is ready to install.`
    case 'terbaru':
      return 'AIRA is up to date.'
    case 'galat':
      return s.pesan ?? 'The update check failed.'
  }
}

/** Bagian "Versi & pembaruan" di Settings. */
export function PanelPembaruan(): JSX.Element {
  const status = useStatusUpdate()
  const [pesan, setPesan] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  if (!status) {
    return (
      <section className="card">
        <h3>Version &amp; updates</h3>
        <p className="hint">The update status could not be read.</p>
      </section>
    )
  }

  const sibuk = status.tahap === 'memeriksa' || status.tahap === 'mengunduh'
  return (
    <section className="card">
      <h3>Version &amp; updates</h3>
      <p>
        Installed version: <strong>{status.versiSekarang}</strong>
      </p>
      <p className={status.tahap === 'galat' ? 'error' : 'hint'}>{kalimat(status)}</p>
      {status.tahap === 'mengunduh' && (
        <div className="mon-isi" aria-label="Download progress">
          <i style={{ width: `${status.persen ?? 0}%` }} />
        </div>
      )}
      <p className="hint">Last connected to the update server: {waktu(status.terakhirCek)}</p>
      {pesan && <p className="hint">{pesan}</p>}
      <div className="fb-aksi">
        {status.tahap === 'siap' ? (
          <button className="btn-send" onClick={() => void pasang(setPesan)}>
            Install now
          </button>
        ) : (
          <button
            className="btn-teks"
            disabled={busy || sibuk || status.tahap === 'mati'}
            onClick={() => {
              setBusy(true)
              setPesan(null)
              void window.aira
                .updateCek()
                .catch((err) => setPesan(err instanceof Error ? err.message : String(err)))
                .finally(() => setBusy(false))
            }}
          >
            {busy || sibuk ? 'Checking…' : 'Check for updates now'}
          </button>
        )}
      </div>
      <p className="hint">
        AIRA checks for a new version when it opens and every 4 hours, then downloads it in the
        background. Updates are never installed mid-task: you press Install, or it installs
        automatically when AIRA is quit from the tray.
      </p>
    </section>
  )
}
