import type { JSX } from 'react'

// Ikon garis (stroke) berukuran seragam. Memakai currentColor agar mengikuti
// warna teks induknya, sehingga cocok di tema terang maupun gelap.

interface IconProps {
  size?: number
  className?: string
}

function Svg({
  size = 16,
  className,
  children,
  strokeWidth = 1.8
}: IconProps & { children: JSX.Element | JSX.Element[]; strokeWidth?: number }): JSX.Element {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

export const IconPlus = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
)

export const IconSend = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M4.5 12h15M13 5.5 19.5 12 13 18.5" />
  </Svg>
)

export const IconAttach = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M21 11.5 12.5 20a5 5 0 0 1-7-7l8.5-8.5a3.5 3.5 0 0 1 5 5L10.5 18a2 2 0 0 1-3-3l8-8" />
  </Svg>
)

export const IconSettings = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-2.9 1.2V21a2 2 0 1 1-4 0v-.1A1.7 1.7 0 0 0 7 19.4a1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0-1.2-2.9H1a2 2 0 1 1 0-4h.1A1.7 1.7 0 0 0 2.6 7a1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 2.9-1.2V1a2 2 0 1 1 4 0v.1A1.7 1.7 0 0 0 17 2.6a1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0 1.2 2.9H23a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1.7z" />
  </Svg>
)

export const IconLogout = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </Svg>
)

export const IconTrash = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M4 7h16M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M6 7l1 13a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-13" />
  </Svg>
)

export const IconClose = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </Svg>
)

export const IconBack = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M19 12H5M11 5.5 4.5 12 11 18.5" />
  </Svg>
)

export const IconStop = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="7" y="7" width="10" height="10" rx="1.5" />
  </Svg>
)

export const IconFolder = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </Svg>
)

export const IconChart = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </Svg>
)

export const IconDatabase = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <ellipse cx="12" cy="5" rx="8" ry="3" />
    <path d="M4 5v6c0 1.66 3.58 3 8 3s8-1.34 8-3V5" />
    <path d="M4 11v6c0 1.66 3.58 3 8 3s8-1.34 8-3v-6" />
  </Svg>
)

export const IconFile = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
    <path d="M14 3v5h5" />
  </Svg>
)

export const IconCopy = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="9" y="9" width="12" height="12" rx="2" />
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
  </Svg>
)

export const IconCheck = (p: IconProps): JSX.Element => (
  <Svg {...p} strokeWidth={2.4}>
    <path d="M20 6 9 17l-5-5" />
  </Svg>
)

export const IconAlert = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M12 3.5 22 20H2z" />
    <path d="M12 10v4M12 17h.01" />
  </Svg>
)

export const IconBan = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M5.6 5.6l12.8 12.8" />
  </Svg>
)

export const IconHand = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M9 11V5.5a1.5 1.5 0 1 1 3 0V11m0 0V4.5a1.5 1.5 0 1 1 3 0V11m0 0V6.5a1.5 1.5 0 1 1 3 0V14a6 6 0 0 1-6 6h-1a6 6 0 0 1-5.2-3L6 14.5a1.6 1.6 0 0 1 2.7-1.7L9 13.5V11z" />
  </Svg>
)

export const IconSpinner = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M12 3a9 9 0 1 0 9 9" />
  </Svg>
)

export const IconLock = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="4.5" y="10" width="15" height="10" rx="2" />
    <path d="M8 10V7a4 4 0 0 1 8 0v3" />
  </Svg>
)

export const IconBell = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M18 9a6 6 0 1 0-12 0c0 5-2 6-2 6h16s-2-1-2-6" />
    <path d="M10.5 20a2 2 0 0 0 3 0" />
  </Svg>
)

export const IconSearch = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="M16 16l4.5 4.5" />
  </Svg>
)

export const IconChat = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z" />
  </Svg>
)

/** Lapor / tandai. Dipakai tombol "Laporkan jawaban ini" di gelembung AIRA. */
export const IconFlag = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M5 21V4M5 4h11l-2 3.5L16 11H5" />
  </Svg>
)

/** Masukan / kotak saran. Dipakai menu sidebar "Masukan & Usulan". */
export const IconInbox = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M4 13h4l1.5 2.5h5L16 13h4" />
    <path d="M5.5 5h13l1.5 8v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-4z" />
  </Svg>
)

/** Dua orang — grup chat. */
export const IconUsers = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3 19c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5" />
    <path d="M16 5.2a3.2 3.2 0 0 1 0 5.6" />
    <path d="M17.5 13.8c2 .6 3.5 2.4 3.5 5.2" />
  </Svg>
)

/** Huruf i dalam lingkaran — info grup. */
export const IconInfo = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5.5" />
    <path d="M12 7.6v.01" />
  </Svg>
)

