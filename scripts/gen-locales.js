/**
 * Dev tool: fills missing/changed UI strings in the hi/te/ta locale files from en.json using Groq.
 *   node scripts/gen-locales.js ../Frontend/src/i18n/locales [--force-all]
 * A key is (re)translated when it is missing in the target file, or its English text changed
 * compared with git HEAD. Review the generated text before shipping.
 */
require('dotenv').config()
require('../config/llm')
const fs = require('fs')
const path = require('path')
const { execSync } = require('child_process')
const axios = require('axios')
const { GROQ_API_URL, GROQ_MODEL } = require('../config/llm')

const dir = path.resolve(process.argv[2] || '../Frontend/src/i18n/locales')
const FORCE = process.argv.includes('--force-all')
const LANGS = { hi: 'Hindi (Devanagari)', te: 'Telugu (Telugu script)', ta: 'Tamil (Tamil script)' }

const GLOSSARY = `Product name "TruthLens AI" stays in English. Keep these concepts consistent:
verify/verification = fact-check; claim = a factual statement; evidence/source = news report used for checking;
Supported / Contradicted / Unverified = whether reporting confirms / conflicts with / does not address a claim;
Real / Fake / Misleading / Inconclusive = final result labels; confidence = how sure the system is.
Keep placeholders like {{count}}, {{score}}, {{label}} exactly unchanged. Keep emoji, arrows and symbols unchanged.
Keep brand names (YouTube, Sarvam, Whisper, Google News, Event Registry, Groq) unchanged.
UI strings must be short, natural and idiomatic for a consumer app, not word-by-word.`

const flat = (o, p = '') => Object.entries(o).flatMap(([k, v]) => (v && typeof v === 'object' ? flat(v, p + k + '.') : [[p + k, v]]))
const setk = (o, key, val) => { const ps = key.split('.'); let d = o; ps.slice(0, -1).forEach(x => { d = d[x] = (typeof d[x] === 'object' && d[x]) || {} }); d[ps[ps.length - 1]] = val }

const en = JSON.parse(fs.readFileSync(path.join(dir, 'en.json'), 'utf8'))
let headEn = {}
try { headEn = JSON.parse(execSync('git show HEAD:src/i18n/locales/en.json', { cwd: path.resolve(dir, '../../..'), encoding: 'utf8' })) } catch (_) { /* no git history */ }
const enFlat = Object.fromEntries(flat(en))
const headFlat = Object.fromEntries(flat(headEn))

async function translateBatch(entries, langName) {
  const input = {}
  entries.forEach(([k, v], i) => { input[String(i)] = v })
  const prompt = `Translate each English UI string into ${langName}.\n${GLOSSARY}\n` +
    'Return ONLY a JSON object with the same numeric keys and the translated strings as values.\n' + JSON.stringify(input)
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const r = await axios.post(GROQ_API_URL, {
        model: GROQ_MODEL, messages: [{ role: 'user', content: prompt }], temperature: 0.1, max_tokens: 6000,
        response_format: { type: 'json_object' },
      }, { headers: { Authorization: 'Bearer ' + process.env.GROQ_API_KEY }, timeout: 90000 })
      const out = JSON.parse(r.data.choices[0].message.content)
      const bad = entries.filter(([k, v], i) => typeof out[i] !== 'string' || !out[i].trim() ||
        (v.match(/\{\{\w+\}\}/g) || []).some(ph => !out[i].includes(ph)))
      if (bad.length) throw new Error('missing/invalid: ' + bad.map(b => b[0]).slice(0, 5).join(','))
      return entries.map(([k], i) => [k, out[i]])
    } catch (e) {
      const wait = e.response && e.response.status === 429 ? (parseFloat(e.response.headers['retry-after']) || 20) * 1000 + 2000 : 1500
      console.warn('  retry', attempt + 1, e.message.slice(0, 100), `(waiting ${Math.round(wait / 1000)}s)`)
      await new Promise(r => setTimeout(r, wait))
    }
  }
  throw new Error('batch failed')
}

;(async () => {
  for (const [lang, langName] of Object.entries(LANGS)) {
    const file = path.join(dir, `${lang}.json`)
    const cur = JSON.parse(fs.readFileSync(file, 'utf8'))
    const curFlat = Object.fromEntries(flat(cur))
    const todo = Object.entries(enFlat).filter(([k, v]) =>
      typeof v === 'string' && (FORCE || !(k in curFlat) || (k in headFlat && headFlat[k] !== v)))
    console.log(`${lang}: translating ${todo.length} strings`)
    for (let i = 0; i < todo.length; i += 30) {
      const done = await translateBatch(todo.slice(i, i + 30), langName)
      done.forEach(([k, v]) => setk(cur, k, v))
      fs.writeFileSync(file, JSON.stringify(cur, null, 2) + '\n') // save progress after every batch
      process.stdout.write('.')
    }
    console.log()
    fs.writeFileSync(file, JSON.stringify(cur, null, 2) + '\n')
  }
  console.log('done')
})().catch(e => { console.error(e); process.exit(1) })
