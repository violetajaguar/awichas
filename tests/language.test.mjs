import {test} from 'node:test'
import assert from 'node:assert/strict'
import {pickLanguage, LANGUAGES, DEFAULT_LANGUAGE} from '../src/language.js'
import {ANIMALS, ORDERED, voiceSources, voiceLanguage} from '../src/animals.js'
import {existsSync, readFileSync} from 'node:fs'

test('language: URL beats the remembered choice, which beats the phone language', () => {
  assert.equal(pickLanguage({param: 'es', stored: 'en', browser: ['en-GB']}), 'es')
  assert.equal(pickLanguage({param: null, stored: 'es', browser: ['en-US']}), 'es')
  assert.equal(pickLanguage({browser: ['es-PE', 'en']}), 'es')
  assert.equal(pickLanguage({browser: ['fr-FR', 'en-GB']}), 'en')
})

test('language: unknown values are ignored and English is the default', () => {
  assert.equal(DEFAULT_LANGUAGE, 'en')
  assert.equal(pickLanguage({param: 'qu', stored: 'xx', browser: ['de']}), 'en')
  assert.equal(pickLanguage(), 'en')
  assert.deepEqual(LANGUAGES.map(l => l.id), ['en', 'es'])
})

test('voices: every Awicha keeps her original English narration and has a Spanish recording', () => {
  for (const a of ORDERED) {
    assert.deepEqual(voiceSources(a), {en: `audio/${a.id}.mp3`, es: `audio/${a.id}-es.mp3`}, a.id)
    assert.equal(voiceLanguage(a, 'es'), 'es')
    assert.equal(voiceLanguage(a, 'en'), 'en')
  }
})

test('voices: an Awicha with only one recording plays it in both modes', () => {
  const englishOnly = {voice: 'audio/x.mp3'}
  assert.deepEqual(voiceSources(englishOnly), {en: 'audio/x.mp3'})
  assert.equal(voiceLanguage(englishOnly, 'es'), 'en')
})

// The recordings, the portraits and the written stories are the artist's work and are not in the public
// repository, so these two check them only when they are actually here.
const ART_PRESENT = existsSync(new URL('../voice-scripts/jaguar.en.txt', import.meta.url))

test('voice scripts: every Awicha has her story in English and Spanish, and the gecko is no longer in London', {skip: !ART_PRESENT && 'recordings and scripts not present in this checkout'}, () => {
  for (const a of ORDERED) {
    for (const lang of ['en', 'es']) {
      const file = new URL(`../voice-scripts/${a.id}.${lang}.txt`, import.meta.url)
      assert.ok(existsSync(file), `voice-scripts/${a.id}.${lang}.txt is missing`)
      const text = readFileSync(file, 'utf8')
      assert.ok(text.trim().length > 200, `${a.id}.${lang} looks empty`)
      assert.doesNotMatch(text, /london|londres/i)
    }
  }
})

test('voices: every recording named in animals.js exists', {skip: !ART_PRESENT && 'recordings not present in this checkout'}, () => {
  for (const a of ORDERED) {
    for (const [lang, src] of Object.entries(voiceSources(a))) {
      assert.ok(existsSync(new URL(`../public/${src}`, import.meta.url)), `${a.id} (${lang}): public/${src} is missing`)
    }
  }
})
