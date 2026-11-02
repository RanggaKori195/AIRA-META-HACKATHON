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
        <strong>AIRA {status.versiBaru}</strong> sudah terunduh dan siap dipasang.
        {pesan ? ` ${pesan}` : ' AIRA akan ditutup sebentar lalu terbuka lagi.'}
      </span>
      <button className="btn-send" onClick={() => void pasang(setPesan)}>
        Pasang sekarang
      </button>
      <button
        className="btn-teks"
        title="Pembaruan tetap terpasang otomatis saat AIRA ditutup lewat tray"
        onClick={() => setTutup(status.versiBaru)}
      >
        Nanti
      </button>
    </div>
  )
}

const waktu = (iso: string | null): string =>
  iso
    ? new Date(iso).toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        hour: '2-digit',
        minute: '2-digit'
      })
    : 'belum pernah'

function kalimat(s: StatusUpdate): string {
  switch (s.tahap) {
    case 'mati':
      return s.pesan ?? 'Pembaruan otomatis tidak aktif.'
    case 'diam':
      return 'Menunggu pemeriksaan pertama.'
    case 'memeriksa':
      return 'Memeriksa versi baru…'
    case 'mengunduh':
      return `Mengunduh AIRA ${s.versiBaru ?? ''}… ${s.persen ?? 0}%`
    case 'siap':
      return `AIRA ${s.versiBaru} siap dipasang.`
    case 'terbaru':
      return 'AIRA sudah versi terbaru.'
    case 'galat':
      return s.pesan ?? 'Pemeriksaan pembaruan gagal.'
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
        <h3>Versi &amp; pembaruan</h3>
        <p className="hint">Status pembaruan tidak terbaca.</p>
      </section>
    )
  }

  const sibuk = status.tahap === 'memeriksa' || status.tahap === 'mengunduh'
  return (
    <section className="card">
      <h3>Versi &amp; pembaruan</h3>
      <p>
        Versi terpasang: <strong>{status.versiSekarang}</strong>
      </p>
      <p className={status.tahap === 'galat' ? 'error' : 'hint'}>{kalimat(status)}</p>
      {status.tahap === 'mengunduh' && (
        <div className="mon-isi" aria-label="Kemajuan unduhan">
          <i style={{ width: `${status.persen ?? 0}%` }} />
        </div>
      )}
      <p className="hint">Terakhir tersambung ke server update: {waktu(status.terakhirCek)}</p>
      {pesan && <p className="hint">{pesan}</p>}
      <div className="fb-aksi">
        {status.tahap === 'siap' ? (
          <button className="btn-send" onClick={() => void pasang(setPesan)}>
            Pasang sekarang
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
            {busy || sibuk ? 'Memeriksa…' : 'Cek pembaruan sekarang'}
          </button>
        )}
      </div>
      <p className="hint">
        AIRA memeriksa versi baru saat dibuka dan setiap 4 jam, lalu mengunduhnya di latar
        belakang. Pembaruan tidak pernah dipasang di tengah pekerjaan: kamu yang menekan Pasang,
        atau ia terpasang otomatis saat AIRA ditutup lewat tray.
      </p>
    </section>
  )
}
