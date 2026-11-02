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
      <h3>What AIRA remembers about you</h3>
      <p className="hint">
        AIRA remembers what you ask it to. Just say it in chat, for example{' '}
        <em>“remember that I own the Genomics product”</em> or{' '}
        <em>“remember to always answer me with tables”</em>. What it remembers is taken into
        account in every later conversation.
      </p>
      {/*
        Batas ini disebutkan ke user, bukan disimpan sebagai rahasia teknis.
        Memori yang ditolak tanpa alasan yang terlihat membuat orang mengira
        fiturnya rusak.
      */}
      <p className="hint">
        AIRA also infers a few things from the way you ask — those are marked{' '}
        <span className="tag tag-netral">inferred by AIRA</span>. If something is wrong,
        just delete it; it will not be inferred again from the same conversation.
      </p>
      <p className="hint">
        AIRA does <strong>not</strong> remember sales figures or patient data — the numbers in
        the database keep changing, and an old remembered number would sound like a fact that
        still holds.
      </p>

      {error && <div className="error">{error}</div>}

      {rows.length === 0 ? (
        <p className="hint">Nothing remembered yet.</p>
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
                  <span className="tag tag-netral memori-tag" title="Inferred by AIRA from your conversations">
                    inferred by AIRA
                  </span>
                )}
              </span>
              <button
                className="btn-mini"
                title="Forget this"
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