/** Pensil — ubah nama grup. */
export const IconPencil = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M4 20h4L19 9l-4-4L4 16z" />
    <path d="M13.5 6.5l4 4" />
  </Svg>
)

/** Lonceng dicoret — percakapan yang disenyapkan. */
export const IconBellOff = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M9 19a3 3 0 0 0 6 0" />
    <path d="M6.5 8.6A5.5 5.5 0 0 1 17.5 9c0 5 2 6 2 6H8" />
    <path d="M5.5 15S6 14 6 12" />
    <path d="M4 4l16 16" />
  </Svg>
)

/** Buku terbuka — menu Panduan. Sengaja bukan tanda tanya: ini bacaan, bukan dialog bantuan. */
export const IconBook = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M12 6.5C10.5 5.2 8.6 4.5 6 4.5H3.5v13H6c2.6 0 4.5.7 6 2 1.5-1.3 3.4-2 6-2h2.5v-13H18c-2.6 0-4.5.7-6 2z" />
    <path d="M12 6.5v12" />
  </Svg>
)

/** Mikrofon — tombol dikte suara di kotak chat. */
export const IconMic = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0" />
    <path d="M12 18v3" />
  </Svg>
)

/** Gambar — menu pembuat gambar (old-image-model). */
export const IconImage = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <circle cx="9" cy="10" r="1.8" />
    <path d="M20.5 15.5l-4.8-4.8L6 19.5" />
  </Svg>
)

/** Pustaka — semua berkas yang pernah dibuat AIRA. */
export const IconLibrary = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M4.5 4.5h3v15h-3z" />
    <path d="M9.5 4.5h3v15h-3z" />
    <path d="M14.2 5.6l2.9-.8 3.9 14.5-2.9.8z" />
  </Svg>
)

/** Jadwal — tugas yang dijalankan AIRA secara terjadwal. */
export const IconCalendar = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="3.5" y="5" width="17" height="15" rx="2.5" />
    <path d="M3.5 9.5h17" />
    <path d="M8 3v4" />
    <path d="M16 3v4" />
    <path d="M12 12.5v3l2 1.2" />
  </Svg>
)

/** Unduh / simpan. */
export const IconDownload = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M12 4v11" />
    <path d="M7.5 10.5L12 15l4.5-4.5" />
    <path d="M4.5 19.5h15" />
  </Svg>
)

// --- Beranda baru (29 Sep 2026) -------------------------------------------------

export const IconHome = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20h5v-6h4v6h5V9.5" />
  </Svg>
)

export const IconSparkle = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M11 3.5c.5 3.6 2.4 5.5 6 6-3.6.5-5.5 2.4-6 6-.5-3.6-2.4-5.5-6-6 3.6-.5 5.5-2.4 6-6z" />
    <path d="M18.5 14.5c.2 1.6 1 2.4 2.5 2.5-1.5.2-2.3 1-2.5 2.5-.2-1.5-1-2.3-2.5-2.5 1.5-.1 2.3-.9 2.5-2.5z" />
  </Svg>
)

export const IconZap = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M13 2 4 14h7l-1 8 9-12h-7z" />
  </Svg>
)

export const IconStar = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1 6.2L12 17.3 6.5 20.2l1-6.2L3 9.6l6.2-.9z" />
  </Svg>
)

export const IconBulb = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M9 18h6M10 21h4" />
    <path d="M12 3a6 6 0 0 0-3.6 10.8c.6.5 1 1.2 1.1 2.2h5c.1-1 .5-1.7 1.1-2.2A6 6 0 0 0 12 3z" />
  </Svg>
)

export const IconMore = (p: IconProps): JSX.Element => (
  <Svg {...p} strokeWidth={2.6}>
    <path d="M5 12h.01M12 12h.01M19 12h.01" />
  </Svg>
)

export const IconArrowRight = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </Svg>
)

export const IconFileText = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M14 3H6.5A1.5 1.5 0 0 0 5 4.5v15A1.5 1.5 0 0 0 6.5 21h11a1.5 1.5 0 0 0 1.5-1.5V8z" />
    <path d="M14 3v5h5M8.5 13h7M8.5 16.5h7M8.5 9.5h2" />
  </Svg>
)

export const IconPresentation = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M3 4h18M4 4v11h16V4M12 15v4M8 21l4-2 4 2" />
    <path d="M9 11V9M12 11V7M15 11v-1" />
  </Svg>
)

export const IconTable = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="3.5" y="4" width="17" height="16" rx="1.5" />
    <path d="M3.5 9.5h17M3.5 15h17M9.5 4v16M15 4v16" />
  </Svg>
)

export const IconCode = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" />
  </Svg>
)

export const IconNote = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="4.5" y="3.5" width="15" height="17" rx="1.5" />
    <path d="M8 8h8M8 12h8M8 16h5" />
  </Svg>
)

