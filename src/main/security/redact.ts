// Redaction pola credential — modul murni (tanpa Electron) supaya bisa di-test langsung.

const SECRET_PATTERNS = [/sk-[A-Za-z0-9_-]{8,}/g, /ydc-[A-Za-z0-9_-]{8,}/g, /Bearer\s+\S+/gi]

export function redactText(text: string): string {
  let out = text
  for (const pattern of SECRET_PATTERNS) out = out.replace(pattern, '[REDACTED]')
  return out
}
