import { useCallback, useEffect, useState, type JSX } from 'react'
import type { AksiPemantau, AuthSession, SetelanChat } from '@shared/ipc'
import { IconBack, IconBell } from '../components/Icons'
import UserAdmin from '../components/UserAdmin'
import FeedbackAdmin from '../components/FeedbackAdmin'
import MonitoringAdmin from '../components/MonitoringAdmin'
import { PanelPembaruan } from '../components/Pembaruan'
import MemoriPanel from '../components/MemoriPanel'
import PemantauPanel from '../components/PemantauPanel'
import AksesMenu from './AksesMenu'

interface Props {
  onBack: () => void
  sesi: AuthSession | null
  /** Dibuka dari klik notifikasi pemantau: gulir ke kartu Pemantau. */
  fokusPemantau?: boolean
  /** Klik riwayat pemantau — aksi yang sama dengan klik notifikasinya (ditangani App). */
  onAksiPemantau: (aksi: AksiPemantau) => void
}

/**
 * Settings sengaja dibuat minimal: seluruh kredensial (LLM, pencarian web, MCP)
 * sudah dibawa aplikasi dari build, jadi user tidak perlu mengatur apa pun.
 * Satu-satunya bagian yang tumbuh adalah pengelolaan user — dan itu hanya untuk
 * Super Admin.
 */
export default function Settings({ onBack, sesi, fokusPemantau, onAksiPemantau }: Props): JSX.Element {
  const [notifStatus, setNotifStatus] = useState<string | null>(null)
  const [chat, setChat] = useState<SetelanChat | null>(null)
  const superAdmin = sesi?.role === 'super_admin'
  /** Halaman di dalam Settings: utama, atau Akses Menu per Role & Divisi (Super Admin). */
  const [halaman, setHalaman] = useState<'utama' | 'akses'>('utama')

  useEffect(() => {
    void window.aira
      .chatSetelan()
      .then(setChat)
      .catch(() => setChat(null))
  }, [])

  const ubahChat = useCallback(
    async (input: { pratinjau?: boolean; autoStart?: boolean }) => {
      try {
        setChat(await window.aira.chatSetelanSetel(input))
      } catch {
        /* gagal menyimpan preferensi tidak boleh mengunci layar Settings */
      }
    },
    []
  )

  if (halaman === 'akses' && superAdmin) {
    return (
      <div className="settings settings-lebar">
        <AksesMenu onKembali={() => setHalaman('utama')} onBeranda={onBack} />
      </div>
    )
  }

  return (
    <div className="settings">
      <div className="settings-inner">
        <div className="settings-head">
          <button className="btn-mini" onClick={onBack} title="Kembali">
            <IconBack size={15} />
          </button>
          <h2>Settings</h2>
        </div>

        {superAdmin && sesi && <UserAdmin sesi={sesi} onBukaAkses={() => setHalaman('akses')} />}
        {superAdmin && <MonitoringAdmin />}
        {superAdmin && <FeedbackAdmin />}
        <MemoriPanel />
        <PanelPembaruan />

        <section className="card">
          <h3>Notifikasi</h3>
          <p className="hint">
            AIRA memberi tahu saat task selesai, saat butuh izin, atau saat gagal. Notifikasi muncul
            ketika jendela AIRA tidak sedang kamu lihat (task panjang tetap diberitahukan).
          </p>
          {notifStatus && <p className="hint">{notifStatus}</p>}
          <button
            className="btn-send"
            onClick={() => {
              setNotifStatus('Mengirim… lihat pojok kanan bawah layar.')
              void window.aira.testNotification().then((shown) => {
                setNotifStatus(
                  shown
                    ? '✅ Notifikasi dikirim. Kalau tidak terlihat, cek Windows → Settings → Notifications dan pastikan notifikasi aplikasi diizinkan.'
                    : '⚠️ Sistem menolak menampilkan notifikasi. Ikon AIRA di taskbar akan berkedip sebagai gantinya.'
                )
              })
            }}
          >
            <IconBell size={15} /> Tes Notifikasi
          </button>
        </section>

        {/* Hanya tampil bila user punya menu Sales atau TAT — disaring di main process. */}
        <PemantauPanel onAksi={onAksiPemantau} fokus={fokusPemantau} />

        <section className="card">
          <h3>Chat rekan</h3>
          {chat === null ? (
            <p className="hint">Setelan chat tidak terbaca.</p>
          ) : (
            <>
              <label className="setel-baris">
                <input
                  type="checkbox"
                  checked={chat.autoStart}
                  onChange={(e) => void ubahChat({ autoStart: e.target.checked })}
                />
                <span>
                  <strong>Nyalakan AIRA otomatis saat Windows login</strong>
                  <span className="hint">
                    AIRA berjalan diam di tray, tidak membuka jendela. Tanpa ini, pesan dari rekan
                    tidak akan sampai selama AIRA tidak dibuka — dan pengirimnya tidak tahu.
                  </span>
                </span>
              </label>

              <label className="setel-baris">
                <input
                  type="checkbox"
                  checked={chat.pratinjau}
                  onChange={(e) => void ubahChat({ pratinjau: e.target.checked })}
                />
                <span>
                  <strong>Tampilkan cuplikan isi pesan di notifikasi</strong>
                  <span className="hint">
                    Matikan bila laptop sering di-share screen atau dicolok proyektor: cuplikan chat
                    ikut muncul di layar besar dan tidak bisa ditarik kembali.
                  </span>
                </span>
              </label>

              <p className="hint">
                Menutup jendela AIRA tidak mematikan aplikasinya — ia pindah ke tray supaya pesan
                tetap masuk. Untuk benar-benar keluar, klik kanan ikon AIRA di tray lalu pilih
                Keluar.
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
