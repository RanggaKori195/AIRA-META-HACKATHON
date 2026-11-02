import { useState, type JSX } from 'react'
import type { ItemKpi, KartuVisual as Kartu, Panel, Satuan, Sel } from '@shared/visual'
import { IconDatabase } from './Icons'

// Kartu visual jawaban data (29 Sep 2026). HANYA menggambar — semua angka datang
// dari `KartuVisual` yang disusun main process dari hasil tool. Satu komponen
// untuk semua tool: KPI, batang horizontal, deret waktu, tabel.

const rb = (n: number): string => Math.round(n).toLocaleString('en-US')

/**
 * @param bertanda tanda "+" hanya untuk nilai PERUBAHAN (punya arah). Porsi
 *   kontribusi atau akurasi yang diberi "+" terbaca sebagai kenaikan.
 */
function format(n: number | null, s: Satuan, denganRp = true, bertanda = false): string {
  if (n === null) return '—'
  if (s === 'rp') {
    const teks = denganRp ? `IDR ${rb(Math.abs(n))}` : rb(Math.abs(n))
    return n < 0 ? `−${teks}` : teks
  }
  if (s === 'persen') return `${bertanda && n > 0 ? '+' : ''}${n.toLocaleString('en-US', { maximumFractionDigits: 1 })}%`
  // Hari sering pecahan (median TAT 2,5 hari) — dibulatkan ke bilangan bulat
  // berarti 2,5 tampil sebagai 3 dan terbaca lebih lambat dari kenyataan.
  if (s === 'hari') return `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })} days`
  return rb(n)
}

/** Axis abbreviations: B = billion, M = million. */
function singkat(n: number, s: Satuan): string {
  if (s === 'hari') return `${n.toLocaleString('en-US', { maximumFractionDigits: 1 })} d`
  if (s !== 'rp') return rb(n)
  if (Math.abs(n) >= 1e9) return `${(n / 1e9).toLocaleString('en-US', { maximumFractionDigits: 1 })}B`
  if (Math.abs(n) >= 1e6) return `${(n / 1e6).toLocaleString('en-US', { maximumFractionDigits: 0 })}M`
  return rb(n)
}

function Kpi({ item }: { item: ItemKpi[] }): JSX.Element {
  return (
    <div className="kv-kpi" style={{ gridTemplateColumns: `repeat(${Math.min(item.length, 4)}, minmax(0, 1fr))` }}>
      {item.map((i) => (
        <div key={i.label} className="kv-kpi-kartu">
          <small>{i.label}</small>
          <strong className={i.arah ?? ''}>
            {i.arah === 'naik' ? '↑ ' : i.arah === 'turun' ? '↓ ' : ''}
            {format(i.nilai, i.satuan, true, !!i.arah)}
          </strong>
          {i.catatan && <em>{i.catatan}</em>}
        </div>
      ))}
    </div>
  )
}

function Batang({ p }: { p: Extract<Panel, { jenis: 'batang' }> }): JSX.Element {
  const maks = Math.max(1, ...p.baris.map((b) => Math.abs(b.nilai)))
  return (
    <div className="kv-batang">
      {p.judul && <h5>{p.judul}</h5>}
      {p.baris.map((b, i) => (
        <div key={`${b.label}-${i}`} className="kv-batang-baris" title={`${b.label}: ${format(b.nilai, p.satuan)}`}>
          <span className="kv-batang-label">{b.label}</span>
          <span className="kv-batang-rel">
            <i style={{ width: `${Math.max(1.5, (Math.abs(b.nilai) / maks) * 100)}%` }} className={i === 0 ? 'utama' : ''} />
          </span>
          <span className="kv-batang-nilai">
            {singkat(b.nilai, p.satuan)}
            {b.catatan && <small> · {b.catatan}</small>}
          </span>
        </div>
      ))}
    </div>
  )
}

