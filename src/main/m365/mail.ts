import { m365Token } from './auth'
import { terjemahkanGalatGraph } from './rules'
import { logger } from '../logger'

// Email Outlook lewat Microsoft Graph — BACA dan membuat DRAF.
//
// ⚠️ TIDAK ADA jalur mengirim di berkas ini, dan itu disengaja. `Mail.Send`
// tidak diminta sama sekali. Email yang terkirim tidak bisa ditarik, dan
// `SOUL.md` menaruh "operasi yang tidak bisa di-undo" di daftar yang wajib
// persetujuan user. Draf yang salah cuma perlu dihapus; email yang salah kirim
// sudah dibaca orang.

const GRAPH = 'https://graph.microsoft.com/v1.0'

async function graph<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await m365Token()
  const res = await fetch(`${GRAPH}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(init?.headers ?? {})
    }
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } }
    const saran = terjemahkanGalatGraph(res.status, body.error?.code ?? '')
    throw new Error(saran ?? `Microsoft Graph menolak (HTTP ${res.status}).`)
  }
  if (res.status === 204) return {} as T
  return (await res.json()) as T
}

/**
 * Membersihkan isi email jadi teks biasa.
 *
 * Email HTML penuh gaya, tabel tata letak, dan jejak balasan berlapis. Dikirim
 * mentah ke model, ia memakan ribuan token untuk isi yang sebenarnya beberapa
 * kalimat — dan `--enable-prefix-caching` belum aktif di gateway, jadi setiap
 * token itu dibayar tiap giliran.
 */
export function keTeks(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<\/(p|div|tr|li|h[1-6])>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export interface Surat {
  id: string
  dari: string
  emailDari: string
  kepada: string[]
  subjek: string
  waktu: string
  cuplikan: string
  belumDibaca: boolean
  adaLampiran: boolean
  perluBalas: boolean
}

interface SuratMentah {
  id: string
  subject?: string
  bodyPreview?: string
  receivedDateTime?: string
  isRead?: boolean
  hasAttachments?: boolean
  from?: { emailAddress?: { name?: string; address?: string } }
  toRecipients?: Array<{ emailAddress?: { name?: string; address?: string } }>
  flag?: { flagStatus?: string }
}

const PILIH =
  'id,subject,bodyPreview,receivedDateTime,isRead,hasAttachments,from,toRecipients,flag'

function petakan(m: SuratMentah): Surat {
  return {
    id: m.id,
    dari: m.from?.emailAddress?.name ?? m.from?.emailAddress?.address ?? '(tidak diketahui)',
    emailDari: m.from?.emailAddress?.address ?? '',
    kepada: (m.toRecipients ?? []).map(
      (t) => t.emailAddress?.name ?? t.emailAddress?.address ?? ''
    ),
    subjek: m.subject ?? '(tanpa subjek)',
    waktu: (m.receivedDateTime ?? '').slice(0, 16).replace('T', ' '),
    cuplikan: (m.bodyPreview ?? '').replace(/\s+/g, ' ').trim().slice(0, 220),
    belumDibaca: m.isRead === false,
    adaLampiran: m.hasAttachments === true,
    perluBalas: m.flag?.flagStatus === 'flagged'
  }
}

export interface HasilSurat {
  surat: Surat[]
  adaLagi: boolean
}

export interface SaringSurat {
  /** Hanya yang belum dibaca. */
  belumDibaca?: boolean
  /** Kata kunci pencarian. */
  cari?: string
  /** Batas hari ke belakang. */
  hariTerakhir?: number
}

export async function daftarSurat(f: SaringSurat, batas: number): Promise<HasilSurat> {
  const bagian: string[] = []
  if (f.belumDibaca) bagian.push('isRead eq false')
  if (f.hariTerakhir && f.hariTerakhir > 0) {
    const sejak = new Date(Date.now() - f.hariTerakhir * 86400_000).toISOString()
    bagian.push(`receivedDateTime ge ${sejak}`)
  }

  // ⚠️ $search dan $filter tidak bisa digabung di Graph mail. Kalau user
  // mencari kata, pencarian yang menang — menggabungkannya diam-diam akan
  // mengembalikan hasil yang salah tanpa error.
  const params = new URLSearchParams()
  params.set('$top', String(batas))
  params.set('$select', PILIH)
  if (f.cari) {
    params.set('$search', `"${f.cari.replace(/"/g, '')}"`)
  } else {
    params.set('$orderby', 'receivedDateTime desc')
    if (bagian.length) params.set('$filter', bagian.join(' and '))
  }

  const data = await graph<{ value: SuratMentah[]; '@odata.nextLink'?: string }>(
    `/me/messages?${params.toString()}`
  )
  return {
    surat: (data.value ?? []).map(petakan),
    adaLagi: Boolean(data['@odata.nextLink'])
  }
}

export interface IsiSurat extends Surat {
  isi: string
  terpotong: boolean
}

/** Batas isi satu email yang dikirim ke model. */
const MAKS_ISI = 12_000

export async function bacaSurat(id: string): Promise<IsiSurat> {
  const m = await graph<SuratMentah & { body?: { content?: string; contentType?: string } }>(
    `/me/messages/${encodeURIComponent(id)}?$select=${PILIH},body`
  )
  const mentah = m.body?.content ?? ''
  const teks = m.body?.contentType === 'html' ? keTeks(mentah) : mentah.trim()
  return {
    ...petakan(m),
    isi: teks.slice(0, MAKS_ISI),
    terpotong: teks.length > MAKS_ISI
  }
}

/**
 * Membuat DRAF balasan. Tidak pernah mengirim.
 *
 * `createReply` menyalin penerima, subjek, dan kutipan aslinya — jadi drafnya
 * benar-benar siap dibaca ulang orangnya di Outlook, bukan potongan teks yang
 * masih harus disusun sendiri.
 */
export async function drafBalasan(id: string, isi: string): Promise<{ id: string; webLink: string }> {
  const draf = await graph<{ id: string; webLink?: string }>(
    `/me/messages/${encodeURIComponent(id)}/createReply`,
    { method: 'POST' }
  )
  // Isi ditulis sebagai HTML sederhana supaya baris barunya bertahan di Outlook.
  const html = isi
    .split('\n')
    .map((b) => `<p>${b.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</p>`)
    .join('')
  await graph(`/me/messages/${encodeURIComponent(draf.id)}`, {
    method: 'PATCH',
    body: JSON.stringify({ body: { contentType: 'HTML', content: html } })
  })
  logger().info({ draf: draf.id }, 'draf balasan email dibuat (TIDAK dikirim)')
  return { id: draf.id, webLink: draf.webLink ?? '' }
}
