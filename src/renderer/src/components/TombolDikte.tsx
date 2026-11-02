import { useCallback, useEffect, useRef, useState, type JSX } from 'react'
import { IconMic, IconStop } from './Icons'
import { enkodeWav, gabungPotongan, turunkanSampel, WAV_SAMPLE_RATE } from '@shared/wav'
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

  const ctxRef = useRef<AudioContext | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const prosesorRef = useRef<ScriptProcessorNode | null>(null)
  const potonganRef = useRef<Float32Array[]>([])
  const lajuRef = useRef<number>(WAV_SAMPLE_RATE)

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

  /** Melepas mikrofon. Wajib dipanggil di SETIAP jalan keluar. */
  const bersihkan = useCallback(() => {
    prosesorRef.current?.disconnect()
    prosesorRef.current = null
    // ⚠️ Track WAJIB di-stop, bukan cuma context ditutup. Kalau tidak, lampu
    // "mikrofon aktif" di Windows tetap menyala sesudah user selesai bicara —
    // di aplikasi korporat itu terlihat seperti AIRA menyadap diam-diam.
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    void ctxRef.current?.close().catch(() => {})
    ctxRef.current = null
  }, [])

  useEffect(() => bersihkan, [bersihkan])

  const selesaikan = useCallback(async () => {
    const potongan = potonganRef.current
    const laju = lajuRef.current
    potonganRef.current = []
    bersihkan()

    if (!potongan.length) {
      setFase('diam')
      setPesan({ teks: 'Tidak ada suara yang terekam.', jenis: 'galat' })
      return
    }
    setFase('memproses')
    try {
      const pcm = turunkanSampel(gabungPotongan(potongan), laju, WAV_SAMPLE_RATE)
      const hasil = await window.aira.transkripsikanSuara(enkodeWav(pcm))
      if (hasil.teks) onTeks(hasil.teks)
      // Catatan SELALU ditampilkan — user wajib tahu ini belum dikoreksi.
      setPesan({ teks: hasil.catatan, jenis: 'catatan' })
    } catch (e) {
      setPesan({ teks: e instanceof Error ? e.message : 'Transkripsi gagal.', jenis: 'galat' })
    } finally {
      setFase('diam')
      setDetik(0)
    }
  }, [bersihkan, onTeks])

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
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          // Pembersihan bawaan browser: sangat membantu di ruang kerja terbuka.
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      })
      streamRef.current = stream
      // Meminta 16 kHz langsung supaya tidak perlu menurunkan laju. Permintaan
      // ini TIDAK dijamin dituruti — karena itu laju sebenarnya dibaca ulang di
      // bawah dan `turunkanSampel` tetap dipakai bila berbeda.
      const ctx = new AudioContext({ sampleRate: WAV_SAMPLE_RATE })
      ctxRef.current = ctx
      lajuRef.current = ctx.sampleRate

      const sumber = ctx.createMediaStreamSource(stream)
      /*
       * ScriptProcessorNode memang sudah usang, tapi dipilih sadar: AudioWorklet
       * menuntut modul terpisah yang dimuat lewat URL, dan itu berkelahi dengan
       * cara Vite membundel renderer. Bebannya kecil (satu kanal, 16 kHz) dan
       * ia bekerja di semua versi Chromium yang dipakai Electron.
       */
      const prosesor = ctx.createScriptProcessor(4096, 1, 1)
      potonganRef.current = []
      prosesor.onaudioprocess = (e): void => {
        // Disalin: buffer milik Web Audio dipakai ulang untuk blok berikutnya.
        potonganRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)))
      }
      sumber.connect(prosesor)
      prosesor.connect(ctx.destination)
      prosesorRef.current = prosesor

      setDetik(0)
      setFase('merekam')
    } catch (e) {
      bersihkan()
      setFase('diam')
      // Penolakan izin mikrofon adalah sebab terbanyak, dan pesan bawaannya
      // ("Permission denied") tidak memberi tahu apa yang harus dilakukan.
      const nama = e instanceof DOMException ? e.name : ''
      setPesan({
        jenis: 'galat',
        teks:
          nama === 'NotAllowedError'
            ? 'Izin mikrofon ditolak. Buka Pengaturan Windows > Privasi > Mikrofon, lalu izinkan AIRA.'
            : nama === 'NotFoundError'
              ? 'Tidak ada mikrofon yang terdeteksi di laptop ini.'
              : e instanceof Error
                ? e.message
                : 'Mikrofon tidak bisa dibuka.'
      })
    }
  }, [bersihkan])

  if (tersedia === false) return null

  const judul =
    fase === 'merekam'
      ? `Berhenti merekam (${detik}/${MAKS_DETIK} dtk)`
      : fase === 'memproses'
        ? 'Sedang menyalin suara…'
        : 'Dikte suara — hasilnya masuk ke kotak teks untuk kamu koreksi dulu'

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
          merekam {detik}s
        </span>
      )}
      {fase === 'memproses' && (
        <span className="dikte-status" role="status">
          menyalin…
        </span>
      )}
      {pesan && fase === 'diam' && (
        <span
          className={`dikte-pesan${pesan.jenis === 'galat' ? ' galat' : ''}`}
          role="status"
          onClick={() => setPesan(null)}
          // Penjelasan panjangnya di tooltip, bukan di layar — yang di layar
          // cukup peringatan singkatnya (permintaan user 6 Sep 2026).
          title={pesan.jenis === 'catatan' ? PENJELASAN_DIKTE : 'Klik untuk menutup'}
        >
          {pesan.teks}
        </span>
      )}
    </>
  )
}
