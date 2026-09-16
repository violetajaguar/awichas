// The visitor's listening language (English / Español). The choice is remembered on this device and shared
// by the home page and the experience; ?lang=es or ?lang=en in the URL wins (handy for QR codes by the prints).
export const LANGUAGES = [
  {id: 'en', label: 'English'},
  {id: 'es', label: 'Español'},
]
export const DEFAULT_LANGUAGE = 'en'
const STORAGE_KEY = 'awichas-language'
const known = id => LANGUAGES.some(l => l.id === id)

/** URL parameter, then the remembered choice, then the phone's own languages, then English. */
export function pickLanguage({param = null, stored = null, browser = []} = {}) {
  if (known(param)) return param
  if (known(stored)) return stored
  for (const tag of browser) {
    const base = String(tag || '').toLowerCase().split('-')[0]
    if (known(base)) return base
  }
  return DEFAULT_LANGUAGE
}

function readStored() {
  try { return localStorage.getItem(STORAGE_KEY) } catch { return null }
}

export function getLanguage() {
  const param = new URLSearchParams(location.search).get('lang')
  const lang = pickLanguage({param, stored: readStored(), browser: navigator.languages || [navigator.language]})
  if (known(param)) setLanguage(param)
  return lang
}

export function setLanguage(id) {
  if (!known(id)) return
  try { localStorage.setItem(STORAGE_KEY, id) } catch { /* private mode etc.: the choice lasts for this page only */ }
}

/** Fills `container` with one button per language. `onChange(id)` runs when the visitor picks another one. */
export function mountLanguageSwitch(container, current, onChange) {
  container.innerHTML = LANGUAGES.map(l =>
    `<button type="button" data-lang="${l.id}" lang="${l.id}">${l.label}</button>`).join('')
  const buttons = [...container.querySelectorAll('button')]
  const show = (id) => {
    for (const b of buttons) b.setAttribute('aria-pressed', String(b.dataset.lang === id))
  }
  show(current)
  container.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-lang]')
    if (!b || b.getAttribute('aria-pressed') === 'true') return
    show(b.dataset.lang)
    onChange(b.dataset.lang)
  })
  return {show}
}
