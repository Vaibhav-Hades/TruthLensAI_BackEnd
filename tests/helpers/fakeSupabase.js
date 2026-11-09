/**
 * In-memory stand-in for the Supabase client, covering exactly the query-builder calls the
 * backend uses. Lets controller logic (auth, reports, flags, admin) be tested without
 * touching a real database. It does NOT test Supabase itself (RLS, constraints).
 */
let idCounter = 0

function createFakeSupabase(seed = {}) {
  const tables = {}
  for (const [k, v] of Object.entries(seed)) tables[k] = v.map(r => ({ ...r }))
  const table = (n) => (tables[n] = tables[n] || [])

  function builder(name) {
    const state = { op: 'select', filters: [], row: null, opts: {}, order: null, limit: null, head: false, count: null, single: false, maybe: false, conflict: null }

    const run = () => {
      const rows = table(name)
      const match = (r) => state.filters.every(f => f(r))
      if (state.op === 'insert') {
        const row = { id: `id_${++idCounter}`, ...state.row }
        if (name === 'users' && rows.some(r => r.email === row.email)) return { data: null, error: { message: 'duplicate key value' } }
        rows.push(row)
        return finish([row])
      }
      if (state.op === 'upsert') {
        const keys = (state.conflict || 'id').split(',')
        const existing = rows.find(r => keys.every(k => r[k] === state.row[k]))
        if (existing) { Object.assign(existing, state.row); return finish([existing]) }
        const row = { id: `id_${++idCounter}`, ...state.row }
        rows.push(row)
        return finish([row])
      }
      if (state.op === 'delete') {
        const gone = rows.filter(match)
        tables[name] = rows.filter(r => !match(r))
        return finish(gone)
      }
      let out = rows.filter(match)
      if (state.order) {
        const { col, asc } = state.order
        out = [...out].sort((a, b) => (a[col] > b[col] ? 1 : -1) * (asc ? 1 : -1))
      }
      if (state.limit) out = out.slice(0, state.limit)
      return finish(out)
    }

    const finish = (rows) => {
      if (state.head) return { data: null, error: null, count: rows.length }
      if (state.single || state.maybe) {
        if (rows.length === 0) return state.single ? { data: null, error: { message: 'No rows' } } : { data: null, error: null }
        return { data: rows[0], error: null }
      }
      return { data: rows, error: null, count: rows.length }
    }

    const api = {
      select(_cols, opts = {}) { if (opts.head) state.head = true; return api },
      insert(row) { state.op = 'insert'; state.row = row; return api },
      upsert(row, opts = {}) { state.op = 'upsert'; state.row = row; state.conflict = opts.onConflict; return api },
      delete() { state.op = 'delete'; return api },
      eq(col, val) { state.filters.push(r => r[col] === val); return api },
      neq(col, val) { state.filters.push(r => r[col] !== val); return api },
      gte(col, val) { state.filters.push(r => r[col] >= val); return api },
      order(col, o = {}) { state.order = { col, asc: o.ascending !== false }; return api },
      limit(n) { state.limit = n; return api },
      single() { state.single = true; return api },
      maybeSingle() { state.maybe = true; return api },
      then(resolve, reject) { try { resolve(run()) } catch (e) { reject(e) } },
    }
    return api
  }

  return { from: builder, isConfigured: true, usingServiceRole: true, _tables: tables }
}

module.exports = { createFakeSupabase }
