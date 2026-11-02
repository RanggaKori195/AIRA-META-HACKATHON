---
name: root-cause-analysis
description: Analisa akar masalah (RCA) untuk insiden operasional — alat lab mati, sampel tertukar/ditolak, TAT molor, sistem/LIS down, keluhan pelanggan. Kronologi, 5 Whys berbasis bukti, Fishbone 6M, tingkat keparahan SEV-1–4, dan tindakan korektif & preventif (CAPA) ber-PIC dan bertenggat. Pakai saat user minta RCA, akar masalah, 5 why, fishbone, atau menelusuri penyebab sebuah kejadian.
---

# Root Cause Analysis (RCA) — AI Lab Assistant

Tujuan RCA: menemukan **celah SISTEM** yang membiarkan kejadian terjadi, lalu menutupnya supaya
tidak terulang. Bukan mencari siapa yang salah.

## Aturan yang tidak boleh dilanggar

1. **Fakta dulu, jangan mengarang.** Jam kejadian, nama alat, jumlah sampel, durasi, dan dampak
   HANYA boleh berasal dari kalimat user, lampiran, atau hasil tool. Yang belum diketahui ditulis
   **"belum diketahui"** dan masuk daftar "Data yang masih dibutuhkan" — jangan ditebak supaya
   laporannya terlihat lengkap. RCA dengan kronologi karangan lebih berbahaya daripada tidak ada
   RCA: tindakan korektifnya akan menutup lubang yang salah.
2. **Tanpa menyalahkan orang (blameless).** 5 Whys BERHENTI di celah sistem (SOP tidak ada/tidak
   jelas, tidak ada verifikasi kedua, alarm tidak ada, pelatihan tidak terjadwal, beban kerja),
   BUKAN di "petugas lalai". Kalau jawabannya "karena X lupa", tanyakan satu kali lagi: *kenapa
   sistem membiarkan lupa itu lolos?*
3. **Setiap "karena" wajib punya bukti.** Tulis sumber buktinya di sebelahnya (keterangan user,
   log alat, data TAT, lampiran). Penyebab tanpa bukti ditandai **(dugaan — perlu dibuktikan)**.
4. **Angka dihitung tool, bukan diperkirakan.** Kalau tool data tersedia (mis. `lab_tat`,
   `lab_backlog`, `lab_lacak` di menu Tanya TAT Sample), pakai untuk mengukur dampak. Kalau tidak
   tersedia, tulis dampak sesuai keterangan user saja.
5. **Data pasien tidak masuk laporan.** Rujuk sampel dengan Order ID atau jumlah, jangan nama
   pasien, tanggal lahir, atau hasil pemeriksaan.

## Kalau informasinya belum cukup

Bila user hanya menulis satu kalimat ("alat PCR mati tadi pagi, tolong RCA"), JANGAN langsung
menulis laporan penuh. Ajukan **paling banyak 5 pertanyaan singkat sekaligus**, misalnya:
- Kapan mulai dan kapan pulih (jam)?
- Apa yang terlihat pertama kali, dan oleh siapa (jabatan, bukan nama)?
- Berapa sampel / pemeriksaan / pelanggan yang terdampak?
- Apa yang sudah dilakukan untuk memulihkan?
- Apakah pernah terjadi sebelumnya?

Kalau user minta langsung dibuatkan draf, buat — tapi semua bagian yang belum diketahui ditandai
jelas, dan daftar pertanyaannya tetap ada di akhir.

## Langkah

### 1. Ringkasan kejadian
Apa yang terjadi, di mana (unit/divisi: IP, PK, Mikrobiologi, Genomics, PA, Phlebo, Logistik, IT,
dst.), kapan, dan dampaknya — 3–5 kalimat.

### 2. Kronologi
Tabel **Waktu | Kejadian | Sumber**. Hanya waktu yang diketahui; celah waktu ditulis "belum
diketahui".

