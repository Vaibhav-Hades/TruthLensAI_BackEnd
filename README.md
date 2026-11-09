# TruthLens AI — Backend

Express API that classifies text, news articles and YouTube videos as **REAL / FAKE / MISLEADING / INCONCLUSIVE**.

## Run locally

```bash
cd Backend
cp .env.example .env        # fill in values (see below)
npm install
npm start                   # http://localhost:10000   (npm run dev for nodemon)
npm test                    # 60 offline tests (mocked Groq / Event Registry / Google News / Supabase)
```

Frontend: `cd ../Frontend && npm install && npm run dev` (uses `.env.development` → `http://localhost:10000`).

## Environment variables

| Variable | Required | Purpose |
|---|---|---|
| `PORT` | no (10000) | HTTP port (Render injects it) |
| `NODE_ENV` | prod | `production` hides stack traces and **requires** `JWT_SECRET` |
| `SUPABASE_URL` | for auth/reports/flags/admin | Supabase project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | recommended | Server-side key; bypasses RLS (the backend does its own auth, so `auth.uid()` is always null — the anon key + the RLS policies reject writes) |
| `SUPABASE_ANON_KEY` | fallback | Used only if no service-role key |
| `JWT_SECRET` | prod | Signs login tokens |
| `GROQ_API_KEY` | yes (AI) | LLM claim extraction / stance checking / chat / translation / Whisper |
| `GROQ_MODEL` | no | Default `openai/gpt-oss-20b` (the old `llama-3.1-8b-instant` is retired → 404) |
| `ER_API_KEY` | yes (evidence) | Event Registry. Without it retrieval is skipped and results are INCONCLUSIVE |
| `FRONTEND_URL`, `CORS_ORIGINS` | prod | Allowed browser origins (merged with localhost dev origins) |
| `CORS_ALLOW_VERCEL_PREVIEWS`, `CORS_VERCEL_PATTERN` | no | Vercel preview-URL policy (default: `^https://truth-?lens…\.vercel\.app$`) |
| `YTDLP_PATH`, `FFMPEG_PATH` | Windows only | Full paths if not on PATH |
| `YTDLP_COOKIES`, `YTDLP_JS_RUNTIME` | no | Cookies file for YouTube bot checks; JS runtime (`node`) for newer yt-dlp |
| `REFERENCE_DATASET_PATH` | no | Folder or CSV of labelled reference items (default `./data`) |
| `MAX_INPUT_CHARS` / `MAX_ANALYSIS_CHARS` / `ANALYZE_RATE_LIMIT` | no | 100000 / 20000 / 10 per minute |

## Database

Run `setup-supabase.sql`, `setup-reports-table.sql`, `setup-flags-table.sql` in the Supabase SQL editor (the first now also creates the `analyses` table and the `users.role/phone/location` columns the signup code writes).

## API

`POST /api/analyze` `{ "url": "<text | article URL | YouTube URL>" }` →

```jsonc
{
  "prediction": "REAL|FAKE|MISLEADING|INCONCLUSIVE",
  "confidence": 0-100,            // confidence in the prediction, not "how true"
  "explanation": "…",
  "matched_text": [ { "origin": "event_registry|reference_dataset", "stance": "supports|contradicts|neutral|context",
                      "title", "source", "url", "text", "similarity?" } ],
  // plus everything the UI already used: verdict, truthScore, claimVerifications, matchedSources, summary, …
}
```

`GET /api/news/live?lang=en|hi|te|ta&category=all|politics|technology|global|ai|misinfo|economics&limit=18`
returns real, current headlines (Google News RSS in the native-language edition, plus Event Registry when `ER_API_KEY` is set),
de-duplicated, newest first, cached 60 s. The frontend polls it every minute. If every provider is down it answers 503 (no placeholder news).

`POST /api/translate` `{ payload: { key: string | (string|null)[] }, targetLang }` translates every string in the payload
(shape, nulls and array lengths preserved; per-string cache; falls back to the original text on failure).

Errors are JSON `{ error, errorCode, suggestion? }` with a meaningful status (400 invalid input, 413 too long,
422 unsupported/unextractable content, 429 rate limit, 503 missing dependency/config).

## How verification works

1. **Input** is validated (empty / too long / invalid URL / private-network URLs are rejected).
2. **Extraction**: raw text · article (HTML boiler-plate stripped) · YouTube (caption scraper → `yt-dlp` subtitles → `yt-dlp` audio + FFmpeg + Groq Whisper → title-only metadata, flagged and confidence-capped).
3. **NLP**: clean, chunk, summarise, extract entities/keywords and 2–5 checkable claims (LLM, with deterministic local fallback).
4. **Evidence**: each claim is searched on Event Registry (AND query, then OR), and an LLM decides **SUPPORTED / REFUTED / UNVERIFIED**. A verdict must cite an article number, otherwise it is discarded. Same-topic articles are *not* support.
5. **Reference dataset** (optional): local embeddings + cosine similarity find similar labelled items. This is context only; the single exception is a near-duplicate (≥ 0.85) of an item labelled *fake*, which counts as weak refuting evidence. A similar *real* item never counts as support.
6. **Classification** (`services/classificationService.js`, deterministic, unit-tested): no decided claims → INCONCLUSIVE; mostly refuted → FAKE; mostly supported and none refuted → REAL; mixed → MISLEADING. The LLM only words the explanation.

### Reference dataset layout (not included in the repo)
Put the Kaggle “Fake and Real News” files at `Backend/data/True.csv` and `Backend/data/Fake.csv`, or one CSV with `title,text,label` columns.

## Deploy (Render)

Use the included `render.yaml` / `Dockerfile` (Docker runtime — the native Node runtime has no `yt-dlp`/`ffmpeg`). Set the secret env vars in the Render dashboard. Note: YouTube often blocks datacenter IPs; if audio download fails on Render, supply `YTDLP_COOKIES`. Captions-based analysis and text/article analysis are unaffected.

## UI translations

`Frontend/src/i18n/locales/{en,hi,te,ta}.json` hold all static UI text; AI-generated result text is translated at runtime through `/api/translate`.
After adding English keys run `node scripts/gen-locales.js ../Frontend/src/i18n/locales` (needs `GROQ_API_KEY`) to fill the other languages, then review them.
