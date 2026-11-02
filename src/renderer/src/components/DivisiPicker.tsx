import type { JSX } from 'react'
import type { Divisi, RoleId } from '@shared/ipc'

// Pemilih divisi. Dipakai di form tambah user DAN saat mengubah divisi user lama,
// supaya aturan "Staff hanya satu, Manager/SPV boleh banyak" tampil sama di kedua
// tempat — kalau ditulis dua kali, salah satunya pasti tertinggal saat aturannya berubah.

/**
 * Berapa divisi yang boleh dipilih tiap role. HARUS sama dengan `DIVISI_PER_ROLE`
 * di `main/auth/roles.ts`, yang menegakkannya. UI di sini hanya mencegah user
 * mengirim yang pasti ditolak; main process tetap memeriksa ulang.
 */
export type AturanDivisi = 'tanpa' | 'satu' | 'banyak'

export const DIVISI_PER_ROLE: Record<RoleId, AturanDivisi> = {
  super_admin: 'tanpa',
  direktur: 'tanpa',
  manager: 'banyak',
  spv: 'banyak',
  staff: 'satu'
}

export function butuhDivisi(role: RoleId): boolean {
  return DIVISI_PER_ROLE[role] !== 'tanpa'
}

/** Apakah pilihan divisi sudah memenuhi aturan role — dipakai mengaktifkan tombol simpan. */
export function divisiValid(role: RoleId, dipilih: readonly string[]): boolean {
  const n = new Set(dipilih).size
  switch (DIVISI_PER_ROLE[role]) {
    case 'tanpa':
      return n === 0
    case 'satu':
      return n === 1
    case 'banyak':
      return n >= 1
  }
}

export function keteranganDivisi(role: RoleId): string {
  switch (DIVISI_PER_ROLE[role]) {
    case 'tanpa':
      return 'Melihat lintas divisi — tidak perlu dipilihkan divisi.'
    case 'satu':
      return 'Pilih tepat satu divisi.'
    case 'banyak':
      return 'Pilih minimal satu, boleh lebih dari satu.'
  }
}

interface Props {
  role: RoleId
  daftar: Divisi[]
  dipilih: string[]
  disabled?: boolean
  onChange: (dipilih: string[]) => void
}

export default function DivisiPicker({
  role,
  daftar,
  dipilih,
  disabled,
  onChange
}: Props): JSX.Element | null {
  if (!butuhDivisi(role)) {
    return <p className="hint">{keteranganDivisi(role)}</p>
  }

  const satuSaja = DIVISI_PER_ROLE[role] === 'satu'
  const aktif = daftar.filter((d) => d.aktif)

  const toggle = (kode: string): void => {
    if (satuSaja) {
      // Radio: memilih yang lain menggantikan, bukan menambah.
      onChange(dipilih.includes(kode) ? [] : [kode])
      return
    }
    onChange(dipilih.includes(kode) ? dipilih.filter((d) => d !== kode) : [...dipilih, kode])
  }

  return (
    <>
      <p className="hint">{keteranganDivisi(role)}</p>
      <div className="divisi-grid">
        {aktif.map((d) => (
          <label key={d.kode} className={`divisi-chip ${dipilih.includes(d.kode) ? 'aktif' : ''}`}>
            <input
              type={satuSaja ? 'radio' : 'checkbox'}
              name={satuSaja ? `divisi-${role}` : undefined}
              checked={dipilih.includes(d.kode)}
              disabled={disabled}
              onChange={() => toggle(d.kode)}
            />
            {d.nama}
          </label>
        ))}
        {aktif.length === 0 && <span className="hint">Belum ada divisi aktif.</span>}
      </div>
    </>
  )
}