function Deret({ p }: { p: Extract<Panel, { jenis: 'deret' }> }): JSX.Element {
  // Kanvas lebar: kartu deret selalu selebar kartu, dan viewBox kecil membuat
  // huruf sumbu ikut membesar berlebihan saat diskalakan.
  const L = 1000
  const T = 300
  const kiri = 64
  const bawah = 32
  const atas = 12
  const n = p.titik.length
  const semua = [
    ...p.titik.map((t) => t.nilai),
    ...p.titik.map((t) => t.atas ?? 0),
    ...(p.pembanding?.nilai.map((v) => v ?? 0) ?? [])
  ]
  const maks = Math.max(1, ...semua)
  const kasar = maks / 5
  const pangkat = Math.pow(10, Math.floor(Math.log10(kasar)))
  const langkah = Math.ceil(kasar / pangkat) * pangkat
  const puncak = langkah * 5
  const kolom = (L - kiri - 8) / Math.max(1, n)
  const x = (i: number): number => kiri + kolom * i + kolom / 2
  const y = (v: number): number => atas + (T - atas - bawah) * (1 - v / puncak)
  const pakaiBatang = n <= 14 && !p.titik.some((t) => t.perkiraan)
  // Label sumbu X dijarangkan supaya tidak bertumpuk pada deret harian.
  const tiap = Math.max(1, Math.ceil(n / 12))
  const adaRentang = p.titik.some((t) => t.bawah != null && t.atas != null)
  return (
    <div className="kv-deret">
      {p.judul && <h5>{p.judul}</h5>}
      <div className="kv-legenda">
        <span>
          <i className="seri" /> {p.namaSeri ?? 'Value'}
        </span>
        {p.pembanding && (
          <span>
            <i className="banding" /> {p.pembanding.nama}
          </span>
        )}
        {adaRentang && (
          <span>
            <i className="pita" /> Estimate range
          </span>
        )}
      </div>
      <svg viewBox={`0 0 ${L} ${T}`} className="db-grafik" role="img" aria-label={p.judul ?? 'Series chart'}>
        {Array.from({ length: 6 }, (_, i) => (
          <g key={i}>
            <line x1={kiri} x2={L - 6} y1={y(langkah * i)} y2={y(langkah * i)} className="db-bantu" />
            <text x={kiri - 6} y={y(langkah * i) + 4} textAnchor="end" className="db-sumbu">
              {singkat(langkah * i, p.satuan)}
            </text>
          </g>
        ))}
        {adaRentang && (
          <polygon
            className="kv-pita"
            points={[
              ...p.titik.map((t, i) => `${x(i)},${y(t.atas ?? t.nilai)}`),
              ...[...p.titik].reverse().map((t, j) => `${x(n - 1 - j)},${y(t.bawah ?? t.nilai)}`)
            ].join(' ')}
          />
        )}
        {pakaiBatang &&
          p.titik.map((t, i) => {
            const lebar = Math.min(40, kolom * 0.55)
            return (
              <rect key={i} x={x(i) - lebar / 2} y={y(t.nilai)} width={lebar} height={Math.max(0, T - bawah - y(t.nilai))} rx={3} className="db-batang">
                <title>
                  {t.label}: {format(t.nilai, p.satuan)}
                </title>
              </rect>
            )
          })}
        {p.pembanding && (
          <polyline
            className="kv-garis-banding"
            points={p.pembanding.nilai.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean).join(' ')}
          />
        )}
        {/* Garis UTUH untuk angka yang sudah terjadi, PUTUS-PUTUS hanya mulai titik perkiraan
            pertama. Dulu satu titik perkiraan membuat SELURUH garis putus-putus — bulan aktual
            ikut terbaca sebagai ramalan (tertangkap dari screenshot 30 Sep). */}
        {(() => {
          const k = p.titik.findIndex((t) => t.perkiraan)
          const titikStr = (a: number, b: number): string => p.titik.slice(a, b).map((t, j) => `${x(a + j)},${y(t.nilai)}`).join(' ')
          if (k === -1) return <polyline className="db-garis" points={titikStr(0, n)} />
          return (
            <>
              {k > 0 && <polyline className="db-garis" points={titikStr(0, k)} />}
              <polyline className="db-garis putus" points={titikStr(Math.max(0, k - 1), n)} />
            </>
          )
        })()}
        {p.titik.map((t, i) => (
          <circle key={i} cx={x(i)} cy={y(t.nilai)} r={n > 20 ? 2.5 : 4} className="db-titik">
            <title>
              {t.label}: {format(t.nilai, p.satuan)}
              {t.bawah != null && t.atas != null ? ` (range ${format(t.bawah, p.satuan)} – ${format(t.atas, p.satuan)})` : ''}
            </title>
          </circle>
        ))}
        {p.titik.map((t, i) =>
          i % tiap === 0 || i === n - 1 ? (
            <text key={`l${i}`} x={x(i)} y={T - 10} textAnchor="middle" className="db-sumbu">
              {t.label}
            </text>
          ) : null
        )}
      </svg>
    </div>
  )
}

