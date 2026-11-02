import { useEffect, useRef, useState, type JSX } from 'react'
import type { ChatMessage, FeedbackJenis, ToolActivity } from '@shared/ipc'
import { IconClose } from './Icons'

// Dialog "Laporkan jawaban ini" — jalur A.
//
// ⚠️ Dialog React murni, BUKAN window.confirm/prompt. Dialog native menjalankan
// nested message loop yang memblokir main process; di Windows jendela induknya
// baru menerima input lagi beberapa detik sesudah dialog ditutup, dan gejalanya
// di lapangan adalah "kotak chat beku lalu pulih sendiri" (terjadi nyata,
// 18 Agu 2026). Pola sama dengan `ConfirmDialog.tsx`.
//
// Nilai utama dialog ini bukan teks yang diketik user, melainkan KONTEKS yang
// terisi otomatis. Manajer tidak akan pernah menulis "mode sales, basis invoice,
// sales_breakdown dimensi province" — ia menulis "angkanya salah". Kalau
// selebihnya tidak ditangkap mesin, laporannya tidak bisa ditelusuri.

/** Pilihan yang tampil di dialog, dipetakan ke `jenis` yang disimpan database. */
const PILIHAN: Array<{ jenis: FeedbackJenis; label: string }> = [
  { jenis: 'bug', label: 'Angkanya salah / meragukan' },
  { jenis: 'tidak_terjawab', label: 'Tidak menjawab pertanyaan saya' },
  { jenis: 'lain', label: 'Aplikasi error / macet' },
  { jenis: 'lain', label: 'Lainnya' }
]

interface Props {
  /** Jawaban AIRA yang dilaporkan. */
  pesan: ChatMessage
  /** Pertanyaan user yang mendahuluinya — `null` bila tidak ketemu. */
  pertanyaan: string | null
  onSelesai: () => void
  onBatal: () => void
}

