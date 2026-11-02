import { loadConfig } from '../config'
import { getSecret } from '../secrets'
import { OpenAICompatProvider } from './openai-compat'
import type { LLMProvider } from './provider'

/** Provider dari config + secret aktif. null bila API key belum di-setup. */
export function buildProvider(): LLMProvider | null {
  const config = loadConfig()
  const apiKey = getSecret('llmApiKey')
  if (!apiKey) return null
  return new OpenAICompatProvider(config.endpoint, apiKey)
}
