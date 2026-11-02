import { useEffect, useRef, type JSX } from 'react'

// Pengganti window.confirm().
//
// Dialog native itu menjalankan nested message loop yang memblokir main process, dan di
// Windows jendela induknya butuh beberapa detik untuk mendapatkan fokus input kembali —
// gejalanya kotak chat tidak bisa dipakai sesaat sesudah menekan Yes. Dialog ini murni
// React, tidak memblokir apa pun, dan tampilannya mengikuti tema aplikasi.

interface Props {
  title: string
  body?: string
  confirmLabel?: string
  onConfirm: () => void
  onCancel: () => void
}

export default function ConfirmDialog({
  title,
  body,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel
}: Props): JSX.Element {
  const confirmRef = useRef<HTMLButtonElement>(null)

  // Enter untuk setuju, Escape untuk batal — perilaku yang sama dengan dialog native,
  // supaya kebiasaan user tidak berubah.
  useEffect(() => {
    confirmRef.current?.focus()
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault()
        onCancel()
      } else if (e.key === 'Enter') {
        e.preventDefault()
        onConfirm()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onConfirm, onCancel])

  return (
    <div className="dialog-backdrop" onClick={onCancel}>
      <div
        className="dialog"
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{title}</h3>
        {body && <p className="dialog-body">{body}</p>}
        <div className="dialog-actions">
          <button className="btn-ghost" onClick={onCancel}>
            Cancel
          </button>
          <button className="btn-danger" ref={confirmRef} onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
