// CSV export shared by every table.
//   columns: [{ key, label, value?: (row) => any }]
// Values are quoted and escaped; a leading = + - @ is prefixed with ' so
// spreadsheet apps don't run cell contents as formulas.
const cell = (v) => {
  if (v == null) return ''
  let s = typeof v === 'object' ? JSON.stringify(v) : String(v)
  if (/^[=+\-@\t\r]/.test(s) && Number.isNaN(Number(s))) s = `'${s}`
  return `"${s.replace(/"/g, '""')}"`
}

export function toCsv(columns, rows) {
  const head = columns.map((c) => cell(c.label ?? c.key)).join(',')
  const body = rows.map((r) => columns.map((c) => cell(c.value ? c.value(r) : r[c.key])).join(','))
  return [head, ...body].join('\r\n')
}

export function exportCsv(filename, columns, rows) {
  // BOM so Excel reads UTF-8 (₵, accents) correctly
  const blob = new Blob(['﻿', toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `${filename}-${new Date().toISOString().slice(0, 10)}.csv`
  document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
