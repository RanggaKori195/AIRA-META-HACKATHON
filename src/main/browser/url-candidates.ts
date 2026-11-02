/**
 * Membuka URL dengan fallback yang masuk akal: banyak situs korporat hanya melayani
 * varian "www" (domain telanjang bisa mengembalikan 503 dari router). Fallback TIDAK
 * PERNAH menurunkan https ke http — halaman login di koneksi polos berarti kredensial
 * terkirim tanpa enkripsi. Modul murni supaya ter-cover unit test.
 */
export function candidateUrls(input: string): string[] {
  const raw = /^https?:\/\//i.test(input) ? input : `https://${input}`
  const list: string[] = []
  try {
    const parsed = new URL(raw)
    if (parsed.protocol === 'http:') {
      const upgraded = new URL(raw)
      upgraded.protocol = 'https:'
      list.push(upgraded.toString())
    }
    list.push(parsed.toString())
    if (!parsed.hostname.startsWith('www.')) {
      const withWww = new URL(list[0])
      withWww.hostname = `www.${parsed.hostname}`
      list.push(withWww.toString())
    }
  } catch {
    return [raw]
  }
  return [...new Set(list)]
}
