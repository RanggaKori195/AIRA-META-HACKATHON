// Pemeriksaan ke database login sungguhan (bukan unit test — butuh jaringan
// internal the company). Jalankan manual: npx tsx tests/auth-live-check.ts
//
// Sekaligus PEMASANG skema: `applySchema` yang dipakai di sini adalah fungsi yang
// sama persis yang dijalankan aplikasi saat start (`auth/schema.ts`). Kalau DDL-nya
// disalin ke file ini, yang teruji bukan lagi skema yang benar-benar dipakai.
//
// Membuktikan yang tidak bisa dibuktikan unit test:
//   1. DDL-nya memang diterima PostgreSQL 14 di server itu
//   2. Menjalankannya dua kali tidak menggandakan user maupun mengembalikan password
//   3. Password tersimpan sebagai hash — bukan `12345` polos
//   4. Username tidak bisa terdaftar dua kali hanya karena beda besar-kecil huruf
//   5. Baris log benar-benar masuk beserta identitas mesinnya
import { Pool } from 'pg'
import { applySchema, PASSWORD_DUMMY } from '../src/main/auth/schema'
import { verifyPassword, sudahDihash } from '../src/main/auth/password'
import { identitasMesin } from '../src/main/auth/identity'
import { MENU_VALUES } from '../src/shared/ipc'
import { envDb } from './live-env'
import { HIDDEN_MENUS } from '../src/main/hackathon/flags'
import {
  menuDiizinkanLama,
  menuUntuk,
  type MatriksAksesMenu,
  type MatriksDivisiLama,
  type MatriksRoleLama
} from '../src/main/auth/roles'

const cs = envDb('AIRA_LOGIN_DB')
if (!cs) {
  console.error('AIRA_LOGIN_DB / AIRA_SALES_DB tidak ada di .env')
  process.exit(1)
}

let gagal = 0
function cek(nama: string, ok: boolean, detail = ''): void {
  console.log(`${ok ? 'OK   ' : 'GAGAL'} ${nama}${detail ? ' — ' + detail : ''}`)
  if (!ok) gagal++
}

