import ReactMarkdown from 'react-markdown'
import { contentKeys } from '../../lib/keys'
import { splitMarkdownTables } from '../../lib/markdownTables'
import { imagePlaceholder, isExternalHref, safeLinkHref } from '../../lib/markdownSafety'

// Model output is untrusted markdown: no images (each one is a network fetch
// an injected manuscript could aim anywhere) and only web, mail or in-app
// links. See lib/markdownSafety.js.
function SafeLink({ href, children }) {
  const safe = safeLinkHref(href)
  if (!safe) return <span>{children}</span>
  if (isExternalHref(safe)) {
    return <a href={safe} target="_blank" rel="noopener noreferrer nofollow">{children}</a>
  }
  return <a href={safe}>{children}</a>
}

function NoImage({ alt }) {
  const text = imagePlaceholder(alt)
  return text ? <span>{text}</span> : null
}

const COMPONENTS = { a: SafeLink, img: NoImage }
// A table cell holds inline Markdown only; a <p> inside <td> adds a margin.
const CELL_COMPONENTS = { ...COMPONENTS, p: ({ children }) => children }

function Markdown({ text, components = COMPONENTS }) {
  return (
    <ReactMarkdown components={components} urlTransform={(url) => safeLinkHref(url) ?? ''}>
      {text}
    </ReactMarkdown>
  )
}

function MarkdownTable({ header, rows }) {
  const rowKeys = contentKeys(rows.map((row) => row.join('|')), 'row')
  return (
    <table>
      <thead>
        <tr>
          {contentKeys(header, 'th').map((key, column) => (
            <th key={key} scope="col"><Markdown text={header[column]} components={CELL_COMPONENTS} /></th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={rowKeys[index]}>
            {contentKeys(row, 'td').map((key, column) => (
              <td key={key}><Markdown text={row[column]} components={CELL_COMPONENTS} /></td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

/**
 * Tables are split out first (lib/markdownTables.js) because react-markdown
 * renders CommonMark only and showed them as raw pipes (2026-11-25).
 */
export function SafeMarkdown({ children }) {
  const segments = splitMarkdownTables(typeof children === 'string' ? children : String(children ?? ''))
  const keys = contentKeys(segments.map((segment) => JSON.stringify(segment)), 'segment')
  return segments.map((segment, index) => (segment.type === 'table'
    ? <MarkdownTable key={keys[index]} header={segment.header} rows={segment.rows} />
    : <Markdown key={keys[index]} text={segment.text} />))
}
