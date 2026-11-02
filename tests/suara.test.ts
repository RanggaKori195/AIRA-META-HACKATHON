import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import {
  argumenWhisper,
  bacaTranskrip,
  catatanTranskrip,
  kandidatDirWhisper,
  MAKS_DETIK,
  periksaWav,
  SAMPLE_RATE
} from '../src/main/suara/rules'
import { enkodeWav, gabungPotongan, turunkanSampel } from '../src/shared/wav'
import { PENJELASAN_DIKTE } from '../src/shared/dikte'

/** Menyusun WAV PCM sungguhan supaya pemeriksanya diuji pada bentuk asli. */
function buatWav(detik: number, sampleRate = SAMPLE_RATE, kanal = 1, bit = 16): Uint8Array {
  const nSample = Math.round(detik * sampleRate)
  const dataBytes = nSample * kanal * (bit / 8)
  const buf = new Uint8Array(44 + dataBytes)
  const dv = new DataView(buf.buffer)
  const tulis = (o: number, s: string): void => {
    for (let i = 0; i < s.length; i++) buf[o + i] = s.charCodeAt(i)
  }
  tulis(0, 'RIFF')
  dv.setUint32(4, 36 + dataBytes, true)
  tulis(8, 'WAVE')
  tulis(12, 'fmt ')
  dv.setUint32(16, 16, true)
  dv.setUint16(20, 1, true)
  dv.setUint16(22, kanal, true)
  dv.setUint32(24, sampleRate, true)
  dv.setUint32(28, sampleRate * kanal * (bit / 8), true)
  dv.setUint16(32, kanal * (bit / 8), true)
  dv.setUint16(34, bit, true)
  tulis(36, 'data')
  dv.setUint32(40, dataBytes, true)
  return buf
}

describe('suara / periksaWav', () => {
  test('WAV 16 kHz mono 16-bit diterima', () => {
    const h = periksaWav(buatWav(3))
    assert.equal(h.ok, true)
    if (h.ok) {
      assert.equal(h.sampleRate, SAMPLE_RATE)
      assert.equal(h.kanal, 1)
      assert.ok(Math.abs(h.detik - 3) < 0.01)
    }
  })

  test('stereo ditolak — whisper.cpp meminta mono', () => {
    const h = periksaWav(buatWav(3, SAMPLE_RATE, 2))
    assert.equal(h.ok, false)
    if (!h.ok) assert.match(h.alasan, /mono/)
  })

  test('44,1 kHz ditolak — renderer wajib menurunkan cuplikannya dulu', () => {
    // Kalau ini lolos, whisper menerima audio yang kecepatannya salah dan
    // menghasilkan transkrip ngawur TANPA error — terlihat seperti model jelek.
    const h = periksaWav(buatWav(3, 44_100))
    assert.equal(h.ok, false)
    if (!h.ok) assert.match(h.alasan, /16000 Hz/)
  })

  test('bukan WAV ditolak sebelum menyentuh whisper', () => {
    const h = periksaWav(new Uint8Array(100))
    assert.equal(h.ok, false)
    if (!h.ok) assert.match(h.alasan, /bukan berkas WAV/)
  })

  test('rekaman kosong ditolak dengan alasan yang bisa dibaca orang', () => {
    const h = periksaWav(buatWav(0.05))
    assert.equal(h.ok, false)
    if (!h.ok) assert.match(h.alasan, /terlalu pendek/)
  })

  test('rekaman melebihi batas ditolak', () => {
    const h = periksaWav(buatWav(MAKS_DETIK + 10))
    assert.equal(h.ok, false)
    if (!h.ok) assert.match(h.alasan, /melebihi batas/)
  })
})

