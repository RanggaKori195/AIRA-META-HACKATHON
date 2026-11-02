import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { IconMic, IconStop } from './Icons'
import { useRecorder } from './mascot/useRecorder'
import { PENJELASAN_DIKTE } from '@shared/dikte'

/*
 * Tombol dikte suara. SATU komponen dipakai keenam kotak chat (Chat, Home,
 * SalesHome, InnoHome, LabHome, DriveHome).
 *
 * ⚠️ Sengaja tidak disalin per layar. Aturannya sama dengan `memuatNilaiData`
 * (§15): begitu ada dua salinan, yang longgar menang diam-diam — dan di sini
 * "longgar" berarti satu layar yang MENGIRIM hasil dikte tanpa dikoreksi.
 *
 * ⚠️ Hasil transkripsi TIDAK PERNAH dikirim otomatis. Ia hanya disisipkan ke
 * kotak teks (`onTeks`) supaya user membacanya dulu. Whisper sering salah pada
 * "ERP", "the lab", dan nama pelanggan; pertanyaan yang salah dengar
 * menghasilkan angka salah yang TETAP TERDENGAR MEYAKINKAN — kegagalan yang
 * seluruh arsitektur AIRA dibangun untuk mencegahnya (HANDOFF §10 no. 8).
 */

/** Sama dengan `MAKS_DETIK` di main. Rekaman dihentikan sendiri di batas ini. */
const MAKS_DETIK = 60

type Props = {
  /** Dipanggil dengan teks hasil dengar. Penerima MENYISIPKAN, tidak mengirim. */
  onTeks: (teks: string) => void
  /** Dimatikan saat AIRA sedang menjawab. */
  disabled?: boolean
}

type Fase = 'diam' | 'merekam' | 'memproses'

export function TombolDikte({ onTeks, disabled }: Props): JSX.Element | null {
  const [tersedia, setTersedia] = useState<boolean | null>(null)
  const [fase, setFase] = useState<Fase>('diam')
  const [detik, setDetik] = useState(0)
  /*
   * Pesan dibedakan jenisnya karena UMURNYA berbeda, bukan warnanya.
   * `catatan` (hasil dikte) hilang sendiri — ia sudah dibaca sekali dan
   * setelah itu cuma jadi bising. `galat` MENETAP sampai diklik: pesan seperti
   * "izin mikrofon ditolak, buka Pengaturan Windows" berisi langkah yang harus
   * dikerjakan, dan pesan yang lenyap sebelum sempat dikerjakan sama saja
   * dengan tidak ada pesan.
   */
  const [pesan, setPesan] = useState<{ teks: string; jenis: 'catatan' | 'galat' } | null>(null)

  const rekam = useRecorder()

  // Tombol disembunyikan sama sekali bila whisper tidak terpasang di laptop ini.
  // Tombol yang ada tapi selalu gagal lebih buruk daripada tombol yang tidak ada
  // (§46: model/user akan mencobanya berulang lalu mengarang sebabnya).
  useEffect(() => {
    let hidup = true
    window.aira
      .suaraTersedia()
      .then((v) => hidup && setTersedia(v))
      .catch(() => hidup && setTersedia(false))
    return () => {
      hidup = false
    }
  }, [])

  const selesaikan = useCallback(async () => {
    const wav = await rekam.stop()
    if (!wav) {
      setFase('diam')
      setPesan({ teks: 'No sound was recorded.', jenis: 'galat' })
      return
    }
    setFase('memproses')
    try {
      const hasil = await window.aira.transkripsikanSuara(wav)
      if (hasil.teks) onTeks(hasil.teks)
      // Catatan SELALU ditampilkan — user wajib tahu ini belum dikoreksi.
      setPesan({ teks: hasil.catatan, jenis: 'catatan' })
    } catch (e) {
      setPesan({ teks: e instanceof Error ? e.message : 'Transcription failed.', jenis: 'galat' })
    } finally {
      setFase('diam')
      setDetik(0)
    }
  }, [rekam, onTeks])

  // Simpan `selesaikan` terbaru supaya penghitung waktu di bawah tidak
  // memanggil versi lama saat batas MAKS_DETIK tercapai.
  const selesaikanRef = useRef(selesaikan)
  useEffect(() => {
    selesaikanRef.current = selesaikan
  }, [selesaikan])

  useEffect(() => {
    if (fase !== 'merekam') return
    const t = setInterval(() => {
      setDetik((d) => {
        if (d + 1 >= MAKS_DETIK) void selesaikanRef.current()
        return d + 1
      })
    }, 1000)
    return () => clearInterval(t)
  }, [fase])

  /*
   * Catatan sukses hilang sendiri sesudah 12 detik — cukup untuk dibaca, dan
   * sesudah dibaca ia cuma menutupi layar. Pesan `galat` sengaja TIDAK ikut:
   * isinya langkah yang harus dikerjakan user, dan peringatan yang lenyap
   * sebelum sempat dikerjakan sama saja dengan tidak ada peringatan.
   */
  useEffect(() => {
    if (pesan?.jenis !== 'catatan') return
    const t = setTimeout(() => setPesan(null), 12_000)
    return () => clearTimeout(t)
  }, [pesan])

  const mulai = useCallback(async () => {
    setPesan(null)
    try {
      await rekam.start()
      setDetik(0)
      setFase('merekam')
    } catch (e) {
      setFase('diam')
      setPesan({ jenis: 'galat', teks: e instanceof Error ? e.message : 'The microphone could not be opened.' })
    }
  }, [rekam])

  if (tersedia === false) return null

  const judul =
    fase === 'merekam'
      ? `Stop recording (${detik}/${MAKS_DETIK} s)`
      : fase === 'memproses'
        ? 'Transcribing speech…'
        : 'Voice dictation — the result goes into the text box so you can correct it first'

  return (
    <>
      <button
        type="button"
        className={`btn-attach${fase === 'merekam' ? ' merekam' : ''}`}
        onClick={() => void (fase === 'merekam' ? selesaikan() : mulai())}
        disabled={disabled || fase === 'memproses' || tersedia === null}
        title={judul}
        aria-label={judul}
      >
        {fase === 'merekam' ? <IconStop size={16} /> : <IconMic size={16} />}
      </button>
      {fase === 'merekam' && (
        <span className="dikte-status" role="status">
          recording {detik}s
        </span>
      )}
      {fase === 'memproses' && (
        <span className="dikte-status" role="status">
          transcribing…
        </span>
      )}
      {pesan && fase === 'diam' && (
        <span
          className={`dikte-pesan${pesan.jenis === 'galat' ? ' galat' : ''}`}
          role="status"
          onClick={() => setPesan(null)}
          // Penjelasan panjangnya di tooltip, bukan di layar — yang di layar
          // cukup peringatan singkatnya (permintaan user 6 Sep 2026).
          title={pesan.jenis === 'catatan' ? PENJELASAN_DIKTE : 'Click to dismiss'}
        >
          {pesan.teks}
        </span>
      )}
    </>
  )
}
