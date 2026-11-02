/**
 * Penjelasan panjang soal dikte suara — ditampilkan sebagai TOOLTIP saat
 * catatan hasil dikte disorot, bukan sebagai teks di layar.
 *
 * ⚠️ Dipisah dari catatan yang tampil atas permintaan user 6 Sep 2026. Versi
 * pertama menaruh semuanya di layar — tiga baris penuh, setiap kali orang
 * berbicara, termasuk angka durasi yang sebenarnya data pengembang. Peringatan
 * sepanjang itu berhenti dibaca sesudah pemakaian kedua, jadi panjangnya justru
 * melemahkan gunanya sendiri.
 *
 * Yang tampil di layar cukup "belum dikoreksi" (`catatanTranskrip` di
 * `main/suara/rules.ts`); SEBABNYA ada di sini, terbaca saat orang penasaran.
 *
 * Tinggal di `shared` karena renderer tidak boleh mengimpor dari `main`.
 */
export const PENJELASAN_DIKTE =
  'Machine transcription often gets special names wrong, such as ERP system names, ' +
  'Order IDs, and customer names — and a misheard question produces a wrong ' +
  'number. Click to dismiss.'
