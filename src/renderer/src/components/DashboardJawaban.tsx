import { useState, type JSX } from 'react'
import type { BarisBanding, DashboardSales as Dashboard } from '@shared/dashboard'
import { IconCalendar, IconChart, IconDatabase, IconFileText, IconTable, IconTrend } from './Icons'

// Dashboard jawaban (29 Sep 2026, mockup "Ringkasan Perbandingan Sales").
//
// ⚠️ Komponen ini HANYA menggambar. Semua angka datang dari `Dashboard` yang
// disusun main process dari hasil tool — tidak ada satu pun angka yang dihitung
// ulang di sini selain format tampilan (aturan 49: grafik & tabel dari data yang
// sama). Tombol aksi mengirim PERTANYAAN yang terlihat di chat, bukan perintah
// tersembunyi.

const angka = (n: number): string => Math.round(n).toLocaleString('id-ID')
const rp = (n: number): string => `Rp ${angka(n)}`

/** Singkatan sumbu grafik: M = miliar, jt = juta (kebiasaan laporan Indonesia). */
function rpSingkat(n: number): string {
  if (Math.abs(n) >= 1e9) return `Rp ${(n / 1e9).toLocaleString('id-ID', { maximumFractionDigits: 1 })} M`
  if (Math.abs(n) >= 1e6) return `Rp ${(n / 1e6).toLocaleString('id-ID', { maximumFractionDigits: 0 })} jt`
  return `Rp ${angka(n)}`
}

