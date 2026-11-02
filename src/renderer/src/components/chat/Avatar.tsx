import type { JSX } from 'react'
import { IconUsers } from '../Icons'
import { inisial, warnaNama } from './bantu'

/**
 * Lingkaran inisial / ikon grup, dengan titik online.
 *
 * Grup memakai ikon, bukan inisial nama grup: di daftar yang bercampur, bentuk
 * ikon yang berbeda membuat "ini grup" terbaca sebelum namanya dibaca.
 */
export function Avatar({
  nama,
  grup = false,
  online = false,
  ukuran = 38
}: {
  nama: string
  grup?: boolean
  online?: boolean
  ukuran?: number
}): JSX.Element {
  const warna = grup ? '#5b6b62' : warnaNama(nama)
  return (
    <span
      className="psn-avatar"
      style={{ width: ukuran, height: ukuran, background: warna, fontSize: ukuran * 0.36 }}
      aria-hidden="true"
    >
      {grup ? <IconUsers size={Math.round(ukuran * 0.5)} /> : inisial(nama)}
      {online && !grup && <span className="psn-avatar-online" />}
    </span>
  )
}
