// ============================================================================
//  i18n bootstrap — resources are bundled (no async loading, no suspense).
//  Language is auto-detected (localStorage → browser) and persisted.
//  Add a language: create src/locales/<code>.json and register it below.
// ============================================================================
import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import LanguageDetector from 'i18next-browser-languagedetector'
import en from './locales/en.json'
import fr from './locales/fr.json'

export const LANGS = [
  { code: 'en', label: 'English' },
  { code: 'fr', label: 'Français' },
]

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { en: { translation: en }, fr: { translation: fr } },
    fallbackLng: 'en',
    interpolation: { escapeValue: false },       // React already escapes
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'wfs-lang',
      caches: ['localStorage'],
    },
    returnEmptyString: false,
  })

export default i18n