export default function FeedbackDialog({
  pesan,
  pertanyaan,
  onSelesai,
  onBatal
}: Props): JSX.Element {
  const [pilih, setPilih] = useState(0)
  const [isi, setIsi] = useState('')
  const [sertakan, setSertakan] = useState(true)
  const [lihatData, setLihatData] = useState(false)
  const [kirim, setKirim] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const areaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    areaRef.current?.focus()
  }, [])

  // Escape menutup. Enter TIDAK mengirim — isinya textarea multi-baris, dan
  // mengirim laporan secara tidak sengaja lebih merugikan daripada satu klik.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onBatal()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onBatal])

  const submit = async (): Promise<void> => {
    if (kirim) return
    setKirim(true)
    setError(null)
    try {
      await window.aira.kirimFeedback({
        jenis: PILIHAN[pilih].jenis,
        isi: isi.trim() || PILIHAN[pilih].label,
        // Laporan dari gelembung selalu dianggap mengganggu: user sedang
        // memakai AIRA dan menemukan sesuatu yang salah. Skala penuh ada di
        // menu Masukan & Usulan.
        dampak: 'mengganggu',
        sesiId: pesan.sessionId,
        pesanId: pesan.id,
        // `mode` tidak tersimpan per pesan, jadi tidak ditebak dari sini —
        // tool yang terpanggil sudah menunjukkan mode mana yang aktif.
        mode: null,
        model: pesan.modelUsed,
        pertanyaan,
        jawaban: pesan.content,
        // ⚠️ toolLog ikut MESKIPUN cuplikan dicabut: ia hanya memuat nama tool
        // dan ringkasan argumennya, bukan data. Justru inilah yang membuat
        // laporan tetap bisa ditelusuri saat isinya dirahasiakan.
        toolLog: (pesan.toolLog as ToolActivity[] | null) ?? null,
        sertakanChat: sertakan
      })
      onSelesai()
    } catch (err) {
      setError(bersihkanError(err))
      setKirim(false)
    }
  }

  return (
    <div className="dialog-backdrop" role="dialog" aria-modal="true">
      <div className="dialog dialog-lebar">
        <div className="dialog-head">
          <h3>Laporkan jawaban ini</h3>
          <button className="btn-mini" title="Tutup" onClick={onBatal}>
            <IconClose size={14} />
          </button>
        </div>

        <div className="fb-grup">
          <label className="fb-label">Apa yang salah?</label>
          {PILIHAN.map((p, i) => (
            <label key={p.label} className="fb-radio">
              <input
                type="radio"
                name="fb-jenis"
                checked={pilih === i}
                onChange={() => setPilih(i)}
              />
              <span>{p.label}</span>
            </label>
          ))}
        </div>

        <div className="fb-grup">
          <label className="fb-label" htmlFor="fb-isi">
            Ceritakan singkat
          </label>
          <textarea
            id="fb-isi"
            ref={areaRef}
            rows={3}
            value={isi}
            maxLength={4000}
            placeholder="contoh: nett Agustus di layar beda dengan yang di laporan Word"
            onChange={(e) => setIsi(e.target.value)}
          />
        </div>

        <div className="fb-grup">
          <label className="fb-check">
            <input
              type="checkbox"
              checked={sertakan}
              onChange={(e) => setSertakan(e.target.checked)}
            />
            <span>Sertakan pertanyaan &amp; jawaban ini</span>
          </label>
          {/*
            Cuplikan percakapan adalah data sensitif: mode sales berisi angka
            omzet, dan mode umum bisa berisi isi dokumen yang dilampirkan user
            (termasuk laporan pasien). Mengirimnya diam-diam melanggar semangat
            SOUL.md. Karena itu isinya BISA DILIHAT sebelum dikirim, bukan
            sekadar dijanjikan lewat kalimat.
          */}
          <button className="fb-lihat" onClick={() => setLihatData((v) => !v)}>
            {lihatData ? '▾' : '▸'} Lihat apa yang dikirim
          </button>
          {lihatData && (
            <pre className="fb-pratinjau">
              {ringkasKiriman({ pertanyaan, pesan, sertakan })}
            </pre>
          )}
          <p className="hint">
            Terkirim juga: nama akun, divisi, nama komputer, versi aplikasi, dan tool yang dipakai
            AIRA.
          </p>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="dialog-actions">
          <button className="btn-teks" onClick={onBatal} disabled={kirim}>
            Batal
          </button>
          <button className="btn-send" onClick={() => void submit()} disabled={kirim}>
            {kirim ? 'Mengirim…' : 'Kirim'}
          </button>
        </div>
      </div>
    </div>
  )
}

/** Pratinjau apa yang benar-benar dikirim — mengikuti pilihan checkbox. */
function ringkasKiriman({
  pertanyaan,
  pesan,
  sertakan
}: {
  pertanyaan: string | null
  pesan: ChatMessage
  sertakan: boolean
}): string {
  const bagian: string[] = []
  if (sertakan) {
    bagian.push(`Pertanyaan saya:\n${pertanyaan ?? '(tidak ditemukan)'}`)
    bagian.push(`Jawaban AIRA:\n${pesan.content || '(kosong)'}`)
  } else {
    bagian.push('Pertanyaan & jawaban TIDAK dikirim (centang dicabut).')
  }
  const tool = pesan.toolLog ?? []
  bagian.push(
    tool.length > 0
      ? `Tool yang dipakai (selalu ikut — hanya nama & parameter, bukan isi data):\n${tool
          .map((t) => `· ${t.label ?? t.name} ${t.argsSummary}`)
          .join('\n')}`
      : 'Tool yang dipakai: tidak ada.'
  )
  return bagian.join('\n\n')
}

/** Error IPC datang terbungkus "Error invoking remote method '…': Error: pesan". */
function bersihkanError(err: unknown): string {
  const teks = err instanceof Error ? err.message : String(err)
  return teks.split('Error: ').pop() ?? teks
}
