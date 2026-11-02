// Aturan siapa-boleh-mematikan-apa untuk indikator run di UI.
//
// Bug nyata (18 Agu 2026): setelah riwayat chat dihapus, kotak chat tidak bisa dipakai —
// composer terkunci menampilkan tombol Stop dan tombol Kirim tidak pernah muncul.
// Tiga sebab bertumpuk:
//   1. handler hapus tidak membersihkan penanda run yang sedang berjalan
//   2. run yatim tetap jalan di main process karena penghapusan sesi tidak membatalkannya
//   3. event penutup (done/error) diterapkan tanpa memeriksa apakah ia milik run yang
//      sedang ditampilkan — run lama yang selesai belakangan ikut mengacaukan layar
//
// Modul ini murni (tanpa React, tanpa I/O) supaya ketiga aturannya bisa diuji.

export interface RunRef {
  messageId: string
  sessionId: string
}

/**
 * Apakah event penutup dengan `eventMessageId` memang menutup run yang sedang berjalan?
 * Event dari run lain diabaikan — itulah yang dulu mematikan indikator percakapan baru.
 */
export function closesRun(current: RunRef | null, eventMessageId: string): boolean {
  return current !== null && current.messageId === eventMessageId
}

/** State run sesudah event penutup: dikosongkan hanya bila event itu memang miliknya. */
export function afterClosingEvent(current: RunRef | null, eventMessageId: string): RunRef | null {
  return closesRun(current, eventMessageId) ? null : current
}

/**
 * Membuang state apa pun yang terikat pada sesi yang baru dihapus, dan hanya itu.
 * Dipakai untuk run yang berjalan, permintaan approval, dan permintaan kredensial.
 */
export function afterSessionDeleted<T extends { sessionId: string }>(
  current: T | null,
  deletedSessionId: string
): T | null {
  return current && current.sessionId === deletedSessionId ? null : current
}
