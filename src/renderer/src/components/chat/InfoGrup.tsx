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
    { jenis: 'leave' } | { jenis: 'keluarkan'; username: string } | null
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
          <button className="psn-ikon" onClick={onTutup} title="Close">
            <IconClose size={16} />
          </button>
          <strong>Group info</strong>
        </div>
        <p className="psn-kosong">{galat ?? 'Loading…'}</p>
      </aside>
    )
  }

  const { grup, anggota } = info
  const admin = grup.aktif && grup.peranSaya === 'admin'
  const aku = saya.toLowerCase()

  return (
    <aside className="psn-info">
      <div className="psn-info-kepala">
        <button className="psn-ikon" onClick={onTutup} title="Close">
          <IconClose size={16} />
        </button>
        <strong>Group info</strong>
      </div>

      <div className="psn-info-isi">
        <div className="psn-info-sampul">
          <Avatar nama={grup.nama} grup ukuran={72} />
          {ubahNama === null ? (
            <h3>
              {grup.nama}
              {admin && (
                <button className="psn-ikon kecil" onClick={() => setUbahNama(grup.nama)} title="Rename group">
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
              <span className="psn-hitung">Enter to save · Esc to cancel</span>
            </div>
          )}
          <span className="psn-info-sub">Group · {anggota.length} members</span>
        </div>

        {!grup.aktif && (
          <p className="psn-catatan psn-catatan-waspada">
            You are no longer a member of this group. Old messages can still be read, but you
            cannot send and will not receive new messages.
          </p>
        )}

        <button className="psn-info-baris" onClick={onSenyap}>
          {senyap ? <IconBellOff size={16} /> : <IconBell size={16} />}
          <span>{senyap ? 'Notifications off — click to turn on' : 'Mute notifications for this group'}</span>
        </button>

        <div className="psn-info-judul">
          <span>{anggota.length} members</span>
          {admin && !menambah && (
            <button className="psn-tautan" onClick={() => setMenambah(true)}>
              <IconPlus size={13} /> Add
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
                Cancel
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
                Add {calon.length > 0 ? `(${calon.length})` : ''}
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
                  <strong>{diriSendiri ? 'You' : a.username}</strong>
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
                      {a.peran === 'admin' ? 'Remove admin' : 'Make admin'}
                    </button>
                    <button
                      className="psn-tautan bahaya"
                      disabled={sibuk}
                      onClick={() => setKonfirmasi({ jenis: 'keluarkan', username: a.username })}
                    >
                      Remove
                    </button>
                  </span>
                )}
              </li>
            )
          })}
        </ul>

        {galat && <p className="psn-galat">{galat}</p>}

        {grup.aktif && (
          <button className="psn-info-baris bahaya" onClick={() => setKonfirmasi({ jenis: 'leave' })}>
            <IconLogout size={16} />
            <span>Leave group</span>
          </button>
        )}
      </div>

      {konfirmasi?.jenis === 'leave' && (
        <ConfirmDialog
          title={`Leave "${grup.nama}"?`}
          body={
            'You will not receive new messages from this group. Old messages can still be read.' +
            (admin && anggota.filter((a) => a.peran === 'admin').length === 1
              ? ' Because you are the last admin, the longest-standing member will automatically become admin.'
              : '')
          }
          confirmLabel="Leave"
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
          title={`Remove ${konfirmasi.username}?`}
          body={`${konfirmasi.username} will not receive new messages from "${grup.nama}". All members will see that you removed them.`}
          confirmLabel="Remove"
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
