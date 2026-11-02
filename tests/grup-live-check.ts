// Pemeriksaan GRUP CHAT ke database SUNGGUHAN.
// Jalankan manual: npx tsx tests/grup-live-check.ts
//
// ⚠️ Kenapa ini live-check, bukan unit test: seluruh aturan izin grup (anggota?
// admin? pesan ini dikirim sebelum atau sesudah ia bergabung?) hidup di klausa
// WHERE. Aturan di SQL hanya bisa dibuktikan ke SQL.
//
// ⚠️ Yang diuji adalah statement ASLI dari `src/main/chat/grup.ts` dan
// `service.ts` — disuntik lewat `pakaiKoneksiUji`, bukan disalin ke sini.
// Salinan menyimpang diam-diam, dan yang dipertaruhkan di sini adalah siapa boleh
// membaca percakapan siapa.
//
// Memakai user SEMENTARA (pola aturan 58), dan membersihkan semuanya di akhir —
// termasuk bila ada pemeriksaan yang gagal.
import { readFileSync } from 'fs'
import { Pool } from 'pg'
import { applySchema } from '../src/main/auth/schema'
import * as grup from '../src/main/chat/grup'
import * as layanan from '../src/main/chat/service'

function envVar(nama: string): string | null {
  const baris = readFileSync('.env', 'utf8')
    .split(/\r?\n/)
    .find((l) => l.startsWith(`${nama}=`))
  return baris ? baris.slice(nama.length + 1).trim() : null
}

const cs = envVar('AIRA_LOGIN_DB') ?? envVar('AIRA_SALES_DB')
if (!cs) {
  console.error('AIRA_LOGIN_DB / AIRA_SALES_DB tidak ada di .env')
  process.exit(1)
}

let gagal = 0
function cek(nama: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK   ' : 'GAGAL'} ${nama}${detail ? ' — ' + detail : ''}`)
  if (!ok) gagal++
}

async function ditolak(nama: string, kerja: () => Promise<unknown>, pola?: RegExp): Promise<void> {
  try {
    await kerja()
    cek(nama, false, 'TIDAK ditolak')
  } catch (e) {
    const pesan = e instanceof Error ? e.message : String(e)
    cek(nama, pola ? pola.test(pesan) : true, pesan)
  }
}

const pool = new Pool({ connectionString: cs, max: 1, connectionTimeoutMillis: 15_000 })
const q = async <T>(sql: string, p: unknown[] = []): Promise<T[]> =>
  (await pool.query(sql, p)).rows as T[]

// User sementara. Awalan khas supaya pembersihan tidak mungkin menyentuh user nyata.
const A = 'ujigrup_a'
const B = 'ujigrup_b'
const C = 'ujigrup_c'
const D = 'ujigrup_d'
const SEMUA = [A, B, C, D]

let grupId: string | null = null

async function bersihkan(): Promise<void> {
  // Urutan penting karena foreign key: pesan -> anggota -> grup -> user.
  await q(
    `DELETE FROM tb_chat_aira_pesan
      WHERE grup_id IN (SELECT grup_id FROM tb_chat_aira_grup_anggota WHERE lower(username) = ANY($1))
         OR lower(pengirim) = ANY($1)`,
    [SEMUA]
  )
  await q(
    `DELETE FROM tb_chat_aira_grup_anggota
      WHERE grup_id IN (SELECT grup_id FROM tb_chat_aira_grup_anggota WHERE lower(username) = ANY($1))`,
    [SEMUA]
  )
  await q('DELETE FROM tb_chat_aira_grup WHERE lower(dibuat_oleh) = ANY($1)', [SEMUA])
  await q('DELETE FROM tb_login_aira WHERE lower(username) = ANY($1)', [SEMUA])
}

