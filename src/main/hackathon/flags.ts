// Hackathon build switches. Kept in one file so the differences from production AIRA are easy to audit.
import type { Menu } from '../auth/roles'

/** Menus not offered in this build. Microsoft 365 needs the company tenant and cannot run on dummy data. */
export const HIDDEN_MENUS: readonly Menu[] = ['onedrive']

/** The default update server is a company domain; this build never checks it. */
export const UPDATES_DISABLED = true

/** Muse Image has /v1/images/edits (probed 200, 2 Nov 2026), so "edit image" stays. */
export const IMAGE_EDIT_SUPPORTED = true

/** Meta has no embedding or rerank model: the document index is off and history search uses FTS5 only. */
export const RAG_DISABLED = true
