import type { AiraApi } from './index'

declare global {
  interface Window {
    aira: AiraApi
  }
}

export {}
