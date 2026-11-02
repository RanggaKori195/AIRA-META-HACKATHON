// Hackathon build: documents, splash and charts use Windows system fonts (Segoe UI for text, Consolas for
// code). The company font is not shipped, so there is nothing to copy or embed: Chromium embeds the system
// font into PDFs by itself. The functions keep their signatures so callers stay unchanged.

export const KELUARGA_FONT = "'Segoe UI', system-ui, sans-serif"

/** No font file ships with this build — callers fall back to `KELUARGA_FONT`. */
export function fontDataUrl(_berkas: string): string | null {
  return null
}

/** No @font-face rules are needed for system fonts. */
export function siapkanFontUntukCetak(_tujuan: string): string {
  return ''
}
