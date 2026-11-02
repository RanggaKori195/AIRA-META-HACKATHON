import { memo, useState, type JSX, type ReactNode } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

// Render jawaban model sebagai markdown. Raw HTML sengaja TIDAK diaktifkan
// (tanpa rehype-raw): isi jawaban bisa berasal dari web/file yang untrusted.

function CodeBlock({ children }: { children: ReactNode }): JSX.Element {
  const [copied, setCopied] = useState(false)
  const text = extractText(children)
  return (
    <div className="code-wrap">
      <button
        className="code-copy"
        onClick={() => {
          window.aira.copyText(text)
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        }}
      >
        {copied ? '✓ Disalin' : 'Salin'}
      </button>
      <pre>{children}</pre>
    </div>
  )
}

function extractText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(extractText).join('')
  if (typeof node === 'object' && 'props' in node) {
    return extractText((node as { props: { children?: ReactNode } }).props.children)
  }
  return ''
}

function MarkdownView({ text }: { text: string }): JSX.Element {
  return (
    <div className="markdown">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          pre: ({ children }) => <CodeBlock>{children}</CodeBlock>,
          table: ({ children }) => (
            <div className="table-wrap">
              <table>{children}</table>
            </div>
          ),
          a: ({ href, children }) => (
            <a href={href} target="_blank" rel="noreferrer noopener">
              {children}
            </a>
          )
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

export default memo(MarkdownView)
