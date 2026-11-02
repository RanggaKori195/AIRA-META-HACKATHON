import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import type { AksiPemantau, HasilPemicu, KeadaanPemantau, PemicuId } from '@shared/ipc'
import { langkahGulir, waktuRingkas } from './pemantau-bantu'

// Kartu "Pemantau" di Settings (20 Okt 2026, RANCANGAN-PEMANTAU.md).
//
// ⚠️ Isi kartu (pemicu mana yang tampil, kalimat aturan, status, riwayat) datang dari
// main process yang sudah menyaring per menu yang diizinkan SAAT INI. Tidak ada
// klaim yang ditulis di layar: kalimat aturan dibangkitkan dari konstanta kode.
// ⚠️ Riwayat di sini memuat rincian berangka (Rupiah) — itu sebabnya toast-nya
// sendiri hanya jumlah & persen.

const LABEL_HASIL: Record<HasilPemicu, { teks: string; kelas: string }> = {
  belum: { teks: 'Not checked yet', kelas: 'tag-netral' },
  normal: { teks: 'Normal', kelas: 'tag-ok' },
  berbunyi: { teks: 'Needs attention', kelas: 'tag-peringatan' },
  ditahan: { teks: 'On hold', kelas: 'tag-netral' },
  menunggu: { teks: 'Waiting for data', kelas: 'tag-netral' },
  libur: { teks: 'Holiday', kelas: 'tag-netral' },
  kurang_data: { teks: 'Not enough data', kelas: 'tag-netral' },
  gagal: { teks: 'Check failed', kelas: 'tag-gagal' }
}

interface Props {
  /** Klik riwayat = aksi yang sama dengan klik notifikasinya. */
  onAksi: (aksi: AksiPemantau) => void
  /** Dibuka lewat klik notifikasi: gulir ke kartu ini. */
  fokus?: boolean
}

export default function PemantauPanel({ onAksi, fokus }: Props): JSX.Element | null {
  const [keadaan, setKeadaan] = useState<KeadaanPemantau | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [memeriksa, setMemeriksa] = useState(false)
  const [mengubah, setMengubah] = useState(false)
  const kartu = useRef<HTMLElement>(null)

  const muat = useCallback(async () => {
    try {
      setKeadaan(await window.aira.pemantauStatus())
      setError(null)
    } catch (err) {
      setError(bersihkanError(err))
    }
  }, [])

  useEffect(() => {
    void muat()
    return window.aira.onPemantauBerubah(() => void muat())
  }, [muat])

  // Sekali per aktivasi `fokus`, bukan tiap status dimuat ulang (lihat langkahGulir).
  // ⚠️ Gulir LANGSUNG, bukan 'smooth' (terukur dari aplikasi 20 Okt 2026): panel Super Admin
  // di atas kartu ini selesai dimuat ±0,5 dtk SESUDAH guliran dimulai dan memanjangkan
  // halaman ±3.500 px; animasi 'smooth' tetap berhenti di posisi LAMA, jadi kartu terdorong
  // keluar layar. Guliran langsung membuat scroll anchoring Chromium menjaga kartu tetap di tempat.
  const sudahGulir = useRef(false)
  useEffect(() => {
    const l = langkahGulir(sudahGulir.current, Boolean(fokus), keadaan !== null)
    sudahGulir.current = l.sudah
    if (l.gulir) kartu.current?.scrollIntoView({ behavior: 'auto', block: 'start' })
  }, [fokus, keadaan])

  const setel = async (id: PemicuId, aktif: boolean): Promise<void> => {
    setMengubah(true)
    try {
      setKeadaan(await window.aira.pemantauSetel(id, aktif))
      setError(null)
    } catch (err) {
      setError(bersihkanError(err))
    } finally {
      setMengubah(false)
    }
  }

  const periksa = async (): Promise<void> => {
    setMemeriksa(true)
    try {
      setKeadaan(await window.aira.pemantauPeriksa())
      setError(null)
    } catch (err) {
      setError(bersihkanError(err))
    } finally {
      setMemeriksa(false)
    }
  }

  // Kartu baru tampil SESUDAH status termuat (atau gagal dimuat — galat tetap terlihat).
  // Dulu kartu "Memuat…" muncul sekilas lalu hilang lagi bagi user tanpa menu Sales/TAT
  // (temuan review akhir 20 Okt 2026); statusnya dibaca dari SQLite lokal, jadi cepat.
  if (keadaan === null && error === null) return null
  // User tanpa menu Sales maupun TAT: tidak ada yang dipantau untuknya.
  if (keadaan !== null && keadaan.pemicu.length === 0) return null

  const sekarang = Date.now()
  return (
    <section className="card" ref={kartu}>
      <h3>Monitor</h3>
      <p className="hint">
        AIRA checks the data regularly and sends a notification when something needs follow-up. The monitor
        only reads; the numbers are calculated by code. Notifications only contain counts &amp; percentages — the
        details are in the history below. Click a notification to open the related menu with a follow-up question
        already filled in.
      </p>
      <p className="hint">The monitor only runs while AIRA is running on this laptop (including in the tray).</p>
      {error && <div className="error">{error}</div>}
      {keadaan !== null && (
        <>
          {keadaan.pemicu.map((p) => (
            <div key={p.id} className="pemantau-pemicu">
              <label className="setel-baris">
                <input
                  type="checkbox"
                  checked={p.aktif}
                  disabled={mengubah}
                  onChange={(e) => void setel(p.id, e.target.checked)}
                />
                <span>
                  <strong>{p.judul}</strong>
                  <span className="hint">{p.aturan}</span>
                </span>
              </label>
              <div className="pemantau-status">
                <span className={`tag ${LABEL_HASIL[p.hasil].kelas}`}>{LABEL_HASIL[p.hasil].teks}</span>
                <span className="hint">
                  {p.ringkas}
                  {p.diperiksa !== null && ` Checked ${waktuRingkas(p.diperiksa, sekarang)}.`}
                  {!p.aktif && ' Notifications are off.'}
                </span>
              </div>
              {p.tidakDipantau.length > 0 && (
                <p className="hint pemantau-tidak">Not monitored: {p.tidakDipantau.join(', ')}.</p>
              )}
            </div>
          ))}
          <button className="btn-send pemantau-periksa" disabled={memeriksa} onClick={() => void periksa()}>
            {memeriksa ? 'Checking…' : 'Check now'}
          </button>
          {/* Kena batas sekali per menit: disebut, bukan diam (kalimatnya dari main). */}
          {keadaan.catatanPeriksa && <p className="hint">{keadaan.catatanPeriksa}</p>}

          <h4 className="pemantau-judul-riwayat">Alert history</h4>
          {keadaan.riwayat.length === 0 ? (
            <p className="hint">No alerts yet.</p>
          ) : (
            <ul className="memori-daftar">
              {keadaan.riwayat.map((r) => (
                <li key={r.id}>
                  <button
                    className="memori-item pemantau-riwayat"
                    onClick={() => onAksi(r.aksi)}
                    title={r.aksi.tujuan === 'menu' ? 'Open the related menu with a follow-up question filled in' : undefined}
                  >
                    <span className="pemantau-riwayat-kepala">
                      <strong>{r.judul}</strong>
                      <span className="hint">{waktuRingkas(r.dibuat, sekarang)}</span>
                    </span>
                    <span className="hint">{r.isi}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </section>
  )
}

function bersihkanError(err: unknown): string {
  const teks = err instanceof Error ? err.message : String(err)
  return teks.split('Error: ').pop() ?? teks
}
