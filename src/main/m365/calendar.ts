import { m365Token } from './auth'
import { terjemahkanGalatGraph } from './rules'

// Kalender Outlook lewat Microsoft Graph — BACA saja.
//
// Tidak ada jalur membuat, mengubah, atau membatalkan acara. Mengundang orang
// dan menggeser rapat adalah tindakan yang terlihat oleh orang lain, dan itu
// keputusan yang harus tetap di tangan user (`SOUL.md`).

const GRAPH = 'https://graph.microsoft.com/v1.0'

export interface Acara {
  subjek: string
  mulai: string
  selesai: string
  sepanjangHari: boolean
  lokasi: string
  penyelenggara: string
  peserta: string[]
  online: boolean
  /** Agenda/undangan, sudah dibersihkan jadi teks. */
  catatan: string
}

interface AcaraMentah {
  subject?: string
  start?: { dateTime?: string }
  end?: { dateTime?: string }
  isAllDay?: boolean
  location?: { displayName?: string }
  organizer?: { emailAddress?: { name?: string } }
  attendees?: Array<{ emailAddress?: { name?: string; address?: string } }>
  isOnlineMeeting?: boolean
  bodyPreview?: string
}

/**
 * Jam lokal Jakarta.
 *
 * ⚠️ Graph mengembalikan waktu dalam UTC kecuali diminta lain. Tanpa header
 * `Prefer: outlook.timezone`, rapat pukul 09:00 tampil sebagai 02:00 — dan
 * kesalahannya tidak terlihat seperti bug, melainkan seperti jadwal yang salah.
 */
const ZONA = 'SE Asia Standard Time'

async function graph<T>(path: string): Promise<T> {
  const token = await m365Token()
  const res = await fetch(`${GRAPH}${path}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Prefer: `outlook.timezone="${ZONA}"`
    }
  })
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: { code?: string } }
    const saran = terjemahkanGalatGraph(res.status, body.error?.code ?? '')
    throw new Error(saran ?? `Microsoft Graph menolak (HTTP ${res.status}).`)
  }
  return (await res.json()) as T
}

function jam(s: string | undefined): string {
  if (!s) return ''
  return s.slice(0, 16).replace('T', ' ')
}

function petakan(a: AcaraMentah): Acara {
  return {
    subjek: a.subject ?? '(tanpa judul)',
    mulai: jam(a.start?.dateTime),
    selesai: jam(a.end?.dateTime),
    sepanjangHari: a.isAllDay === true,
    lokasi: a.location?.displayName ?? '',
    penyelenggara: a.organizer?.emailAddress?.name ?? '',
    peserta: (a.attendees ?? [])
      .map((p) => p.emailAddress?.name ?? p.emailAddress?.address ?? '')
      .filter(Boolean)
      .slice(0, 25),
    online: a.isOnlineMeeting === true,
    catatan: (a.bodyPreview ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)
  }
}

/**
 * Acara pada rentang tanggal. `calendarView` dipakai, BUKAN `/events`:
 * `/events` tidak memekarkan acara berulang, jadi rapat mingguan hanya muncul
 * sekali — pada tanggal aslinya, bukan pada hari yang ditanyakan user.
 */
export async function acaraRentang(dari: string, sampai: string, batas: number): Promise<Acara[]> {
  const params = new URLSearchParams({
    startDateTime: `${dari}T00:00:00`,
    endDateTime: `${sampai}T23:59:59`,
    $orderby: 'start/dateTime',
    $top: String(batas),
    $select: 'subject,start,end,isAllDay,location,organizer,attendees,isOnlineMeeting,bodyPreview'
  })
  const data = await graph<{ value: AcaraMentah[] }>(`/me/calendarView?${params.toString()}`)
  return (data.value ?? []).map(petakan)
}
