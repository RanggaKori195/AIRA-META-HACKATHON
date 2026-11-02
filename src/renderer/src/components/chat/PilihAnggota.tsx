import { useMemo, useState, type JSX } from 'react'
import type { RekanChat } from '@shared/ipc'
import { IconClose, IconSearch } from '../Icons'
import { Avatar } from './Avatar'

/**
 * Pemilih anggota — dipakai saat membuat grup DAN saat menambah anggota.
 *
 * Satu komponen untuk dua tempat, supaya aturan "siapa yang boleh dipilih"
 * (bukan diri sendiri, bukan yang sudah anggota) tidak ditulis dua kali lalu
 * menyimpang. Aturan yang sama ditegakkan ULANG di main process — ini hanya
 * supaya orang tidak memilih sesuatu yang pasti ditolak.
 */
export function PilihAnggota({
  rekan,
  kecuali,
  terpilih,
  onUbah
}: {
  rekan: readonly RekanChat[]
  /** Username yang tidak boleh dipilih (sudah anggota). */
  kecuali: readonly string[]
  terpilih: readonly string[]
  onUbah: (baru: string[]) => void
}): JSX.Element {
  const [cari, setCari] = useState('')
  const tolak = useMemo(() => new Set(kecuali.map((x) => x.toLowerCase())), [kecuali])
  const pilih = useMemo(() => new Set(terpilih.map((x) => x.toLowerCase())), [terpilih])

  const calon = rekan.filter(
    (r) =>
      !tolak.has(r.username.toLowerCase()) &&
      r.username.toLowerCase().includes(cari.trim().toLowerCase())
  )

  const alih = (username: string): void => {
    const k = username.toLowerCase()
    onUbah(pilih.has(k) ? terpilih.filter((x) => x.toLowerCase() !== k) : [...terpilih, username])
  }

  return (
    <div className="psn-pilih">
      {/* Yang sudah dipilih tampil sebagai "chip" di atas — seperti WhatsApp —
          supaya daftar panjang tidak perlu digulir untuk memeriksa pilihan. */}
      {terpilih.length > 0 && (
        <div className="psn-chip-baris">
          {terpilih.map((u) => (
            <button key={u} className="psn-chip" onClick={() => alih(u)} title={`Remove ${u}`}>
              <Avatar nama={u} ukuran={20} />
              {u}
              <IconClose size={11} />
            </button>
          ))}
        </div>
      )}

      <div className="psn-cari">
        <IconSearch size={14} />
        <input
          value={cari}
          onChange={(e) => setCari(e.target.value)}
          placeholder="Search teammates"
          autoFocus
        />
      </div>

      <div className="psn-pilih-daftar">
        {calon.length === 0 && (
          <p className="psn-kosong">
            {rekan.length === 0 ? 'No other teammates yet.' : 'No matches.'}
          </p>
        )}
        {calon.map((r) => {
          const aktif = pilih.has(r.username.toLowerCase())
          return (
            <label key={r.username} className={`psn-pilih-baris${aktif ? ' aktif' : ''}`}>
              <Avatar nama={r.username} online={r.online} ukuran={32} />
              <span className="psn-pilih-nama">
                <strong>{r.username}</strong>
                <span>{r.role ?? ''}</span>
              </span>
              <input type="checkbox" checked={aktif} onChange={() => alih(r.username)} />
            </label>
          )
        })}
      </div>
    </div>
  )
}
