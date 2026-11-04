import type { JSX } from 'react'
import type { ModelChoice } from '@shared/ipc'

interface Props {
  value: ModelChoice
  onChange: (choice: ModelChoice) => void
}

const OPTIONS: Array<{ value: ModelChoice; label: string; title: string }> = [
  { value: 'agent', label: 'Smart (Muse Wonder)', title: 'Deep reasoning for multi-step tasks (default)' },
  { value: 'auto', label: 'Auto', title: 'Muse Spark for plain questions, Muse Wonder when work is needed' },
  { value: 'chat', label: 'Fast (Muse Spark)', title: 'Quick answers for everyday questions' },
  { value: 'coder', label: 'Coding (Muse Wonder)', title: 'Writing and editing code' }
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
