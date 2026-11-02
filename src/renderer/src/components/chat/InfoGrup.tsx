import { useCallback, useEffect, useState, type JSX } from 'react'
import type { InfoGrup as DataInfoGrup, RekanChat } from '@shared/ipc'
import ConfirmDialog from '../ConfirmDialog'
import { IconBell, IconBellOff, IconClose, IconLogout, IconPencil, IconPlus } from '../Icons'
import { Avatar } from './Avatar'
import { PilihAnggota } from './PilihAnggota'
import { bersih } from './BuatGrup'

/**
 * Panel info grup — menimpa ruang chat dari kanan, seperti WhatsApp.
 *
 * ⚠️ Tombol admin disembunyikan untuk anggota biasa, tapi itu KENYAMANAN. Yang
 * menolak adalah klausa WHERE di `chat/grup.ts`; panel ini tidak pernah
 * memberi tahu main process "saya admin".
 */
export function InfoGrup({
  grupId,
  saya,
  rekan,
  senyap,
  onSenyap,
  onTutup,
  onBerubah,
  onKeluar
}: {
  grupId: string
  saya: string
  rekan: readonly RekanChat[]
  senyap: boolean
  onSenyap: () => void
  onTutup: () => void
  /** Ada perubahan (nama, anggota) — daftar & ruang chat perlu dimuat ulang. */
  onBerubah: () => void
  onKeluar: () => void
}): JSX.Element {
  const [info, setInfo] = useState<DataInfoGrup | null>(null)
  const [galat, setGalat] = useState<string | null>(null)
  const [ubahNama, setUbahNama] = useState<string | null>(null)
  const [menambah, setMenambah] = useState(false)
  const [calon, setCalon] = useState<string[]>([])
  const [konfirmasi, setKonfirmasi] = useState<
    { jenis: 'keluar' } | { jenis: 'keluarkan'; username: string } | null
  >(null)
  const [sibuk, setSibuk] = useState(false)

  const muat = useCallback(async () => {
    try {
      setInfo(await window.aira.chatGrupInfo(grupId))
      setGalat(null)
    } catch (e) {
      setGalat(bersih(e))
    }
  }, [grupId])

  useEffect(() => {
    void muat()
  }, [muat])

  const jalankan = useCallback(
    async (kerja: () => Promise<unknown>) => {
      setSibuk(true)
      setGalat(null)
      try {
        await kerja()
        await muat()
        onBerubah()
      } catch (e) {
        setGalat(bersih(e))
      } finally {
        setSibuk(false)
      }
    },
    [muat, onBerubah]
  )

  if (!info) {
    return (
      <aside className="psn-info">
        <div className="psn-info-kepala">
          <button className="psn-ikon" onClick={onTutup} title="Tutup">
            <IconClose size={16} />
          </button>
          <strong>Info grup</strong>
        </div>
        <p className="psn-kosong">{galat ?? 'Memuat…'}</p>
      </aside>
    )
  }

  const { grup, anggota } = info
  const admin = grup.aktif && grup.peranSaya === 'admin'
  const aku = saya.toLowerCase()

  return (
    <aside className="psn-info">
      <div className="psn-info-kepala">
        <button className="psn-ikon" onClick={onTutup} title="Tutup">
          <IconClose size={16} />
        </button>
        <strong>Info grup</strong>
      </div>

      <div className="psn-info-isi">
        <div className="psn-info-sampul">
          <Avatar nama={grup.nama} grup ukuran={72} />
          {ubahNama === null ? (
            <h3>
              {grup.nama}
              {admin && (
                <button className="psn-ikon kecil" onClick={() => setUbahNama(grup.nama)} title="Ganti nama grup">
                  <IconPencil size={13} />
                </button>
              )}
            </h3>
          ) : (
            <div className="psn-ubah-nama">
              <input
                value={ubahNama}
                maxLength={60}
                autoFocus
                onChange={(e) => setUbahNama(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setUbahNama(null)
                  if (e.key === 'Enter' && ubahNama.trim()) {
                    const n = ubahNama
                    setUbahNama(null)
                    void jalankan(() => window.aira.chatGrupGantiNama(grupId, n))
                  }
                }}
              />
              <span className="psn-hitung">Enter untuk simpan · Esc batal</span>
            </div>
          )}
          <span className="psn-info-sub">Grup · {anggota.length} anggota</span>
        </div>

        {!grup.aktif && (
          <p className="psn-catatan psn-catatan-waspada">
            Kamu sudah bukan anggota grup ini. Pesan lama tetap bisa dibaca, tapi kamu tidak
            bisa mengirim dan tidak menerima pesan baru.
          </p>
        )}

        <button className="psn-info-baris" onClick={onSenyap}>
          {senyap ? <IconBellOff size={16} /> : <IconBell size={16} />}
          <span>{senyap ? 'Notifikasi dimatikan — klik untuk menyalakan' : 'Matikan notifikasi grup ini'}</span>
        </button>

        <div className="psn-info-judul">
          <span>{anggota.length} anggota</span>
          {admin && !menambah && (
            <button className="psn-tautan" onClick={() => setMenambah(true)}>
              <IconPlus size={13} /> Tambah
            </button>
          )}
        </div>

        {menambah && (
          <div className="psn-tambah">
            <PilihAnggota
              rekan={rekan}
              kecuali={[saya, ...anggota.map((a) => a.username)]}
              terpilih={calon}
              onUbah={setCalon}
            />
            <div className="psn-kaki">
              <button
                className="psn-tombol-biasa"
                onClick={() => {
                  setMenambah(false)
                  setCalon([])
                }}
              >
                Batal
              </button>
              <button
                className="psn-tombol-utama"
                disabled={calon.length === 0 || sibuk}
                onClick={() =>
                  void jalankan(async () => {
                    await window.aira.chatGrupTambah(grupId, calon)
                    setMenambah(false)
                    setCalon([])
                  })
                }
              >
                Tambahkan {calon.length > 0 ? `(${calon.length})` : ''}
              </button>
            </div>
          </div>
        )}

        <ul className="psn-anggota">
          {anggota.map((a) => {
            const diriSendiri = a.username.toLowerCase() === aku
            return (
              <li key={a.username} className="psn-anggota-baris">
                <Avatar nama={a.username} online={a.online} ukuran={34} />
                <span className="psn-anggota-nama">
                  <strong>{diriSendiri ? 'Kamu' : a.username}</strong>
                  <span>{a.online ? 'online' : (a.role ?? '')}</span>
                </span>
                {a.peran === 'admin' && <span className="psn-lencana-admin">Admin</span>}
                {/* Aksi admin terhadap anggota LAIN. Mencabut admin terakhir
                    ditolak main process dengan pesan yang jelas. */}
                {admin && !diriSendiri && (
                  <span className="psn-anggota-aksi">
                    <button
                      className="psn-tautan"
                      disabled={sibuk}
                      onClick={() =>
                        void jalankan(() =>
                          window.aira.chatGrupAturAdmin(grupId, a.username, a.peran !== 'admin')
                        )
                      }
                    >
                      {a.peran === 'admin' ? 'Cabut admin' : 'Jadikan admin'}
                    </button>
                    <button
                      className="psn-tautan bahaya"
                      disabled={sibuk}
                      onClick={() => setKonfirmasi({ jenis: 'keluarkan', username: a.username })}
                    >
                      Keluarkan
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ul>

        {galat && <p className="psn-galat">{galat}</p>}

        {grup.aktif && (
          <button className="psn-info-baris bahaya" onClick={() => setKonfirmasi({ jenis: 'keluar' })}>
            <IconLogout size={16} />
            <span>Keluar dari grup</span>
          </button>
        )}
      </div>

      {konfirmasi?.jenis === 'keluar' && (
        <ConfirmDialog
          title={`Keluar dari "${grup.nama}"?`}
          body={
            'Kamu tidak akan menerima pesan baru dari grup ini. Pesan lama tetap bisa dibaca.' +
            (admin && anggota.filter((a) => a.peran === 'admin').length === 1
              ? ' Karena kamu admin terakhir, anggota paling lama akan otomatis jadi admin.'
              : '')
          }
          confirmLabel="Keluar"
          onCancel={() => setKonfirmasi(null)}
          onConfirm={() => {
            setKonfirmasi(null)
            void jalankan(async () => {
              await window.aira.chatGrupKeluar(grupId)
              onKeluar()
            })
          }}
        />
      )}
      {konfirmasi?.jenis === 'keluarkan' && (
        <ConfirmDialog
          title={`Keluarkan ${konfirmasi.username}?`}
          body={`${konfirmasi.username} tidak akan menerima pesan baru dari "${grup.nama}". Semua anggota akan melihat bahwa kamu mengeluarkannya.`}
          confirmLabel="Keluarkan"
          onCancel={() => setKonfirmasi(null)}
          onConfirm={() => {
            const u = konfirmasi.username
            setKonfirmasi(null)
            void jalankan(() => window.aira.chatGrupKeluarkan(grupId, u))
          }}
        />
      )}
    </aside>
  )
}
