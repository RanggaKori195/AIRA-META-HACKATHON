import { useState, type JSX } from 'react'
import type { RekanChat } from '@shared/ipc'
import { IconBack, IconCheck, IconUsers } from '../Icons'
import { PilihAnggota } from './PilihAnggota'

/**
 * Membuat grup — dua langkah seperti WhatsApp: pilih anggota, lalu beri nama.
 *
 * Dua langkah, bukan satu formulir: nama grup lebih mudah dipikirkan SESUDAH
 * tahu siapa isinya, dan formulir panjang di kolom sempit ini terasa seperti
 * mengisi dokumen, bukan membuat obrolan.
 */
export function BuatGrup({
  rekan,
  awal,
  onBatal,
  onJadi
}: {
  rekan: readonly RekanChat[]
  /** Anggota yang sudah tercentang saat dibuka (mis. dari tombol "Tambahkan" di profil). */
  awal?: string[]
  onBatal: () => void
  onJadi: (grupId: string) => void
}): JSX.Element {
  const [langkah, setLangkah] = useState<1 | 2>(1)
  const [terpilih, setTerpilih] = useState<string[]>(awal ?? [])
  const [nama, setNama] = useState('')
  const [sibuk, setSibuk] = useState(false)
  const [galat, setGalat] = useState<string | null>(null)

  const buat = async (): Promise<void> => {
    setSibuk(true)
    setGalat(null)
    try {
      onJadi(await window.aira.chatGrupBuat(nama, terpilih))
    } catch (e) {
      setGalat(bersih(e))
    } finally {
      setSibuk(false)
    }
  }

  return (
    <div className="psn-kiri-isi">
      <div className="psn-kiri-kepala">
        <button
          className="psn-ikon"
          onClick={langkah === 1 ? onBatal : () => setLangkah(1)}
          title="Back"
        >
          <IconBack size={16} />
        </button>
        <div className="psn-kepala-teks">
          <strong>{langkah === 1 ? 'Add group members' : 'New group'}</strong>
          <span>
            {langkah === 1
              ? terpilih.length === 0
                ? 'Pick at least one teammate'
                : `${terpilih.length} selected`
              : `${terpilih.length + 1} members including you`}
          </span>
        </div>
      </div>

      {langkah === 1 ? (
        <>
          <PilihAnggota rekan={rekan} kecuali={[]} terpilih={terpilih} onUbah={setTerpilih} />
          <div className="psn-kaki">
            <button
              className="psn-tombol-utama"
              disabled={terpilih.length === 0}
              onClick={() => setLangkah(2)}
            >
              Next
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="psn-grup-baru">
            <span className="psn-grup-baru-ikon">
              <IconUsers size={28} />
            </span>
            <label className="psn-label">
              Group name
              <input
                value={nama}
                maxLength={60}
                onChange={(e) => setNama(e.target.value)}
                placeholder="e.g. Molecular Lab Team"
                autoFocus
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && nama.trim() && !sibuk) void buat()
                }}
              />
              <span className="psn-hitung">{nama.trim().length}/60</span>
            </label>
            <p className="psn-catatan">
              You automatically become admin. Members added later only see messages from when they
              joined.
            </p>
            {/*
              ⚠️ Kalimat ini WAJIB ada di titik orang membuat tempat bicara baru.
              Chat AIRA tidak terenkripsi seperti WhatsApp — tanpa keterangan ini,
              orang memindahkan percakapan rahasia ke sini dengan anggapan yang
              salah (lihat CLAUDE.md aturan 62).
            */}
            <p className="psn-catatan psn-catatan-waspada">
              AIRA chat is an internal work channel, not a confidential one. Do not send passwords
              or patient personal data.
            </p>
            {galat && <p className="psn-galat">{galat}</p>}
          </div>
          <div className="psn-kaki">
            <button
              className="psn-tombol-utama"
              disabled={!nama.trim() || sibuk}
              onClick={() => void buat()}
            >
              <IconCheck size={15} /> {sibuk ? 'Creating…' : 'Create group'}
            </button>
          </div>
        </>
      )}
    </div>
  )
}

/** Pesan galat IPC tanpa awalan teknis "Error invoking remote method …". */
export function bersih(e: unknown): string {
  const t = e instanceof Error ? e.message : String(e)
  return t.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
