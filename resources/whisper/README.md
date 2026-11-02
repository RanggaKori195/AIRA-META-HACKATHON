# whisper.cpp — dikte suara AIRA

Folder ini **sengaja kosong di repo**. Isinya binary ±190 MB yang tidak layak
masuk kontrol versi, dan harus diletakkan manual sebelum `npm run dist`.

## Isi folder (terpasang 6 Sep 2026, rilis `b4938`)

⚠️ **`whisper-cli.exe` TIDAK berdiri sendiri.** Ia butuh DLL pendamping di
folder yang SAMA. Menyalin exe-nya saja menghasilkan kegagalan saat dijalankan,
bukan pesan yang menjelaskan.

| Berkas | Isi |
|---|---|
| `whisper-cli.exe` | Binary whisper.cpp Windows x64 |
| `whisper.dll`, `ggml.dll`, `ggml-base.dll` | Pustaka inti |
| `ggml-cpu-*.dll` (9 berkas) | Varian per generasi CPU |
| `ggml-small-q5_1.bin` | Model `small` terkuantisasi (181 MB) |

⚠️ **Kesembilan `ggml-cpu-*.dll` WAJIB ikut semuanya.** Yang dipakai dipilih
**saat jalan** menurut CPU laptopnya — terukur di laptop pengembangan, yang
termuat `ggml-cpu-haswell.dll`. Membuang yang "tidak terpakai di sini" membuat
fitur ini mati **hanya di sebagian laptop**, dan itu jenis kegagalan yang paling
mahal ditelusuri dari jauh.

Nama exe & model dipatok di `src/main/suara/rules.ts` (`NAMA_EXE`, `NAMA_MODEL`);
DLL tidak disebut kode — Windows memuatnya sendiri dari folder exe.

## Dari mana

- Binary + DLL — <https://github.com/ggml-org/whisper.cpp/releases>
  aset **`whisper-bin-x64.zip`**, isinya ada di `Release/`
- `ggml-small-q5_1.bin` — <https://huggingface.co/ggerganov/whisper.cpp/tree/main>

### Kenapa `whisper-bin-x64.zip`, bukan varian lain

- `whisper-cublas-*` = CUDA/GPU. Tidak dipakai: jalur GPU sudah ditolak (VRAM),
  dan laptop tim belum tentu ber-NVIDIA.
- `whisper-blas-bin-x64.zip` (20 MB, OpenBLAS) **tidak diperlukan** — terukur
  6 Sep 2026 build polos sudah **3,80 detik untuk audio 5 detik** dengan
  `-t 8` (0,76× waktu nyata). Kalau kelak terasa lambat di laptop yang lebih
  tua, di sinilah tempat menukarnya — tapi ukur dulu, jangan tukar karena
  teorinya lebih cepat (§22).

Terukur di laptop pengembangan (Ryzen 7 5700U, 16 thread), audio 5 detik:
`-t 2` 8,34 dtk · `-t 4` 5,21 dtk · **`-t 8` 3,80 dtk** · `-t 16` 3,58 dtk.
Kode memakai `cpus/2` (= 8 di sini) — menaikkannya ke 16 hanya menang tipis
sambil merebut seluruh CPU dari antarmuka.

⚠️ Unduh hanya dari kedua sumber resmi di atas. Ini binary yang akan ikut ke
installer yang dipasang di laptop seluruh tim.

## Kenapa model `small`, bukan `medium` / `large`

Transkripsi berjalan di **CPU laptop user**, bukan GPU. Whisper di gateway the company
sudah ditolak karena VRAM terbatas (HANDOFF §10 no. 8), jadi jalur GPU tertutup.
`small` adalah titik seimbang: ±190 MB dan beberapa detik per kalimat.
`medium` (±1,5 GB) membuat installer tidak masuk akal dan waktu tunggunya
melewati batas sabar orang yang cuma mau bertanya "berapa sales bulan ini".

## Kalau folder ini dibiarkan kosong

Aplikasi **tetap jalan normal** — `cariWhisper()` mengembalikan `null`,
`suaraTersedia()` `false`, dan tombol mikrofon **disembunyikan sama sekali**.
Ini disengaja (§46): tombol yang ada tapi selalu gagal lebih buruk daripada
tombol yang tidak ada.

Sebabnya ikut tercatat di log aplikasi beserta **daftar folder yang dicari**,
supaya "tombol mikrofon tidak muncul" tidak jadi laporan tanpa petunjuk.

## Sesudah mengisi folder ini

```bash
npm run dist
```

⚠️ Tutup dulu AIRA yang sedang jalan — `release/win-unpacked/AIRA.exe` yang
hidup mengunci `icudtl.dat` dan build berhenti dengan `EBUSY`.
