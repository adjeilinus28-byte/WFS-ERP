// ============================================================================
//  Translation helper for page-level literals.
//  `at('Some label')` slugifies the string into a key under "str" and looks it
//  up, falling back to the English original. Safe to call at module scope.
//  Re-rendering on language change is handled by AppShell keying <main> on the
//  active language.
//  NOTE: only ever call this on hard-coded UI strings — never on values that
//  come from the database (department names, employee names, item titles).
// ============================================================================
import i18n from '../i18n'

const slugKey = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')

export function at(s) {
  if (typeof s !== 'string' || !s.trim()) return s
  // Preserve trailing punctuation ( ":" label colons, " *" required markers )
  const m = s.match(/^(.*?)(\s*\*|:)?$/)
  const base = (m && m[1]) || s
  const suffix = (m && m[2]) || ''
  const k = slugKey(base)
  if (!k) return s
  return i18n.t('str.' + k, { defaultValue: base }) + suffix
}

export default at