function Persen({ p }: { p: number | null }): JSX.Element {
  if (p === null) return <span className="db-persen kosong">—</span>
  const kelas = p > 0 ? 'naik' : p < 0 ? 'turun' : ''
  return (
    <span className={`db-persen ${kelas}`}>
      {p > 0 ? '↑' : p < 0 ? '↓' : ''} {Math.abs(p).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%
    </span>
  )
}

/** Kapital huruf pertama — label periode dari tool ditulis huruf kecil ("bulan ini"). */
const kapital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

function Grafik({ tren, garis }: { tren: Dashboard['tren']; garis: boolean }): JSX.Element {
  const L = 560
  const T = 230
  const kiri = 64
  const bawah = 30
  const atas = 12
  const maks = Math.max(1, ...tren.map((t) => t.nett))
  // Pembulatan sumbu ke angka "enak" supaya garis bantu terbaca.
  const langkahKasar = maks / 5
  const pangkat = Math.pow(10, Math.floor(Math.log10(langkahKasar)))
  const langkah = Math.ceil(langkahKasar / pangkat) * pangkat
  const puncak = langkah * 5
  const lebarKolom = (L - kiri - 10) / Math.max(1, tren.length)
  const y = (v: number): number => atas + (T - atas - bawah) * (1 - v / puncak)
  const titik = tren.map((t, i) => ({ x: kiri + lebarKolom * i + lebarKolom / 2, y: y(t.nett) }))
  return (
    <svg className="db-grafik" viewBox={`0 0 ${L} ${T}`} role="img" aria-label="Tren penjualan per bulan">
      {Array.from({ length: 6 }, (_, i) => {
        const v = langkah * i
        return (
          <g key={i}>
            <line x1={kiri} x2={L - 6} y1={y(v)} y2={y(v)} className="db-bantu" />
            <text x={kiri - 8} y={y(v) + 4} textAnchor="end" className="db-sumbu">
              {rpSingkat(v)}
            </text>
          </g>
        )
      })}
      {!garis &&
        tren.map((t, i) => {
          const lebar = Math.min(46, lebarKolom * 0.55)
          const x = kiri + lebarKolom * i + (lebarKolom - lebar) / 2
          return (
            <rect
              key={t.bulan}
              x={x}
              y={y(t.nett)}
              width={lebar}
              height={Math.max(0, T - bawah - y(t.nett))}
              rx={3}
              className={`db-batang ${i === tren.length - 1 ? 'akhir' : ''} ${t.sebagian ? 'sebagian' : ''}`}
            >
              <title>
                {t.bulan}: {rp(t.nett)}
                {t.sebagian ? ' (bulan berjalan)' : ''}
              </title>
            </rect>
          )
        })}
      <polyline points={titik.map((p) => `${p.x},${p.y}`).join(' ')} className="db-garis" />
      {titik.map((p, i) => (
        <circle key={i} cx={p.x} cy={p.y} r={4} className="db-titik">
          <title>
            {tren[i].bulan}: {rp(tren[i].nett)}
          </title>
        </circle>
      ))}
      {tren.map((t, i) => (
        <text key={t.bulan} x={titik[i].x} y={T - 10} textAnchor="middle" className="db-sumbu">
          {t.bulan}
          {t.sebagian ? '*' : ''}
        </text>
      ))}
    </svg>
  )
}

function TabelBanding({
  judul,
  kolom,
  baris,
  labelKini,
  labelLalu,
  bernomor
}: {
  judul: string
  kolom: string
  baris: BarisBanding[]
  labelKini: string
  labelLalu: string
  bernomor?: boolean
}): JSX.Element {
  return (
    <section className="db-kartu">
      <h4>{judul}</h4>
      {baris.length === 0 ? (
        <p className="db-kosong">Tidak ada data pada periode ini.</p>
      ) : (
        <table className="db-tabel">
          <thead>
            <tr>
              {bernomor && <th>#</th>}
              <th>{kolom}</th>
              <th className="kanan">{kapital(labelKini)}</th>
              <th className="kanan">{kapital(labelLalu)}</th>
              <th className="kanan">% Change</th>
            </tr>
          </thead>
          <tbody>
            {baris.map((r, i) => (
              <tr key={r.nama}>
                {bernomor && <td>{i + 1}</td>}
                <td className="db-nama" title={r.nama}>
                  {r.nama}
                </td>
                <td className="kanan">{angka(r.kini)}</td>
                <td className="kanan">{r.lalu === null ? '—' : angka(r.lalu)}</td>
                <td className="kanan">
                  <Persen p={r.persen} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {baris.some((r) => r.lalu === null) && (
        <p className="db-catatan">— = tidak ada di 50 teratas {labelLalu}, jadi persennya tidak dihitung (bukan berarti nol).</p>
      )}
    </section>
  )
}

export function DashboardJawaban({
  d,
  onTanya,
  onIsi
}: {
  d: Dashboard
  /** Kirim pertanyaan lanjutan (terlihat di chat). */
  onTanya: (teks: string) => void
  /** Isi kotak tulis tanpa mengirim — untuk aksi yang butuh ketikan user. */
  onIsi: (teks: string) => void
}): JSX.Element {
  const [garis, setGaris] = useState(false)
  const { kpi } = d
  const naik = kpi.selisih > 0
  return (
    <div className="db">
      <section className="db-kartu db-ringkas">
        <div className="db-kepala">
          <div>
            <h3>Ringkasan Perbandingan Sales</h3>
            <p>
              <strong>Periode:</strong> {kapital(d.labelKini)} ({d.rentangKini}) vs {d.labelLalu} ({d.rentangLalu}) ·
              basis {d.basis === 'order' ? 'order masuk' : 'invoice (tanggal hasil)'}
            </p>
            {d.catatanPeriode && <p className="db-catatan">{d.catatanPeriode}</p>}
            {d.filter.length > 0 && (
              <div className="db-filter">
                {d.filter.map((f) => (
                  <span key={f}>{f}</span>
                ))}
              </div>
            )}
          </div>
          <span className="gambar-pilih db-sumber">
            <IconDatabase size={14} /> Sumber: SalesRepository
          </span>
        </div>
        <div className="db-kpi">
          <div className="db-kpi-kartu">
            <span className="tile-ikon hijau">
              <IconChart size={22} />
            </span>
            <span>
              <small>Sales {kapital(d.labelKini)}</small>
              <strong className="hijau">{rp(kpi.nettKini)}</strong>
              {kpi.persen !== null && (
                <em>
                  <Persen p={kpi.persen} /> vs {d.labelLalu}
                </em>
              )}
            </span>
          </div>
          <div className="db-kpi-kartu">
            <span className="tile-ikon biru">
              <IconCalendar size={22} />
            </span>
            <span>
              <small>Sales {kapital(d.labelLalu)}</small>
              <strong>{rp(kpi.nettLalu)}</strong>
            </span>
          </div>
          <div className="db-kpi-kartu">
            <span className="tile-ikon ungu db-persen-ikon">%</span>
            <span>
              <small>Selisih</small>
              <strong>
                {naik ? '' : kpi.selisih < 0 ? '−' : ''}
                {rp(Math.abs(kpi.selisih))}
              </strong>
            </span>
          </div>
          <div className="db-kpi-kartu">
            <span className="tile-ikon oranye">
              <IconTrend size={22} />
            </span>
            <span>
              <small>Pertumbuhan</small>
              <strong>
                {kpi.persen === null
                  ? '—'
                  : `${kpi.persen > 0 ? '+' : ''}${kpi.persen.toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`}
              </strong>
              {kpi.orderKini !== null && (
                <em>
                  {angka(kpi.orderKini)} order{kpi.pelangganKini !== null ? ` · ${angka(kpi.pelangganKini)} pelanggan` : ''}
                </em>
              )}
            </span>
          </div>
        </div>
      </section>

      <div className="db-baris">
        <section className="db-kartu">
          <div className="db-kartu-kepala">
            <h4>Tren Sales {d.tren.length} Bulan Terakhir</h4>
            <span className="db-legenda">
              <i className="kotak" /> Sales (Rp) <i className="garis" /> Tren
            </span>
          </div>
          {d.tren.length === 0 ? (
            <p className="db-kosong">Tren tidak tersedia.</p>
          ) : (
            <>
              <Grafik tren={d.tren} garis={garis} />
              {d.tren.some((t) => t.sebagian) && <p className="db-catatan">* bulan berjalan, belum genap.</p>}
            </>
          )}
        </section>
        <TabelBanding
          judul="Perbandingan per Kategori Layanan"
          kolom="Kategori"
          baris={d.kategori}
          labelKini={d.labelKini}
          labelLalu={d.labelLalu}
        />
      </div>

      <div className="db-baris">
        <TabelBanding
          judul={`Top ${d.pelanggan.length || 10} Pelanggan Berdasarkan Sales ${kapital(d.labelKini)}`}
          kolom="Pelanggan"
          baris={d.pelanggan}
          labelKini={d.labelKini}
          labelLalu={d.labelLalu}
          bernomor
        />
        <TabelBanding
          judul="Perbandingan per Wilayah (Provinsi)"
          kolom="Wilayah"
          baris={d.wilayah}
          labelKini={d.labelKini}
          labelLalu={d.labelLalu}
        />
      </div>

      {d.gagal.length > 0 && (
        <p className="db-catatan db-gagal">Panel yang gagal diambil: {d.gagal.join(', ')}. Angka lain tetap sah.</p>
      )}

      <div className="db-aksi">
        <button onClick={() => setGaris((x) => !x)}>
          <IconChart size={15} /> {garis ? 'Tampilkan grafik batang' : 'Tampilkan grafik garis'}
        </button>
        <button onClick={() => onIsi(`Bandingkan sales ${d.labelKini} dengan ${d.labelLalu} di provinsi `)}>
          <IconDatabase size={15} /> Filter per wilayah
        </button>
        <button onClick={() => onTanya(`Buatkan laporan penjualan ${d.labelKini} versi Excel`)}>
          <IconTable size={15} /> Export ke Excel
        </button>
        <button onClick={() => onTanya(`Buatkan laporan penjualan ${d.labelKini} versi PDF`)}>
          <IconFileText size={15} /> Simpan sebagai laporan
        </button>
      </div>
    </div>
  )
}
