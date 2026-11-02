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
          <button className="btn-mini" onClick={onBack} title="Back">
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
          <h3>Notifications</h3>
          <p className="hint">
            AIRA notifies you when a task finishes, needs permission, or fails. Notifications appear
            when the AIRA window is not in view (long tasks are still announced).
          </p>
          {notifStatus && <p className="hint">{notifStatus}</p>}
          <button
            className="btn-send"
            onClick={() => {
              setNotifStatus('Sending… look at the bottom-right corner of the screen.')
              void window.aira.testNotification().then((shown) => {
                setNotifStatus(
                  shown
                    ? '✅ Notification sent. If you do not see it, check Windows → Settings → Notifications and make sure app notifications are allowed.'
                    : '⚠️ The system refused to show the notification. The AIRA taskbar icon will flash instead.'
                )
              })
            }}
          >
            <IconBell size={15} /> Test Notification
          </button>
        </section>

        {/* Hanya tampil bila user punya menu Sales atau TAT — disaring di main process. */}
        <PemantauPanel onAksi={onAksiPemantau} fokus={fokusPemantau} />

        <section className="card">
          <h3>Teammate chat</h3>
          {chat === null ? (
            <p className="hint">Chat settings could not be read.</p>
          ) : (
            <>
              <label className="setel-baris">
                <input
                  type="checkbox"
                  checked={chat.autoStart}
                  onChange={(e) => void ubahChat({ autoStart: e.target.checked })}
                />
                <span>
                  <strong>Start AIRA automatically when Windows signs in</strong>
                  <span className="hint">
                    AIRA runs quietly in the tray without opening a window. Without this, messages
                    from teammates will not arrive while AIRA is closed — and the sender will not know.
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
                  <strong>Show a message preview in notifications</strong>
                  <span className="hint">
                    Turn this off if your laptop is often screen-shared or plugged into a projector: the
                    chat preview would show on the big screen and cannot be taken back.
                  </span>
                </span>
              </label>

              <p className="hint">
                Closing the AIRA window does not quit the app — it moves to the tray so messages keep
                arriving. To really quit, right-click the AIRA tray icon and choose Quit.
              </p>
            </>
          )}
        </section>
      </div>
    </div>
  )
}
