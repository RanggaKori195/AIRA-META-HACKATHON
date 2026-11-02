import { useCallback, useEffect, useState, type JSX } from 'react'
import type { MemoriRow } from '@shared/ipc'
import { IconTrash } from './Icons'

// "Yang diingat AIRA" — tampil untuk SEMUA role, bukan hanya Super Admin.
//
// ⚠️ Panel ini bukan kenyamanan, melainkan bagian dari fiturnya. Memori ikut ke
// system prompt setiap percakapan; kalau user tidak bisa MELIHAT apa yang
// diingat tentangnya, ia tidak punya cara membetulkan yang salah — dan yang
// salah itu akan terus menyetir jawaban tanpa ada yang tahu sebabnya.
//
// Sengaja tidak ada tombol "tambah". Memori lahir dari kalimat di chat
// ("ingat, saya pegang produk Genomics"), dibaca kode di orchestrator. Pintu
// kedua lewat form berarti dua jalur yang aturannya harus dijaga terpisah.

export default function MemoriPanel(): JSX.Element {
  const [rows, setRows] = useState<MemoriRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const muat = useCallback(async () => {
    try {
      setRows(await window.aira.listMemori())
      setError(null)
    } catch (err) {
      setError(bersihkanError(err))
    }
  }, [])

  useEffect(() => {
    void muat()
  }, [muat])

  const hapus = async (id: number): Promise<void> => {
    setBusy(true)
    try {
      setRows(await window.aira.hapusMemori(id))
      setError(null)
    } catch (err) {
      setError(bersihkanError(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="card">
      <h3>Yang diingat AIRA tentang kamu</h3>
      <p className="hint">
        AIRA mengingat hal yang kamu minta sendiri. Katakan saja di chat, misalnya{' '}
        <em>“ingat, saya pegang produk Genomics”</em> atau{' '}
        <em>“ingat, jawab saya selalu pakai tabel”</em>. Yang diingat ikut dipertimbangkan di
        setiap percakapan berikutnya.
      </p>
      {/*
        Batas ini disebutkan ke user, bukan disimpan sebagai rahasia teknis.
        Memori yang ditolak tanpa alasan yang terlihat membuat orang mengira
        fiturnya rusak.
      */}
      <p className="hint">
        AIRA juga menyimpulkan sendiri beberapa hal dari cara kamu bertanya — yang seperti itu
        ditandai <span className="tag tag-netral">disimpulkan AIRA</span>. Kalau ada yang keliru,
        hapus saja; ia tidak akan disimpulkan ulang dari percakapan yang sama.
      </p>
      <p className="hint">
        AIRA <strong>tidak</strong> mengingat angka penjualan atau data pasien — angka di
        database berubah terus, dan angka lama yang diingat akan terdengar seperti fakta yang
        masih berlaku.
      </p>

      {error && <div className="error">{error}</div>}

      {rows.length === 0 ? (
        <p className="hint">Belum ada yang diingat.</p>
      ) : (
        <ul className="memori-daftar">
          {rows.map((m) => (
            <li key={m.id} className="memori-item">
              <span>
                {m.isi}
                {/*
                  Yang disimpulkan AIRA sendiri WAJIB dibedakan dari yang user
                  katakan. Keduanya menuntut kepercayaan yang berbeda: yang
                  otomatis adalah tebakan model atas percakapan, dan user berhak
                  tahu mana yang ia sendiri tidak pernah ucapkan — kalau
                  dicampur, satu kesimpulan yang salah akan tampak seperti
                  sesuatu yang dulu ia setujui sendiri.
                */}
                {m.sumber === 'otomatis' && (
                  <span className="tag tag-netral memori-tag" title="Disimpulkan AIRA dari percakapan kamu">
                    disimpulkan AIRA
                  </span>
                )}
              </span>
              <button
                className="btn-mini"
                title="Lupakan ini"
                disabled={busy}
                onClick={() => void hapus(m.id)}
              >
                <IconTrash size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function bersihkanError(err: unknown): string {
  const teks = err instanceof Error ? err.message : String(err)
  return teks.split('Error: ').pop() ?? teks
}