async function main(): Promise<void> {
  // Skema yang SAMA dengan yang dipasang aplikasi saat start.
  await applySchema(
    (sql, params) => pool.query(sql, params as unknown[]),
    async (sql, params) => (await pool.query(sql, params as unknown[])).rows
  )
  grup.pakaiKoneksiUji(q)
  await bersihkan()

  // Password = teks bebas yang BUKAN hash: user ini tidak pernah bisa login.
  for (const u of SEMUA) {
    await q(`INSERT INTO tb_login_aira (username, password, role) VALUES ($1, 'tidak-bisa-login', 'staff')`, [u])
  }

  // --- membuat grup -------------------------------------------------------
  grupId = await grup.buatGrup(A, '  Tim   Uji  ', [B, C, 'user_tidak_ada', A])
  cek('grup terbentuk', /^\d+$/.test(grupId), `id ${grupId}`)

  const infoA = await grup.infoGrup(A, grupId)
  cek('nama dirapikan', infoA.grup.nama === 'Tim Uji', `"${infoA.grup.nama}"`)
  cek(
    'anggota = pembuat + calon yang BENAR-BENAR ada (user tak dikenal dibuang)',
    infoA.anggota.length === 3,
    infoA.anggota.map((a) => `${a.username}/${a.peran}`).join(', ')
  )
  cek('pembuat otomatis admin', infoA.anggota.find((a) => a.username === A)?.peran === 'admin')

  const awalB = await grup.pesanGrup(B, grupId)
  cek('anggota awal melihat pesan sistem "membuat grup"', awalB.some((p) => p.jenis === 'buat'))

  // --- orang luar ---------------------------------------------------------
  await ditolak('orang luar TIDAK bisa membaca grup', () => grup.pesanGrup(D, grupId!), /bukan anggota/)
  await ditolak('orang luar TIDAK bisa mengirim ke grup', () => grup.kirimGrup(D, grupId!, 'nyelonong'), /bukan anggota/)
  await ditolak('orang luar TIDAK bisa membuka info grup', () => grup.infoGrup(D, grupId!), /bukan anggota/)
  cek('grup tidak muncul di daftar orang luar', !(await grup.daftarGrup(D)).some((g) => g.id === grupId))

  // --- kirim & lampiran SEBELUM D bergabung --------------------------------
  const rahasia = await grup.kirimGrup(A, grupId, 'rahasia sebelum D bergabung', {
    nama: 'rahasia.txt',
    mime: 'text/plain',
    data: new TextEncoder().encode('isi rahasia')
  })
  cek('pesan grup terkirim', rahasia.grupId === grupId && rahasia.penerima === null)

  const lampC = await layanan.ambilLampiran(C, rahasia.id)
  cek('anggota bisa mengunduh lampiran grup', lampC?.nama === 'rahasia.txt')
  await ditolak('orang luar TIDAK bisa mengunduh lampiran grup dengan menebak id', () =>
    layanan.ambilLampiran(D, rahasia.id)
  )

  // --- hitungan belum dibaca ----------------------------------------------
  const daftarB = await grup.daftarGrup(B)
  cek('B punya 1 pesan belum dibaca', daftarB.find((g) => g.id === grupId)?.belumDibaca === 1)
  const daftarA = await grup.daftarGrup(A)
  cek(
    'pesan sendiri & pesan sistem TIDAK dihitung belum dibaca',
    daftarA.find((g) => g.id === grupId)?.belumDibaca === 0
  )
  cek('lencana B ikut menghitung grup', (await layanan.totalBelumDibaca(B)) >= 1)
  await grup.tandaiDibacaGrup(B, grupId)
  cek(
    'sesudah dibuka, belum dibaca B = 0',
    (await grup.daftarGrup(B)).find((g) => g.id === grupId)?.belumDibaca === 0
  )

  // --- hak admin ----------------------------------------------------------
  await ditolak('anggota biasa TIDAK bisa menambah anggota', () => grup.tambahAnggota(B, grupId!, [D]), /admin/)
  await ditolak('anggota biasa TIDAK bisa mengganti nama', () => grup.gantiNamaGrup(B, grupId!, 'Diambil alih'), /admin/)
  await ditolak('anggota biasa TIDAK bisa mengeluarkan orang', () => grup.keluarkanAnggota(B, grupId!, C), /admin/)

  // --- menambah D ---------------------------------------------------------
  const ditambah = await grup.tambahAnggota(A, grupId, [D, B])
  cek('hanya D yang ditambah (B sudah anggota)', ditambah.length === 1 && ditambah[0] === D, ditambah.join(','))

  const lihatD = await grup.pesanGrup(D, grupId)
  cek(
    'anggota baru TIDAK melihat pesan dari sebelum ia bergabung',
    !lihatD.some((p) => p.id === rahasia.id),
    `${lihatD.length} pesan terlihat`
  )
  cek('anggota baru melihat "X menambahkan kamu"', lihatD.some((p) => p.jenis === 'tambah' && p.target === D))
  await ditolak('anggota baru TIDAK bisa mengunduh lampiran dari sebelum ia bergabung', () =>
    layanan.ambilLampiran(D, rahasia.id)
  )

  const notifD = await grup.pesanGrupMasukBaru(D, null)
  cek(
    'orang yang ditambahkan MENDAPAT notifikasi',
    notifD.some((p) => p.jenis === 'tambah' && p.target === D),
    `${notifD.length} calon notifikasi`
  )
  const notifB = await grup.pesanGrupMasukBaru(B, null)
  cek(
    'anggota lain TIDAK dibunyikan untuk "A menambahkan D"',
    !notifB.some((p) => p.jenis === 'tambah')
  )

  // --- mengeluarkan C -----------------------------------------------------
  await grup.keluarkanAnggota(A, grupId, C)
  const sesudahKeluar = await grup.kirimGrup(A, grupId, 'pesan sesudah C dikeluarkan', {
    nama: 'baru.txt',
    mime: 'text/plain',
    data: new TextEncoder().encode('isi baru')
  })
  const lihatC = await grup.pesanGrup(C, grupId)
  cek('mantan anggota masih melihat "mengeluarkan kamu"', lihatC.some((p) => p.jenis === 'keluarkan' && p.target === C))
  cek('mantan anggota TIDAK melihat pesan sesudah ia keluar', !lihatC.some((p) => p.id === sesudahKeluar.id))
  cek('mantan anggota masih bisa membaca riwayat lamanya', lihatC.some((p) => p.id === rahasia.id))
  await ditolak('mantan anggota TIDAK bisa mengirim', () => grup.kirimGrup(C, grupId!, 'masih di sini?'), /bukan anggota/)
  await ditolak('mantan anggota TIDAK bisa mengunduh lampiran baru', () =>
    layanan.ambilLampiran(C, sesudahKeluar.id)
  )
  const grupC = (await grup.daftarGrup(C)).find((g) => g.id === grupId)
  cek('grup tetap di daftar mantan anggota, ditandai tidak aktif', grupC?.aktif === false)
  cek(
    'mantan anggota tidak dibunyikan pesan baru',
    !(await grup.pesanGrupMasukBaru(C, null)).some((p) => p.id === sesudahKeluar.id)
  )

  // --- menghapus ----------------------------------------------------------
  cek('anggota lain TIDAK bisa menghapus pesan A', (await layanan.hapusPesan(B, sesudahKeluar.id)) === false)
  cek('pengirim bisa menghapus pesannya di grup', (await layanan.hapusPesan(A, sesudahKeluar.id)) === true)
  const [sistemKeluarkan] = await q<{ id: string }>(
    `SELECT id::text FROM tb_chat_aira_pesan WHERE grup_id = $1 AND jenis = 'keluarkan'`,
    [grupId]
  )
  cek(
    'pelaku TIDAK bisa menghapus pesan sistem tentang tindakannya',
    (await layanan.hapusPesan(A, sistemKeluarkan.id)) === false
  )

  // --- admin --------------------------------------------------------------
  await ditolak('admin terakhir TIDAK bisa mencabut dirinya sendiri', () => grup.aturAdmin(A, grupId!, A, false), /admin terakhir/)
  await grup.aturAdmin(A, grupId, B, true)
  cek(
    'A bisa menjadikan B admin',
    (await grup.infoGrup(A, grupId)).anggota.find((a) => a.username === B)?.peran === 'admin'
  )
  await grup.gantiNamaGrup(B, grupId, 'Tim Uji Baru')
  const namaBaru = (await grup.infoGrup(D, grupId)).grup.nama
  cek('admin bisa mengganti nama, terlihat semua anggota', namaBaru === 'Tim Uji Baru')

  await grup.keluarGrup(A, grupId)
  cek(
    'admin yang keluar TIDAK memicu pengganti bila masih ada admin lain',
    (await grup.infoGrup(B, grupId)).anggota.filter((a) => a.peran === 'admin').map((a) => a.username).join() === B
  )

  // B = admin terakhir, anggota aktif tersisa: B & D.
  await grup.keluarGrup(B, grupId)
  const akhir = await grup.infoGrup(D, grupId)
  cek(
    'admin TERAKHIR keluar -> anggota tersisa otomatis jadi admin',
    akhir.anggota.length === 1 && akhir.anggota[0].username === D && akhir.anggota[0].peran === 'admin',
    akhir.anggota.map((a) => `${a.username}/${a.peran}`).join(', ')
  )
  const pesanD = await grup.pesanGrup(D, grupId)
  cek('penggantian admin tercatat sebagai pesan sistem', pesanD.some((p) => p.jenis === 'admin_otomatis' && p.target === D))
  await ditolak('keluar dua kali ditolak', () => grup.keluarGrup(B, grupId!), /bukan anggota/)

  // --- constraint database ------------------------------------------------
  await ditolak('database MENOLAK pesan bertujuan ganda (orang DAN grup)', () =>
    q(
      `INSERT INTO tb_chat_aira_pesan (pengirim, penerima, grup_id, isi) VALUES ($1, $2, $3, 'x')`,
      [A, B, grupId]
    )
  , /tujuan_chk/)
  await ditolak('database MENOLAK pesan tanpa tujuan', () =>
    q(`INSERT INTO tb_chat_aira_pesan (pengirim, isi) VALUES ($1, 'x')`, [A])
  , /tujuan_chk/)

  // Input tak sah ditolak sebelum menyentuh database.
  await ditolak('id grup bukan angka ditolak', () => grup.pesanGrup(A, '1 OR 1=1'), /tidak sah/)
  await ditolak('nama grup kosong ditolak', () => grup.buatGrup(A, '   ', [B]), /wajib/)
}

main()
  .catch((e) => {
    console.error('GAGAL:', e instanceof Error ? e.stack ?? e.message : e)
    gagal++
  })
  .finally(async () => {
    try {
      await bersihkan()
      const [sisa] = await q<{ n: string }>(
        'SELECT count(*) n FROM tb_login_aira WHERE lower(username) = ANY($1)',
        [SEMUA]
      )
      cek('user & grup uji dibersihkan', Number(sisa.n) === 0)
    } catch (e) {
      console.error('PEMBERSIHAN GAGAL:', e instanceof Error ? e.message : e)
      gagal++
    }
    await pool.end().catch(() => {})
    console.log(gagal ? `\n${gagal} PEMERIKSAAN GAGAL` : '\nSEMUA LOLOS')
    process.exit(gagal ? 1 : 0)
  })
