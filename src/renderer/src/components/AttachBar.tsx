import type { JSX } from 'react'
import type { Attachment } from '@shared/ipc'

interface Props {
  attachments: Attachment[]
  onRemove: (id: string) => void
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

export default function AttachBar({ attachments, onRemove }: Props): JSX.Element | null {
  if (attachments.length === 0) return null
  return (
    <div className="attach-bar">
      {attachments.map((a) => (
        <div key={a.id} className="attach-chip" title={`${a.name} · ${formatSize(a.size)}`}>
          <span>{a.kind === 'image' ? '🖼️' : '📄'}</span>
          <span className="attach-name">{a.name}</span>
          <button className="attach-remove" onClick={() => onRemove(a.id)} title="Hapus lampiran">
            ×
          </button>
        </div>
      ))}
    </div>
  )
}

/** Handler drag & drop bersama: ambil path file lalu titipkan ke main process. */
export function useDropHandlers(onFiles: (paths: string[]) => void): {
  onDragOver: (e: React.DragEvent) => void
  onDrop: (e: React.DragEvent) => void
} {
  return {
    onDragOver: (e) => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'copy'
    },
    onDrop: (e) => {
      e.preventDefault()
      const paths: string[] = []
      for (const file of Array.from(e.dataTransfer.files)) {
        const path = window.aira.pathForFile(file)
        if (path) paths.push(path)
      }
      if (paths.length > 0) onFiles(paths)
    }
  }
}
