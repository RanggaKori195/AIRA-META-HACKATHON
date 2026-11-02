// Deteksi apakah PDF benar-benar punya lapisan teks. pdf-parse menyisipkan
// penanda halaman ("-- 1 of 3 --") yang membuat PDF hasil scan tampak berisi teks,
// sehingga OCR tidak pernah terpicu. Modul murni supaya ter-cover unit test.

const PAGE_MARKER = /--\s*\d+\s*of\s*\d+\s*--/gi
const MIN_MEANINGFUL_CHARS = 20

export function stripPageMarkers(raw: string): string {
  return raw.replace(PAGE_MARKER, ' ')
}

export function hasTextLayer(raw: string): boolean {
  return stripPageMarkers(raw).replace(/\s+/g, ' ').trim().length >= MIN_MEANINGFUL_CHARS
}