function SelTabel({ s }: { s: Sel }): JSX.Element {
  if (s === null) return <>—</>
  if (typeof s === 'string' || typeof s === 'number') return <>{typeof s === 'number' ? rb(s) : s}</>
  const teks = format(s.nilai, s.satuan, false, !!s.arah)
  return <span className={`db-persen ${s.arah ?? ''}`}>{s.arah === 'naik' ? '↑ ' : s.arah === 'turun' ? '↓ ' : ''}{teks}</span>
}

const BATAS_BARIS = 12

function Tabel({ p }: { p: Extract<Panel, { jenis: 'tabel' }> }): JSX.Element {
  const [semua, setSemua] = useState(false)
  const baris = semua ? p.baris : p.baris.slice(0, BATAS_BARIS)
  return (
    <div className="kv-tabel">
      {p.judul && <h5>{p.judul}</h5>}
      {p.baris.length === 0 ? (
        <p className="db-kosong">No rows.</p>
      ) : (
        <table className="db-tabel">
          <thead>
            <tr>
              {p.kolom.map((k) => (
                <th key={k.label} className={k.kanan ? 'kanan' : ''}>
                  {k.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {baris.map((r, i) => (
              <tr key={i}>
                {r.map((s, j) => (
                  <td key={j} className={p.kolom[j]?.kanan ? 'kanan' : 'db-nama'} title={typeof s === 'string' ? s : undefined}>
                    <SelTabel s={s} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {p.baris.length > BATAS_BARIS && (
        <button className="beranda-tautan kv-lagi" onClick={() => setSemua((x) => !x)}>
          {semua ? 'Show less' : `Show all (${p.baris.length})`}
        </button>
      )}
    </div>
  )
}

/** Panel batang + tabel, atau dua tabel berturut-turut, disandingkan dua kolom. */
function susun(panel: Panel[]): Array<Panel | [Panel, Panel]> {
  const hasil: Array<Panel | [Panel, Panel]> = []
  for (let i = 0; i < panel.length; i++) {
    const a = panel[i]
    const b = panel[i + 1]
    const sanding = b && ((a.jenis === 'batang' && b.jenis === 'tabel') || (a.jenis === 'tabel' && b.jenis === 'tabel' && a.judul && b.judul))
    if (sanding) {
      hasil.push([a, b])
      i++
    } else hasil.push(a)
  }
  return hasil
}

function GambarPanel({ p }: { p: Panel }): JSX.Element {
  if (p.jenis === 'kpi') return <Kpi item={p.item} />
  if (p.jenis === 'batang') return <Batang p={p} />
  if (p.jenis === 'deret') return <Deret p={p} />
  return <Tabel p={p} />
}

export function KartuVisual({ k }: { k: Kartu }): JSX.Element {
  const sumber = k.tool.startsWith('sales_') ? 'SalesRepository' : k.tool.startsWith('lab_') || k.tool === 'dashboard_lab' ? 'Sample tracking' : k.tool.startsWith('inno_') || k.tool === 'dashboard_inno' ? 'Master Data' : null
  return (
    <section className="db-kartu kv">
      <div className="db-kepala">
        <div>
          <h3>{k.judul}</h3>
          {k.sub && <p>{k.sub}</p>}
        </div>
        {sumber && (
          <span className="gambar-pilih db-sumber">
            <IconDatabase size={14} /> Source: {sumber}
          </span>
        )}
      </div>
      <div className="kv-isi">
        {susun(k.panel).map((x, i) =>
          Array.isArray(x) ? (
            <div key={i} className="db-baris">
              <GambarPanel p={x[0]} />
              <GambarPanel p={x[1]} />
            </div>
          ) : (
            <GambarPanel key={i} p={x} />
          )
        )}
      </div>
      {k.catatan.length > 0 && (
        <ul className="kv-catatan">
          {k.catatan.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      )}
    </section>
  )
}