describe('suara / bacaTranskrip', () => {
  test('teks polos dipakai apa adanya', () => {
    assert.equal(bacaTranskrip('Berapa nett sales bulan ini\n'), 'Berapa nett sales bulan ini')
  })

  test('cap waktu dibuang bila formatnya kembali muncul', () => {
    // Bentuk ini tidak seharusnya muncul karena `-nt`, tapi kalau flag-nya
    // kelak berubah, cap waktu TIDAK boleh mendarat di kotak chat user.
    const keluaran =
      '[00:00:00.000 --> 00:00:03.000]   Berapa sales bulan ini\n' +
      '[00:00:03.000 --> 00:00:05.000]   dibanding bulan lalu\n'
    assert.equal(bacaTranskrip(keluaran), 'Berapa sales bulan ini dibanding bulan lalu')
  })

  test('penanda hening bukan kata — tidak boleh ikut ke kotak chat', () => {
    assert.equal(bacaTranskrip('[BLANK_AUDIO]\n'), '')
    assert.equal(bacaTranskrip('(Music)\nhalo\n'), 'halo')
  })

  test('kata KARANGAN dalam kurung dibuang (lapangan 6 Sep 2026)', () => {
    // Keluaran NYATA whisper-cli saat diberi nada murni 220 Hz — bukan ucapan
    // sama sekali. Daftar-larangan versi pertama tidak menjaringnya, jadi kata
    // yang tak pernah diucapkan akan mendarat di kotak chat user.
    assert.equal(bacaTranskrip('\r\n [singgung]'), '')
    assert.equal(bacaTranskrip('[terima kasih]'), '')
    assert.equal(bacaTranskrip('(suara mesin).'), '')
  })

  test('kurung DI DALAM kalimat tetap utuh — yang dibuang hanya baris penuh', () => {
    // Jangan sampai guard ini membuang ucapan yang sah. Kalimat yang KEBETULAN
    // memuat kurung adalah kalimat, bukan anotasi.
    assert.equal(
      bacaTranskrip('Berapa sales KAL-Onco (Breast) bulan ini'),
      'Berapa sales KAL-Onco (Breast) bulan ini'
    )
  })

  test('audio tanpa suara menghasilkan string kosong, bukan sampah', () => {
    assert.equal(bacaTranskrip('\n\n   \n'), '')
  })
})

describe('suara / argumenWhisper', () => {
  test('bahasa dipatok id — auto-detect tidak boleh dipakai', () => {
    // Kalimat pendek beristilah Inggris ("berapa nett sales") gampang
    // terdeteksi sebagai bahasa Inggris; sekali salah bahasa, seluruh
    // kalimat kacau, bukan cuma satu kata.
    const a = argumenWhisper('m.bin', 'a.wav', 4)
    const i = a.indexOf('-l')
    assert.notEqual(i, -1)
    assert.equal(a[i + 1], 'id')
  })

  test('cap waktu dimatikan supaya keluarannya teks polos', () => {
    assert.ok(argumenWhisper('m.bin', 'a.wav', 4).includes('-nt'))
  })

  test('jumlah benang dijepit ke rentang masuk akal', () => {
    const ambil = (n: number): string => {
      const a = argumenWhisper('m.bin', 'a.wav', n)
      return a[a.indexOf('-t') + 1]
    }
    assert.equal(ambil(0), '1')
    assert.equal(ambil(64), '8')
    assert.equal(ambil(4), '4')
  })
})

describe('suara / kandidatDirWhisper', () => {
  test('mencari di beberapa jangkar, bukan satu', () => {
    // Pelajaran §20/§24/§47: satu jangkar berarti fitur mati HANYA di
    // aplikasi terpasang, dan itu baru ketahuan sesudah dibagikan ke orang.
    const d = kandidatDirWhisper('/app', '/res', '/app/out/main')
    assert.ok(d.length > 1)
    assert.ok(d.some((x) => x.includes('res')))
    assert.ok(d.some((x) => x.includes('resources')))
  })

  test('tidak ada kandidat kembar', () => {
    const d = kandidatDirWhisper('/app', '/res', '/app/out/main')
    assert.equal(d.length, new Set(d).size)
  })
})

