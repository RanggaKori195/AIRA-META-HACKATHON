// The Reagent Check folder per user (config). Chosen only through a main-process dialog — the renderer never
// sends a path — so the reagent tools can read nothing outside the folder the user picked.
import { loadConfig, saveConfig } from '../config'

export function reagentFolderFor(username: string): string | null {
  return loadConfig().reagentFolders[username.toLowerCase()] ?? null
}

export function setReagentFolder(username: string, folder: string): void {
  const config = loadConfig()
  config.reagentFolders = { ...config.reagentFolders, [username.toLowerCase()]: folder }
  saveConfig(config)
}
