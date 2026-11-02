import type { JSX } from 'react'
import type { ModelChoice } from '@shared/ipc'

interface Props {
  value: ModelChoice
  onChange: (choice: ModelChoice) => void
}

const OPTIONS: Array<{ value: ModelChoice; label: string; title: string }> = [
  { value: 'auto', label: '⚡ Auto', title: 'Pilih model otomatis sesuai jenis permintaan' },
  { value: 'chat', label: 'Cepat', title: 'Jawaban cepat untuk tanya jawab biasa' },
  { value: 'agent', label: 'Cerdas', title: 'Reasoning mendalam untuk task bertahap' },
  { value: 'coder', label: 'Coding', title: 'Dioptimalkan untuk menulis & mengedit kode' }
]

export default function ModelPicker({ value, onChange }: Props): JSX.Element {
  return (
    <select
      className="model-picker"
      value={value}
      onChange={(e) => onChange(e.target.value as ModelChoice)}
      title={OPTIONS.find((o) => o.value === value)?.title}
    >
      {OPTIONS.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
  )
}
