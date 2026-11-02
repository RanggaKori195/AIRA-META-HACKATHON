import type { ToolTier } from '../../shared/ipc'

export interface ToolContext {
  allowedDirs: string[]
  /**
   * Sesi chat yang sedang berjalan. Dipakai tool yang butuh ruang kerja per
   * percakapan (ruang uji) — jangan dipakai untuk otorisasi; itu urusan
   * `tolakBilaTakBerizin` di orchestrator.
   */
  sessionId?: string
  /**
   * Meminta kredensial ke user lewat form di dalam chat. Nilainya tidak pernah
   * melewati context model. null = user membatalkan.
   */
  requestCredential?: (
    name: string,
    url: string
  ) => Promise<{ username: string; password: string } | null>
}

export interface ToolDefinition {
  name: string
  /** Label ramah untuk UI; kalau kosong, UI memakai name. */
  label?: string
  description: string
  // JSON Schema untuk parameter — dikirim apa adanya ke LLM.
  parameters: Record<string, unknown>
  tier: ToolTier
  /**
   * Tier yang bergantung pada ARGUMEN, bukan hanya pada nama tool.
   *
   * Ada tool yang sebagian besar pemakaiannya tidak berbahaya tapi punya satu
   * bentuk yang perlu izin — `uji_jalankan` menjalankan kode di ruang uji tanpa
   * popup, tapi MENARIK PAKET dari internet tetap harus disetujui user. Tanpa
   * ini pilihannya cuma dua-duanya buruk: popup di setiap putaran perbaikan
   * (user menekan "izinkan" tanpa membaca), atau tidak ada popup sama sekali.
   *
   * Dibiarkan kosong = pakai `tier`.
   */
  tierFor?: (args: Record<string, unknown>, ctx: ToolContext) => ToolTier
  /** Ringkasan human-readable untuk UI approval, mis. "Pindahkan a.txt -> arsip/". */
  summarize: (args: Record<string, unknown>) => string
  execute: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>
  timeoutMs?: number
}

export class ToolError extends Error {}
