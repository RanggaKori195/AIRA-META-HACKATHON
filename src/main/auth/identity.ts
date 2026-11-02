import { hostname, networkInterfaces, userInfo } from 'os'

// Dari komputer mana sebuah login datang.
//
// Kolom "location" TIDAK diisi geo-IP. AIRA hanya hidup di jaringan internal the company,
// jadi setiap alamat yang terlihat adalah alamat privat (10.x/172.16–31.x/192.168.x)
// dan layanan geo-IP mana pun akan menjawab "unknown" — sementara gateway LLM-nya
// sendiri di-whitelist ke jaringan internal, jadi panggilan keluar memang tidak ada.
// Yang benar-benar berguna untuk audit internal justru identitas mesinnya: akun
// dipakai dari laptop siapa.

export interface Identitas {
  /** IPv4 LAN pertama yang bukan loopback. `null` bila tidak ada NIC aktif. */
  ip: string | null
  /** Nama komputer. */
  hostname: string
  /** Username Windows yang menjalankan aplikasi. */
  osUser: string
}

/**
 * IPv4 non-internal pertama.
 *
 * Adapter virtual (VirtualBox, WSL, VPN) sering ikut terdaftar dan bisa muncul
 * lebih dulu, jadi alamat 10.x — rentang yang dipakai jaringan the company — didahulukan
 * bila ada. Tanpa itu, log bisa berisi 192.168.56.1 milik adapter virtual untuk
 * semua orang, yang tidak membedakan siapa pun.
 */
export function alamatLan(): string | null {
  const kandidat: string[] = []
  for (const daftar of Object.values(networkInterfaces())) {
    for (const nic of daftar ?? []) {
      if (nic.family !== 'IPv4' || nic.internal) continue
      kandidat.push(nic.address)
    }
  }
  return kandidat.find((ip) => ip.startsWith('10.')) ?? kandidat[0] ?? null
}

export function identitasMesin(): Identitas {
  let osUser = 'unknown'
  try {
    osUser = userInfo().username
  } catch {
    /* userInfo() bisa gagal bila akun tidak punya home directory */
  }
  return { ip: alamatLan(), hostname: hostname(), osUser }
}

/** Satu baris ringkas untuk ditampilkan di panel Super Admin. */
export function ringkasIdentitas(i: {
  ip: string | null
  hostname: string | null
  osUser: string | null
}): string {
  const bagian = [i.hostname, i.osUser ? `(${i.osUser})` : null, i.ip].filter(Boolean)
  return bagian.length > 0 ? bagian.join(' ') : '—'
}
