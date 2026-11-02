// Dasar pengakuan baris di SalesRepository.
//
// Transfer yang dibatalkan ditandai dengan soft delete lewat DUA kolom terpisah:
//   transfer_test_deleted_at         — pemeriksaan pada transfer itu dihapus
//   transaction_transfer_deleted_at  — transaksi transfernya dihapus
//
// Baris seperti itu TIDAK diakui sebagai order, sales, maupun invoice.
// (Aturan dari pemilik data, 18 Agustus 2026.)
//
// ⚠️ WAJIB `AND`, JANGAN `OR`. Terukur di data: dari 187.178 baris hanya 24 baris yang
// KEDUA penandanya terisi — sisanya terhapus lewat salah satu saja (4.228 lewat
// transfer_test, 373 lewat transaction_transfer). Akibatnya varian `OR` selalu lolos
// lewat kolom yang satunya dan hasilnya IDENTIK dengan tanpa filter sama sekali
// (Agustus 2026: Rp 4.722.780.610 pada kedua-duanya). Varian `AND` yang benar
// mengeluarkan Rp 169,7 juta pada bulan yang sama.
//
// Dampaknya besar dan bukan pembulatan: 3,3%–8,1% nett per bulan (Mar–Agu 2026),
// total 4.625 baris senilai Rp 5,77 miliar sepanjang Agu 2024–Agu 2026.

/**
 * Potongan WHERE yang membatasi ke baris yang diakui. Konstan — tidak ada nilai dari
 * model yang masuk ke sini, jadi aman digabung ke string SQL.
 *
 * Dipasang di `filters()` pada sales-tools.ts sehingga SELURUH query tool sales
 * memakainya. Jangan menulis query ke SalesRepository tanpa potongan ini.
 */
export const RECOGNIZED_CLAUSE =
  ' AND transfer_test_deleted_at IS NULL AND transaction_transfer_deleted_at IS NULL'

/** Keterangan yang ikut di hasil tool supaya AIRA bisa menyebutkannya saat ditanya. */
export const RECOGNIZED_NOTE =
  'Angka ini hanya mencakup transaksi yang DIAKUI: baris yang transfernya dibatalkan ' +
  '(transfer_test_deleted_at / transaction_transfer_deleted_at terisi) sudah dikeluarkan. ' +
  'Karena itu totalnya bisa lebih kecil dari query mentah ke SalesRepository tanpa filter.'