export const IconTrend = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M4 20h16" />
    <path d="M6 16v-3M10 16V9M14 16v-5M18 16V6" />
  </Svg>
)

export const IconHelp = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M9.5 9.3a2.6 2.6 0 0 1 5 .9c0 1.7-2.5 2.2-2.5 3.8M12 17.2h.01" />
  </Svg>
)

export const IconUpload = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 16V8M8.5 11.5 12 8l3.5 3.5" />
  </Svg>
)

export const IconLayers = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="m12 3 9 5-9 5-9-5z" />
    <path d="m3 13 9 5 9-5" />
  </Svg>
)

// --- Layar Gambar baru (29 Sep 2026) -------------------------------------------

export const IconFlask = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M9 3h6M10 3v6L4.8 18.2A1.8 1.8 0 0 0 6.4 21h11.2a1.8 1.8 0 0 0 1.6-2.8L14 9V3" />
    <path d="M7.5 15h9" />
  </Svg>
)

export const IconSmile = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="9" />
    <path d="M8.5 14.5c.9 1.2 2.1 1.8 3.5 1.8s2.6-.6 3.5-1.8M9 9.5h.01M15 9.5h.01" />
  </Svg>
)

export const IconGrid = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="4" y="4" width="6.5" height="6.5" rx="1.2" />
    <rect x="13.5" y="4" width="6.5" height="6.5" rx="1.2" />
    <rect x="4" y="13.5" width="6.5" height="6.5" rx="1.2" />
    <rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.2" />
  </Svg>
)

export const IconUser = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="8" r="3.5" />
    <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
  </Svg>
)

export const IconPalette = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M12 3a9 9 0 0 0 0 18c1.2 0 1.8-.8 1.8-1.7 0-1.3-1.2-1.6-1.2-2.8 0-.9.7-1.5 1.6-1.5H16a5 5 0 0 0 5-5c0-3.9-4-7-9-7z" />
    <path d="M7.5 11h.01M10 7.5h.01M14.5 7.5h.01" />
  </Svg>
)

export const IconTag = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M3.5 12.3V4.5a1 1 0 0 1 1-1h7.8l8.2 8.2a1.4 1.4 0 0 1 0 2l-6.8 6.8a1.4 1.4 0 0 1-2 0z" />
    <path d="M8 8h.01" />
  </Svg>
)

export const IconCrop = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="4" y="5" width="16" height="14" rx="2" />
    <path d="M8 12h.01M4 15l4-4 4 4 3-3 5 5" />
  </Svg>
)

export const IconSort = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M7 4v16M3.5 7.5 7 4l3.5 3.5M17 20V4M13.5 16.5 17 20l3.5-3.5" />
  </Svg>
)

export const IconClock = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </Svg>
)

export const IconHistory = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M3.5 12a8.5 8.5 0 1 0 2.5-6L3.5 8.5" />
    <path d="M3.5 4v4.5H8M12 8v4l3 2" />
  </Svg>
)

/** Kilau empat sudut, TERISI — hiasan hero. */
export const IconSparkleSolid = ({ size = 16, className }: IconProps): JSX.Element => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path fill="currentColor" d="M12 1.5c.7 5.4 3.1 7.8 8.5 8.5v.5c-5.4.7-7.8 3.1-8.5 8.5h-.5c-.7-5.4-3.1-7.8-8.5-8.5V10c5.4-.7 7.8-3.1 8.5-8.5z" transform="translate(0 2)" />
  </svg>
)

// --- Layar Jadwal baru (29 Sep 2026) -------------------------------------------

export const IconList = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01" />
  </Svg>
)

export const IconTimeline = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <rect x="3.5" y="4" width="17" height="16" rx="2" />
    <path d="M7 9h6M9 13h8M7 17h5" />
  </Svg>
)

export const IconBuilding = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16" />
    <path d="M15 9h4a1 1 0 0 1 1 1v11" />
    <path d="M3 21h18" />
    <path d="M8 8h3M8 12h3M8 16h3M18 13h0M18 17h0" />
  </Svg>
)

export const IconReset = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M3 12a9 9 0 1 0 3-6.7" />
    <path d="M3 4v5h5" />
  </Svg>
)

export const IconSave = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="M5 3h11l4 4v13a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
    <path d="M8 3v5h7V3M8 21v-7h8v7" />
  </Svg>
)

export const IconChevronDown = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="m6 9 6 6 6-6" />
  </Svg>
)

export const IconChevronLeft = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="m15 18-6-6 6-6" />
  </Svg>
)

export const IconChevronRight = (p: IconProps): JSX.Element => (
  <Svg {...p}>
    <path d="m9 18 6-6-6-6" />
  </Svg>
)