async function main(): Promise<void> {
  const pool = new Pool({ connectionString: cs, max: 2, connectionTimeoutMillis: 15_000 })
  const q = async <T = any>(sql: string, p: unknown[] = []): Promise<T[]> =>
    (await pool.query(sql, p)).rows as T[]
  const exec = async (sql: string, params?: unknown[]): Promise<unknown> =>
    params === undefined ? pool.query(sql) : pool.query(sql, params)

  const rows = async (sql: string, params?: unknown[]): Promise<unknown[]> =>
    (await pool.query(sql, params)).rows

  const t0 = Date.now()
  await applySchema(exec, rows)
  const msPertama = Date.now() - t0
  cek('skema diterapkan', true, `${msPertama} ms`)

  // 1. Ketiga tabel ada
  const tabel = await q<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name LIKE 'tb_%aira%'
      ORDER BY table_name`
  )
  const nama = tabel.map((t) => t.table_name)
  for (const t of ['tb_login_aira', 'tb_login_aira_log', 'tb_menu_akses_aira']) {
    cek(`tabel ${t} ada`, nama.includes(t))
  }

  // 2. Empat user dummy, role sesuai
  const users = await q<{ username: string; role: string; password: string }>(
    'SELECT username, role, password FROM tb_login_aira ORDER BY username'
  )
  // ⚠️ Hanya DUA user seed sejak 9 Sep 2026. `manager`, `spv`, `staff` dibuang dari
  // `DUMMY` menjelang sebar `.exe`: semua user seed berpassword `12345`, dan selama
  // mereka ada di daftar itu, menghapusnya lewat panel TIDAK bertahan — start
  // berikutnya membuatnya lagi, di setiap laptop.
  cek('2 user seed ter-seed', users.length >= 2, `ada ${users.length}`)
  const harusnya: Record<string, string> = {
    superadmin: 'super_admin',
    direktur: 'direktur'
  }
  for (const [u, r] of Object.entries(harusnya)) {
    const row = users.find((x) => x.username === u)
    cek(`user ${u} role ${r}`, row?.role === r, row ? `role=${row.role}` : 'tidak ada')
  }

  // 3. Password tersimpan sebagai HASH, dan hash itu memang cocok dengan 12345.
  //    Dua-duanya diperiksa: "bukan plaintext" saja tidak membuktikan login jalan,
  //    "verify cocok" saja tidak membuktikan kolomnya bukan `12345` polos.
  //
  // ⚠️ "Cocok dengan 12345" hanya untuk akun SEED. User sungguhan yang dibuat Super
  // Admin punya password sendiri — versi sebelumnya menuntut 12345 untuk SETIAP
  // user, sehingga live-check merah permanen (9 gagal, 30 Sep 2026) karena keadaan
  // yang justru benar. Merah permanen menyembunyikan kegagalan sungguhan.
  for (const row of users) {
    cek(`password ${row.username} bukan plaintext`, row.password !== PASSWORD_DUMMY && sudahDihash(row.password))
    if (row.username in harusnya) {
      cek(`password ${row.username} cocok dengan "${PASSWORD_DUMMY}"`, await verifyPassword(PASSWORD_DUMMY, row.password))
    }
    cek(`password ${row.username} menolak yang salah`, !(await verifyPassword('salah-sekali', row.password)))
  }

  // 4. Idempoten — dijalankan lagi tidak menggandakan apa pun.
  const t1 = Date.now()
  await applySchema(exec, rows)
  const msKedua = Date.now() - t1
  const ulang = await q<{ n: string }>('SELECT count(*) AS n FROM tb_login_aira')
  cek('applySchema idempoten', Number(ulang[0].n) === users.length, `${ulang[0].n} baris`)

  // Jalan kedua harus MURAH. Versi pertama menjalankan hashPassword empat kali
  // tiap start (84 ms sekali jalan) lalu membuang hasilnya, plus 12 round-trip
  // yang tidak mengubah apa pun — beban itu ditanggung SETIAP kali aplikasi dibuka.
  cek('seed ulang tidak mengulang kerja berat', msKedua < 500, `${msKedua} ms (pertama ${msPertama} ms)`)

  // 5. Username tidak bisa dobel hanya karena beda huruf besar/kecil.
  let ditolak = false
  try {
    await q('INSERT INTO tb_login_aira (username, password, role) VALUES ($1, $2, $3)', [
      'DIREKTUR',
      'scrypt$1$1$1$AA==$AA==',
      'direktur'
    ])
  } catch {
    ditolak = true
  }
  if (!ditolak) await q("DELETE FROM tb_login_aira WHERE username = 'DIREKTUR'")
  cek('username case-insensitive unik', ditolak, ditolak ? '"DIREKTUR" ditolak' : 'BOCOR: dobel masuk')

  // 6. Role di luar daftar ditolak constraint — bukan hanya oleh TypeScript.
  let roleDitolak = false
  try {
    await q('INSERT INTO tb_login_aira (username, password, role) VALUES ($1, $2, $3)', [
      '__probe_role__',
      'scrypt$1$1$1$AA==$AA==',
      'dewa'
    ])
  } catch {
    roleDitolak = true
  }
  if (!roleDitolak) await q("DELETE FROM tb_login_aira WHERE username = '__probe_role__'")
  cek('role di luar daftar ditolak database', roleDitolak)

  // 7b. Divisi (19 Agu 2026)
  for (const t of ['tb_divisi_aira', 'tb_user_divisi_aira', 'tb_menu_divisi_aira']) {
    cek(`tabel ${t} ada`, nama.includes(t))
  }

  const divisi = await q<{ kode: string; nama: string }>(
    'SELECT kode, nama FROM tb_divisi_aira ORDER BY urutan'
  )
  cek('19 divisi ter-seed', divisi.length >= 19, `ada ${divisi.length}`)
  for (const [kode, namaDiv] of [
    ['pa_tp', 'PA TP'],
    ['pa_ihc', 'PA IHC'],
    ['mikrobiologi', 'Mikrobiologi']
  ]) {
    const row = divisi.find((d) => d.kode === kode)
    cek(`divisi ${namaDiv} berkode ${kode}`, row?.nama === namaDiv, row ? row.nama : 'tidak ada')
  }

  /*
   * Role 'staff' harus diterima CHECK constraint. Instalasi yang skemanya dibuat
   * sebelum 19 Agu 2026 punya constraint lama yang hanya mengenal empat role —
   * kalau migrasinya tidak jalan, membuat user Staff gagal di lapangan saja.
   *
   * ⚠️ Diuji dengan MEMBUAT user sementara, bukan dengan memeriksa akun seed.
   * Versi sebelumnya menumpang user `staff` hasil seed; begitu akun itu dibuang
   * dari `DUMMY` (9 Sep 2026), pemeriksaannya ikut mati padahal yang mau diuji —
   * constraint-nya — sama sekali tidak berubah. Menguji invariannya langsung
   * membuatnya tidak lagi bergantung pada data yang kebetulan ada.
   */
  const namaUji = `_ujistaff_${Date.now()}`
  let staffDiterima = false
  try {
    await q('INSERT INTO tb_login_aira (username, password, role) VALUES ($1, $2, $3)', [
      namaUji,
      'hash-palsu-untuk-uji-constraint',
      'staff'
    ])
    const cekRow = await q<{ role: string }>('SELECT role FROM tb_login_aira WHERE username = $1', [
      namaUji
    ])
    staffDiterima = cekRow[0]?.role === 'staff'
  } catch {
    staffDiterima = false
  } finally {
    await q('DELETE FROM tb_login_aira WHERE username = $1', [namaUji])
  }
  cek("role 'staff' diterima CHECK constraint database", staffDiterima)

  // 7. Matriks akses role × divisi per menu (30 Sep 2026).
  cek('tabel tb_menu_role_divisi_aira ada', nama.includes('tb_menu_role_divisi_aira'))

  type Sel = { menu: string; role: string; divisi_kode: string; diizinkan: boolean; updated_by: string | null }
  const bacaSel = (): Promise<Sel[]> =>
    q<Sel>('SELECT menu, role, divisi_kode, diizinkan, updated_by FROM tb_menu_role_divisi_aira')
  const selSesudah = await bacaSel()
  // Hackathon dummy DB starts fresh: with no legacy matrix there is nothing to migrate, and the
  // migration must not invent rows either (new menus/divisions are born closed — rule 36).
  const [lama] = await q<{ n: string }>(
    'SELECT (SELECT count(*) FROM tb_menu_akses_aira) + (SELECT count(*) FROM tb_menu_divisi_aira) AS n'
  )
  const adaLama = Number(lama.n) > 0
  cek(
    adaLama ? 'matriks baru terisi (migrasi berjalan)' : 'fresh DB: migration invents no matrix rows',
    adaLama ? selSesudah.length > 0 : selSesudah.length === 0,
    `${selSesudah.length} baris, matriks lama ${lama.n} baris`
  )

  const matriksBaru: MatriksAksesMenu = {}
  for (const r of selSesudah) {
    const perRole = ((matriksBaru as any)[r.menu] ??= {})
    const sel = (perRole[r.role] ??= {})
    sel[r.divisi_kode] = r.diizinkan === true
  }

  // Migrasi hanya berjalan sekali: jalan kedua applySchema (di langkah 4) tidak
  // boleh menambah atau menimpa apa pun.
  const hitungMigrasi = selSesudah.filter((r) => r.updated_by === 'migrasi').length
  await applySchema(exec, rows)
  const selUlang = await bacaSel()
  cek(
    'migrasi tidak berjalan ulang saat start berikutnya',
    selUlang.length === selSesudah.length &&
      selUlang.filter((r) => r.updated_by === 'migrasi').length === hitungMigrasi,
    `${selUlang.length} baris, ${hitungMigrasi} dari migrasi`
  )

  // Janji ke user: tidak ada satu orang pun yang aksesnya berubah karena migrasi.
  // Dibandingkan dengan aturan LAMA dihitung dari dua tabel lama, untuk SETIAP user.
  // ⚠️ Hanya sah selama matriks baru belum disentuh Super Admin — sesudah itu
  // perbedaan adalah keputusan yang sah, bukan kerusakan (pelajaran live-check
  // 6 Sep 2026: pemeriksaan yang merah permanen karena keputusan sah membuat
  // kegagalan sungguhan tidak terlihat). Dilewati dengan BERSUARA, bukan diam.
  const diubahAdmin = selSesudah.filter((r) => r.updated_by !== 'migrasi').length
  if (diubahAdmin === 0) {
    const roleLama: MatriksRoleLama = {}
    for (const r of await q<{ role: string; menu: string; diizinkan: boolean }>(
      'SELECT role, menu, diizinkan FROM tb_menu_akses_aira'
    )) {
      ;(roleLama as any)[r.role] = { ...(roleLama as any)[r.role], [r.menu]: r.diizinkan === true }
    }
    const divLama: MatriksDivisiLama = {}
    for (const r of await q<{ menu: string; divisi_kode: string; diizinkan: boolean }>(
      'SELECT menu, divisi_kode, diizinkan FROM tb_menu_divisi_aira'
    )) {
      ;(divLama as any)[r.menu] = { ...(divLama as any)[r.menu], [r.divisi_kode]: r.diizinkan === true }
    }
    const semuaUser = await q<{ username: string; role: string; divisi: string[] }>(
      `SELECT u.username, u.role,
              coalesce(array_agg(d.divisi_kode) FILTER (WHERE d.divisi_kode IS NOT NULL), '{}') AS divisi
         FROM tb_login_aira u
         LEFT JOIN tb_user_divisi_aira d ON lower(d.username) = lower(u.username)
        GROUP BY u.username, u.role`
    )
    const berubah: string[] = []
    for (const u of semuaUser) {
      const ctx = { role: u.role as any, divisi: u.divisi }
      // Hackathon build hides HIDDEN_MENUS from everyone; the old rule never knew about that.
      const lama = MENU_VALUES.filter((m) => !HIDDEN_MENUS.includes(m) && menuDiizinkanLama(ctx, m, roleLama, divLama))
      const baru = menuUntuk(ctx, matriksBaru)
      if (lama.join('|') !== baru.join('|')) berubah.push(`${u.username}: ${lama.join(',')} → ${baru.join(',')}`)
    }
    cek(
      `akses ${semuaUser.length} user identik sebelum & sesudah migrasi`,
      berubah.length === 0,
      berubah.join('; ') || 'tidak ada yang berubah'
    )
  } else {
    console.log(
      `info  perbandingan dengan matriks lama DILEWATI — ${diubahAdmin} sel sudah diubah Super Admin` +
        ' sejak migrasi, jadi perbedaan adalah keputusan sah'
    )
  }

  // Direktur & Super Admin tidak boleh punya baris (aksesnya dikunci di kode).
  let roleTerkunciDitolak = false
  try {
    await q(
      `INSERT INTO tb_menu_role_divisi_aira (menu, role, divisi_kode, diizinkan)
       VALUES ('sales', 'direktur', 'it', false)`
    )
  } catch {
    roleTerkunciDitolak = true
  }
  if (!roleTerkunciDitolak) {
    await q("DELETE FROM tb_menu_role_divisi_aira WHERE role = 'direktur'")
  }
  cek('baris untuk role terkunci ditolak CHECK', roleTerkunciDitolak)

  let fkMatriksDitolak = false
  try {
    await q(
      `INSERT INTO tb_menu_role_divisi_aira (menu, role, divisi_kode, diizinkan)
       VALUES ('sales', 'spv', 'divisi_karangan', true)`
    )
  } catch {
    fkMatriksDitolak = true
  }
  if (!fkMatriksDitolak) {
    await q("DELETE FROM tb_menu_role_divisi_aira WHERE divisi_kode = 'divisi_karangan'")
  }
  cek('divisi tak dikenal di matriks ditolak foreign key', fkMatriksDitolak)

  // Divisi baru lahir TERTUTUP. Dulu pengisian awal "Sales + Master Data untuk
  // SEMUA divisi" berjalan tiap start dan membuka divisi yang dibuat lewat panel.
  // Divisi sementara dibuat, applySchema dijalankan, lalu divisinya dihapus
  // (CASCADE membersihkan baris apa pun yang sempat menempel).
  const divUji = `_ujidiv_${Date.now()}`
  await q('INSERT INTO tb_divisi_aira (kode, nama, urutan) VALUES ($1, $1, 9999)', [divUji])
  try {
    await applySchema(exec, rows)
    const nempelBaru = await q('SELECT 1 FROM tb_menu_role_divisi_aira WHERE divisi_kode = $1', [divUji])
    const nempelLama = await q('SELECT 1 FROM tb_menu_divisi_aira WHERE divisi_kode = $1', [divUji])
    cek(
      'divisi baru lahir tertutup (tidak ada baris matriks sesudah start)',
      nempelBaru.length === 0 && nempelLama.length === 0,
      `baru=${nempelBaru.length} lama=${nempelLama.length}`
    )
  } finally {
    await q('DELETE FROM tb_divisi_aira WHERE kode = $1', [divUji])
  }

  // Kunci asing benar-benar menahan divisi karangan.
  let fkDitolak = false
  try {
    await q('INSERT INTO tb_user_divisi_aira (username, divisi_kode) VALUES ($1, $2)', [
      'spv',
      'divisi_karangan'
    ])
  } catch {
    fkDitolak = true
  }
  if (!fkDitolak) await q("DELETE FROM tb_user_divisi_aira WHERE divisi_kode = 'divisi_karangan'")
  cek('divisi tak dikenal ditolak foreign key', fkDitolak)

  // 8. Log login benar-benar bisa ditulis, beserta identitas mesin.
  const id = identitasMesin()
  await q(
    `INSERT INTO tb_login_aira_log (username, role, status, ip, hostname, os_user)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    ['__live_check__', null, 'sukses', id.ip, id.hostname, id.osUser]
  )
  const log = await q<any>(
    "SELECT ip, hostname, os_user, ts FROM tb_login_aira_log WHERE username = '__live_check__' ORDER BY ts DESC LIMIT 1"
  )
  cek('baris log tertulis', log.length === 1)
  cek('log memuat hostname', !!log[0]?.hostname, String(log[0]?.hostname))
  cek('log memuat os_user', !!log[0]?.os_user, String(log[0]?.os_user))
  cek('log memuat IP LAN', !!log[0]?.ip, String(log[0]?.ip ?? 'null — tidak ada NIC non-loopback'))
  await q("DELETE FROM tb_login_aira_log WHERE username = '__live_check__'")

  // 9. Tabel masukan: DDL diterima, jsonb bisa ditulis-baca, dan filter
  //    "milik saya" benar-benar menyaring di sisi database.
  //
  // Yang dibuktikan di sini dan TIDAK bisa dibuktikan unit test: `$17::jsonb`
  // memang diterima Postgres 14 dengan string JSON sebagai parameter (kalau
  // salah, gejalanya baru muncul saat user pertama menekan Kirim di lapangan),
  // dan CHECK pada `jenis` benar-benar terpasang.
  await q(
    `INSERT INTO tb_feedback_aira
       (username, role, divisi, hostname, os_user, ip, app_version,
        jenis, dampak, isi, sesi_id, pesan_id, mode, model,
        pertanyaan, jawaban, tool_log, sertakan_chat)
     VALUES ($1, 'spv', 'sales', $2, $3, $4, '0.0.0-live',
             'bug', 'mengganggu', 'live check', 'sesi-x', 'pesan-x', 'sales', 'old-think-model',
             'tanya', 'jawab', $5::jsonb, true)`,
    [
      '__live_check__',
      id.hostname,
      id.osUser,
      id.ip,
      JSON.stringify([{ callId: 'c1', name: 'sales_summary', argsSummary: '{}', tier: 'read', status: 'ok' }])
    ]
  )
  const fb = await q<any>(
    "SELECT jenis, status, tool_log, sertakan_chat FROM tb_feedback_aira WHERE username = '__live_check__'"
  )
  cek('baris masukan tertulis', fb.length === 1)
  cek('status bawaan = baru', fb[0]?.status === 'baru', String(fb[0]?.status))
  cek(
    'tool_log kembali sebagai JSON, bukan string',
    Array.isArray(fb[0]?.tool_log) && fb[0].tool_log[0]?.name === 'sales_summary',
    typeof fb[0]?.tool_log
  )

  // Filter "milik saya" — dijalankan dengan username LAIN, dan harus nol baris.
  // Kalau ini pernah bocor, seorang user bisa membaca masukan direktur.
  const milikOrangLain = await q<any>(
    'SELECT id FROM tb_feedback_aira WHERE lower(username) = lower($1)',
    ['__bukan_dia__']
  )
  cek('filter milik-sendiri tidak membocorkan baris orang lain', milikOrangLain.length === 0)

  // CHECK pada `jenis` memang terpasang.
  let jenisDitolak = false
  try {
    await q(
      "INSERT INTO tb_feedback_aira (username, jenis, isi) VALUES ('__live_check__', 'jenis_karangan', 'x')"
    )
  } catch {
    jenisDitolak = true
  }
  cek('jenis tak dikenal ditolak CHECK', jenisDitolak)

  // Status BEBAS — sengaja tanpa CHECK, supaya menambah tahap tindak lanjut
  // tidak berarti mengubah skema database produksi.
  let statusBaruDiterima = true
  try {
    await q(
      "UPDATE tb_feedback_aira SET status = 'menunggu_rilis' WHERE username = '__live_check__'"
    )
  } catch {
    statusBaruDiterima = false
  }
  cek('status di luar daftar tetap diterima database (memang tanpa CHECK)', statusBaruDiterima)

  await q("DELETE FROM tb_feedback_aira WHERE username = '__live_check__'")

  // 10. Tabel memori: tertulis, terbaca, dan penghapusan BERSYARAT PEMILIK.
  await q("INSERT INTO tb_memori_aira (username, isi) VALUES (lower($1), $2)", [
    '__live_check__',
    'saya pegang produk Genomics'
  ])
  const mem = await q<any>(
    "SELECT id, isi FROM tb_memori_aira WHERE lower(username) = lower('__live_check__')"
  )
  cek('baris memori tertulis', mem.length === 1)

  // ⚠️ Inti pemeriksaan ini: menghapus dengan id yang benar tapi username ORANG
  // LAIN tidak boleh menghapus apa pun. Kalau klausa pemiliknya hilang dari
  // query, siapa pun bisa menghapus memori orang lain hanya dengan menebak angka.
  await q('DELETE FROM tb_memori_aira WHERE id = $1 AND lower(username) = lower($2)', [
    mem[0].id,
    '__orang_lain__'
  ])
  const masih = await q<any>('SELECT id FROM tb_memori_aira WHERE id = $1', [mem[0].id])
  cek('hapus memori milik orang lain tidak berpengaruh', masih.length === 1)

  await q('DELETE FROM tb_memori_aira WHERE id = $1 AND lower(username) = lower($2)', [
    mem[0].id,
    '__live_check__'
  ])
  const habis = await q<any>('SELECT id FROM tb_memori_aira WHERE id = $1', [mem[0].id])
  cek('hapus memori milik sendiri berhasil', habis.length === 0)
  await q("DELETE FROM tb_memori_aira WHERE lower(username) = lower('__live_check__')")

  console.log(`\nidentitas mesin ini: host=${id.hostname} user=${id.osUser} ip=${id.ip}`)
  await pool.end()
  console.log(gagal === 0 ? '\nSEMUA LOLOS' : `\n${gagal} PEMERIKSAAN GAGAL`)
  process.exit(gagal === 0 ? 0 : 1)
}

main().catch((err) => {
  console.error('GAGAL:', err)
  process.exit(1)
})
