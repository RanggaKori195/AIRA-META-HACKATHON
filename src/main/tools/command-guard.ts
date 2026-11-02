// Model kadang "membuka website" lewat shell (Start-Process/start/chrome) alih-alih
// browser_open. Akibatnya halaman terbuka di browser lain sehingga AIRA tidak bisa
// membacanya, dan pengaman kita (fallback www, larangan login non-HTTPS) terlewati.
// Modul murni supaya ter-cover unit test.

const URL_LAUNCH_PATTERNS = [
  /\bstart-process\b[^\n]*https?:\/\//i,
  /(^|[\s;&|])start\s+["']?https?:\/\//i,
  /\b(chrome|msedge|iexplore|firefox|opera|brave)(\.exe)?\b[^\n]*https?:\/\//i,
  /\bexplorer(\.exe)?\b[^\n]*https?:\/\//i,
  /\b(xdg-open|open\s+-a)\b[^\n]*https?:\/\//i,
  /\brundll32\b[^\n]*url\.dll/i
]

import { ToolError } from './types'

export function assertNotBrowserLaunch(command: string): void {
  if (URL_LAUNCH_PATTERNS.some((pattern) => pattern.test(command))) {
    throw new ToolError(
      'membuka URL lewat shell tidak diizinkan — gunakan tool browser_open agar halaman terbuka ' +
        'di browser AIRA dan isinya bisa dibaca (browser_read).'
    )
  }
}
