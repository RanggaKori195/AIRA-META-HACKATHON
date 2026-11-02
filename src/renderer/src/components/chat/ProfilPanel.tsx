import { useEffect, useState, type JSX } from 'react'
import type { AnggotaGrup, GrupRingkas, PesanChatIpc } from '@shared/ipc'
import { IconAttach, IconChat, IconClock, IconUsers } from '../Icons'
import { Avatar } from './Avatar'
import { jabatanRekan, jamPesan, labelRole, labelTanggal, statusOrang, type ItemPercakapan } from './bantu'
import {
  BELUM_ADA_PANGGILAN,
  EVENT_FOKUS_TULIS,
  IconTambahOrang,
  IconTelepon,
  IconVideo
} from './RuangPercakapan'

/** Event untuk membuka Info grup (kelola anggota) di ruang percakapan. */
export const EVENT_INFO_GRUP = 'psn-info-grup'

/**
 * Kolom kanan panel Pesan: profil orang / ringkasan grup + berkas di percakapan.
 *
 * ⚠️ Mockup memuat email, lokasi, jam lokal, dan "Tentang" — data itu TIDAK ada di
 * tabel user mana pun, jadi tidak ditampilkan (tidak dikarang). Yang tampil hanya
 * yang benar ada: role, divisi, status online, grup bersama, dan berkas.
 * Tab "Tugas" di mockup juga tidak dipasang — belum ada fitur tugas antar rekan.
 */
export function ProfilPanel({
  item,
  grup,
  pesan,
  onTambahOrang
}: {
  item: ItemPercakapan
  grup: readonly GrupRingkas[]
  pesan: readonly PesanChatIpc[]
  onTambahOrang: () => void
}): JSX.Element {
  const [tab, setTab] = useState<'info' | 'file'>('info')
  const [anggota, setAnggota] = useState<AnggotaGrup[] | null>(null)
  const [bersama, setBersama] = useState<GrupRingkas[] | null>(null)

  const kunci = item.kunci
  useEffect(() => {
    setTab('info')
    setAnggota(null)
    setBersama(null)
    let batal = false
    void (async () => {
      try {
        if (item.jenis === 'grup') {
          const info = await window.aira.chatGrupInfo(item.grup.id)
          if (!batal) setAnggota(info.anggota)
          return
        }
        // Grup bersama: satu per satu, BERURUTAN — pool login `max: 1` dan diserialkan
        // (aturan koneksi). Hanya grup yang masih saya ikuti.
        const hasil: GrupRingkas[] = []
        const target = item.rekan.username.toLowerCase()
        for (const g of grup.filter((x) => x.aktif)) {
          const info = await window.aira.chatGrupInfo(g.id)
          if (info.anggota.some((a) => a.username.toLowerCase() === target)) hasil.push(g)
          if (batal) return
        }
        setBersama(hasil)
      } catch {
        if (!batal) {
          setAnggota([])
          setBersama([])
        }
      }
    })()
    return () => {
      batal = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kunci])

  const berkas = pesan.filter((p) => p.lampiranNama && !p.dihapusAt).reverse()
  const diGrup = item.jenis === 'grup'
  const nama = diGrup ? item.grup.nama : item.rekan.username
  const online = item.jenis === 'orang' && item.rekan.online

  return (
    <aside className="psn-profil">
      <div className="psn-profil-tab">
        <button className={tab === 'info' ? 'aktif' : ''} onClick={() => setTab('info')}>
          Info
        </button>
        <button className={tab === 'file' ? 'aktif' : ''} onClick={() => setTab('file')}>
          File{berkas.length > 0 ? ` (${berkas.length})` : ''}
        </button>
      </div>

      {tab === 'info' ? (
        <div className="psn-profil-isi">
          <div className="psn-profil-kepala">
            <Avatar nama={nama} grup={diGrup} online={online} ukuran={76} />
            <strong>{nama}</strong>
            {item.jenis === 'orang' ? (
              <>
                {jabatanRekan(item.rekan) && <span>{jabatanRekan(item.rekan)}</span>}
                <span className="psn-profil-org">AIRA · AI Lab Assistant</span>
                <span className={`psn-profil-status${online ? ' online' : ''}`}>
                  <i /> {online ? 'Online' : 'Offline'}
                </span>
              </>
            ) : (
              <span>{item.grup.aktif ? `${item.grup.jumlahAnggota} members` : 'You are no longer a member'}</span>
            )}
          </div>

          <div className="psn-profil-aksi">
            <button onClick={() => window.dispatchEvent(new Event(EVENT_FOKUS_TULIS))}>
              <span>
                <IconChat size={17} />
              </span>
              Chat
            </button>
            <button disabled title={BELUM_ADA_PANGGILAN}>
              <span>
                <IconTelepon />
              </span>
              Call
            </button>
            <button disabled title={BELUM_ADA_PANGGILAN}>
              <span>
                <IconVideo />
              </span>
              Video
            </button>
            <button
              onClick={() => (diGrup ? window.dispatchEvent(new Event(EVENT_INFO_GRUP)) : onTambahOrang())}
              disabled={diGrup && !item.grup.aktif}
              title={diGrup ? 'Add members' : `Create a group with ${nama}`}
            >
              <span>
                <IconTambahOrang />
              </span>
              Add
            </button>
          </div>

          {item.jenis === 'orang' ? (
            <>
              <h5>About</h5>
              <ul className="psn-profil-fakta">
                <li>
                  <IconUsers size={15} /> {labelRole(item.rekan.role) || '—'}
                  {item.rekan.divisi ? ` · ${item.rekan.divisi}` : ''}
                </li>
                <li>
                  <IconClock size={15} /> {online ? 'Online now' : statusOrang(item.rekan)}
                </li>
              </ul>

              <h5>Shared groups{bersama ? ` (${bersama.length})` : ''}</h5>
              {bersama === null ? (
                <p className="psn-profil-kosong">Loading…</p>
              ) : bersama.length === 0 ? (
                <p className="psn-profil-kosong">No shared groups yet.</p>
              ) : (
                <ul className="psn-profil-grup">
                  {bersama.map((g) => (
                    <li key={g.id}>
                      <Avatar nama={g.nama} grup ukuran={36} />
                      <span>
                        <strong>{g.nama}</strong>
                        <small>{g.jumlahAnggota} members</small>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <>
              <h5>Members{anggota ? ` (${anggota.length})` : ''}</h5>
              {anggota === null ? (
                <p className="psn-profil-kosong">Loading…</p>
              ) : (
                <ul className="psn-profil-grup">
                  {anggota.map((a) => (
                    <li key={a.username}>
                      <Avatar nama={a.username} online={a.online} ukuran={36} />
                      <span>
                        <strong>{a.username}</strong>
                        <small>
                          {labelRole(a.role)}
                          {a.peran === 'admin' ? ' · group admin' : ''}
                        </small>
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="psn-profil-isi">
          {berkas.length === 0 ? (
            <p className="psn-profil-kosong">No files in this conversation yet.</p>
          ) : (
            <ul className="psn-profil-berkas">
              {berkas.map((p) => (
                <li key={p.id}>
                  <button onClick={() => void window.aira.chatSimpanLampiran(p.id)} title="Save file">
                    <span className="psn-lampiran-ikon">
                      <IconAttach size={15} />
                    </span>
                    <span>
                      <strong>{p.lampiranNama}</strong>
                      <small>
                        {p.pengirim} · {labelTanggal(p.createdAt)} {jamPesan(p.createdAt)}
                      </small>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <p className="psn-profil-kosong">Only files from the messages currently loaded in this conversation.</p>
        </div>
      )}
    </aside>
  )
}
