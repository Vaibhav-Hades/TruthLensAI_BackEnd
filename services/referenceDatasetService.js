/**
 * referenceDatasetService.js
 *
 * Static reference dataset (e.g. the Kaggle "Fake and Real News" data) used as CONTEXT for the
 * verification pipeline. It is optional: if no dataset file is present the service reports
 * `available: false` and the pipeline carries on with live evidence only.
 *
 * Supported layouts (set REFERENCE_DATASET_PATH, default ./data):
 *   - a directory containing True.csv and Fake.csv  (Kaggle "Fake and Real News Dataset")
 *   - a single CSV with a `label` column (values like real/true/1 or fake/false/0)
 * Columns used: title, text (either may be missing).
 *
 * Matching uses local embeddings + cosine similarity. A match tells you "a similar item exists
 * in the dataset and it was labelled X" — it is NOT proof that the submitted claim is true.
 */

const fs = require('fs')
const path = require('path')
const { embedText, cosineSimilarity } = require('./embeddingService')

const MAX_ROWS = parseInt(process.env.REFERENCE_DATASET_MAX_ROWS || '6000', 10)
const MIN_REPORT_SIMILARITY = 0.35

let index = null // { items: [{label,title,snippet,vec}], loadedAt, source }

// Minimal RFC-4180 CSV parser (handles quoted fields, escaped quotes and embedded newlines).
function parseCsv(content, maxRows) {
  const rows = []
  let row = [], field = '', inQuotes = false
  for (let i = 0; i < content.length; i++) {
    const ch = content[i]
    if (inQuotes) {
      if (ch === '"') {
        if (content[i + 1] === '"') { field += '"'; i++ } else inQuotes = false
      } else field += ch
    } else if (ch === '"') inQuotes = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && content[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.length > 1 || row[0] !== '') rows.push(row)
      row = []
      if (maxRows && rows.length > maxRows) return rows
    } else field += ch
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows
}

function normaliseLabel(v) {
  const s = String(v || '').trim().toLowerCase()
  if (['real', 'true', '1', 'reliable', 'legit'].includes(s)) return 'real'
  if (['fake', 'false', '0', 'unreliable', 'hoax'].includes(s)) return 'fake'
  return null
}

function rowsToItems(rows, forcedLabel, limit) {
  if (!rows.length) return []
  const header = rows[0].map(h => h.trim().toLowerCase())
  const iTitle = header.indexOf('title')
  const iText = header.indexOf('text')
  const iLabel = header.indexOf('label')
  const items = []
  for (let r = 1; r < rows.length && items.length < limit; r++) {
    const row = rows[r]
    const label = forcedLabel || (iLabel >= 0 ? normaliseLabel(row[iLabel]) : null)
    if (!label) continue
    const title = iTitle >= 0 ? (row[iTitle] || '').trim() : ''
    const text = iText >= 0 ? (row[iText] || '').trim() : ''
    const combined = `${title}. ${text}`.slice(0, 1500)
    if (combined.length < 20) continue
    items.push({ label, title, snippet: (text || title).slice(0, 280), vec: embedText(combined) })
  }
  return items
}

function resolveFiles(basePath) {
  if (!fs.existsSync(basePath)) return []
  const stat = fs.statSync(basePath)
  if (stat.isFile()) return [{ file: basePath, label: null }]
  const files = []
  for (const name of fs.readdirSync(basePath)) {
    if (!/\.csv$/i.test(name)) continue
    const lower = name.toLowerCase()
    if (lower === 'true.csv' || lower === 'real.csv') files.push({ file: path.join(basePath, name), label: 'real' })
    else if (lower === 'fake.csv') files.push({ file: path.join(basePath, name), label: 'fake' })
    else files.push({ file: path.join(basePath, name), label: null })
  }
  return files
}

function loadReferenceDataset(basePath = process.env.REFERENCE_DATASET_PATH || path.join(__dirname, '..', 'data')) {
  const files = resolveFiles(basePath)
  if (!files.length) { index = { items: [], loadedAt: Date.now(), source: null }; return index }
  const perFile = Math.max(1, Math.floor(MAX_ROWS / files.length))
  const items = []
  for (const { file, label } of files) {
    try {
      const rows = parseCsv(fs.readFileSync(file, 'utf8'), perFile + 1)
      items.push(...rowsToItems(rows, label, perFile))
    } catch (err) {
      console.warn(`[reference-dataset] Could not load ${file}: ${err.message}`)
    }
  }
  index = { items, loadedAt: Date.now(), source: basePath }
  console.log(`[reference-dataset] Loaded ${items.length} reference items from ${basePath}`)
  return index
}

function getStatus() {
  if (!index) loadReferenceDataset()
  return { available: index.items.length > 0, items: index.items.length, source: index.source }
}

/**
 * @returns {Array<{label, similarity, title, snippet, origin:'reference_dataset'}>}
 */
function findReferenceMatches(text, topK = 3) {
  if (!index) loadReferenceDataset()
  if (!index.items.length || !text) return []
  const q = embedText(String(text).slice(0, 3000))
  return index.items
    .map(it => ({ it, sim: cosineSimilarity(q, it.vec) }))
    .filter(x => x.sim >= MIN_REPORT_SIMILARITY)
    .sort((a, b) => b.sim - a.sim)
    .slice(0, topK)
    .map(({ it, sim }) => ({
      label: it.label,
      similarity: Number(sim.toFixed(4)),
      title: it.title,
      snippet: it.snippet,
      origin: 'reference_dataset',
    }))
}

module.exports = { loadReferenceDataset, findReferenceMatches, getStatus, parseCsv, _reset: () => { index = null } }