### 3. Dampak (radius)
- Pasien/sampel: jumlah terdampak, penundaan hasil, perlu ambil ulang?
- Pelanggan: RS/klinik/korporat mana yang terdampak (nama instansi boleh)
- Operasional: TAT, backlog, lembur, biaya reagen/kontrol terbuang
- Kepatuhan: apakah menyentuh akreditasi / mutu (QMS) / pelaporan

### 4. Tingkat keparahan
| SEV | Kriteria untuk lab klinik |
|---|---|
| SEV-1 | Risiko keselamatan pasien (hasil salah terkirim, sampel tertukar), atau layanan kritis berhenti > 4 jam |
| SEV-2 | Banyak sampel tertunda / harus diambil ulang, pelanggan besar terdampak, pelanggaran mutu |
| SEV-3 | Gangguan terbatas satu unit/alat, ada jalur cadangan, TAT masih dalam batas toleransi |
| SEV-4 | Nyaris terjadi (near miss) atau gangguan kecil tanpa dampak ke pasien |

Sebutkan alasan pemilihan tingkatnya. Kalau ragu di antara dua tingkat, pilih yang LEBIH TINGGI
dan tulis kenapa.

### 5. 5 Whys
Satu rantai per masalah utama, maksimal 5 tingkat, format:
`Kenapa [gejala]? → Karena [penyebab] (bukti: …)`
Berhenti ketika sampai di celah sistem yang bisa ditutup dengan tindakan. Kalau ada dua cabang
penyebab yang sama kuat, buat dua rantai.

### 6. Fishbone (6M) — pemeriksaan silang
Tabel **Kategori | Temuan | Berperan? (ya/tidak/belum diketahui)**:
- **Man** (SDM): kompetensi, pelatihan, beban kerja, serah terima shift
- **Machine** (alat): kalibrasi, perawatan preventif, umur alat, suku cadang
- **Method** (metode): SOP ada/jelas/dipatuhi, alur kerja, verifikasi
- **Material**: reagen, kontrol, lot, kedaluwarsa, penyimpanan, tabung/wadah sampel
- **Measurement** (pengukuran): QC, batas kontrol, interpretasi, validasi hasil
- **Mother nature** (lingkungan): suhu, listrik/UPS, jaringan, LIS/sistem, transportasi sampel

Fishbone dipakai untuk MEMERIKSA 5 Whys: kategori yang ternyata berperan tapi tidak muncul di
5 Whys berarti rantainya belum lengkap.

### 7. Akar masalah
1–3 kalimat. Harus berupa celah sistem, dan harus konsisten dengan 5 Whys + Fishbone.

### 8. Tindakan (CAPA)
Tabel **No | Tindakan | Jenis | PIC (jabatan/divisi) | Tenggat | Cara membuktikan selesai**
- **Koreksi**: memulihkan kejadian ini (sudah/akan dilakukan)
- **Korektif**: menutup akar masalah
- **Preventif**: mencegah kejadian serupa di tempat/alat lain
Setiap tindakan harus bisa DIPERIKSA (mis. "SOP revisi terbit & disosialisasikan ke 12 analis"),
bukan "lebih berhati-hati". PIC dan tenggat yang belum ditentukan user ditulis "(usulan)".

### 9. Data yang masih dibutuhkan
Daftar hal yang belum diketahui dan siapa yang kemungkinan bisa menjawabnya. Bagian ini WAJIB ada
walau kosong ("Tidak ada — semua data di atas berasal dari keterangan user/tool").

## Keluaran

- Tulis laporannya di jawaban dengan judul bagian persis seperti langkah 1–9.
- Tawarkan menjadikannya dokumen: Word (`write_word`) atau PDF (`write_pdf`) bertema perusahaan, dengan
  judul "Laporan RCA — [kejadian] — [tanggal]". Buat berkasnya hanya bila user setuju atau memang
  memintanya sejak awal. Di menu data (mis. Tanya TAT Sample) tool dokumen tidak tersedia —
  sarankan menyalin laporannya ke Task Baru untuk dijadikan berkas, jangan mengaku sudah membuatnya.
- Jangan menyatakan RCA "selesai" atau "terverifikasi". RCA adalah analisa awal yang perlu ditinjau
  penanggung jawab mutu/QMS.