describe('suara / catatanTranskrip', () => {
  test('tidak pernah kosong — user wajib tahu ini belum dikoreksi', () => {
    assert.ok(catatanTranskrip('halo').length > 0)
    assert.ok(catatanTranskrip('').length > 0)
  })

  test('singkat — muat satu baris di layar (permintaan user 6 Sep 2026)', () => {
    // Versi pertama tiga baris penuh dan memuat angka durasi yang sebenarnya
    // data pengembang. Peringatan sepanjang itu berhenti dibaca sesudah
    // pemakaian kedua, jadi panjangnya melemahkan gunanya sendiri.
    const c = catatanTranskrip('berapa sales bulan ini')
    assert.ok(c.length <= 90, `terlalu panjang (${c.length}): ${c}`)
    assert.match(c, /belum dikoreksi/)
  })

  test('TIDAK memuat angka durasi — itu milik log, bukan layar', () => {
    assert.doesNotMatch(catatanTranskrip('halo'), /detik|\d+[.,]\d/)
  })

  test('penjelasan panjang tetap ada, tapi di tooltip', () => {
    // Sebabnya tidak boleh hilang, hanya pindah tempat.
    assert.match(PENJELASAN_DIKTE, /ERP/)
    assert.match(PENJELASAN_DIKTE, /the lab/)
  })

  test('hasil kosong memberi langkah, bukan sekadar "gagal"', () => {
    assert.match(catatanTranskrip(''), /mikrofon/)
  })
})

describe('suara / wav bolak-balik (enkoder renderer vs pemeriksa main)', () => {
  test('WAV buatan renderer DITERIMA pemeriksa main', () => {
    // Ini pemeriksaan terpenting di berkas ini. Enkoder ada di renderer,
    // pemeriksa ada di main; kalau keduanya menyimpang soal bentuk WAV,
    // gejalanya BUKAN error melainkan transkrip ngawur — dan itu akan
    // dikira "Whisper-nya jelek", bukan bug bentuk berkas.
    const pcm = new Float32Array(SAMPLE_RATE * 2) // 2 detik
    for (let i = 0; i < pcm.length; i++) pcm[i] = Math.sin(i / 20) * 0.5
    const hasil = periksaWav(enkodeWav(pcm))
    assert.equal(hasil.ok, true)
    if (hasil.ok) {
      assert.equal(hasil.sampleRate, SAMPLE_RATE)
      assert.equal(hasil.kanal, 1)
      assert.ok(Math.abs(hasil.detik - 2) < 0.01)
    }
  })

  test('nilai di luar -1..1 dijepit, tidak meluap jadi derak', () => {
    // Sampel yang meluap berbalik tanda dan terdengar sebagai derak keras;
    // whisper mentranskripsikan derak itu jadi kata yang tak pernah diucapkan.
    const pcm = new Float32Array([2, -2, 0.5, -0.5])
    const wav = enkodeWav(pcm)
    const dv = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
    assert.equal(dv.getInt16(44, true), 32767)
    assert.equal(dv.getInt16(46, true), -32768)
  })

  test('turunkanSampel 48 kHz -> 16 kHz memangkas panjang jadi sepertiga', () => {
    const masuk = new Float32Array(48_000)
    const keluar = turunkanSampel(masuk, 48_000, SAMPLE_RATE)
    assert.equal(keluar.length, 16_000)
  })

  test('laju yang sudah benar dilewatkan apa adanya', () => {
    const masuk = new Float32Array(1000)
    assert.equal(turunkanSampel(masuk, SAMPLE_RATE, SAMPLE_RATE).length, 1000)
  })

  test('rekaman 48 kHz yang diturunkan dulu lolos pemeriksa main', () => {
    // Jalur yang benar-benar dipakai bila driver mengabaikan permintaan 16 kHz.
    const mentah = new Float32Array(48_000 * 3) // 3 detik @48 kHz
    const wav = enkodeWav(turunkanSampel(mentah, 48_000, SAMPLE_RATE))
    const h = periksaWav(wav)
    assert.equal(h.ok, true)
    if (h.ok) assert.ok(Math.abs(h.detik - 3) < 0.02)
  })

  test('gabungPotongan menyambung tanpa kehilangan sampel', () => {
    const g = gabungPotongan([new Float32Array([1, 2]), new Float32Array([3]), new Float32Array([4, 5])])
    assert.deepEqual(Array.from(g), [1, 2, 3, 4, 5])
  })
})
