-- Run this in your Supabase SQL Editor

CREATE TABLE IF NOT EXISTS flags (
  id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  video_url       TEXT NOT NULL,
  video_id        VARCHAR(20),
  reasons         TEXT[]  NOT NULL DEFAULT '{}',
  note            TEXT,
  truth_score     INTEGER,
  summary         TEXT,
  user_id         VARCHAR(64) NOT NULL,   -- anonymous stable ID from localStorage
  status          VARCHAR(20) NOT NULL DEFAULT 'pending',
  community_count INTEGER NOT NULL DEFAULT 1,
  created_at      TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(video_url, user_id)              -- one flag per user per URL
);

CREATE INDEX IF NOT EXISTS idx_flags_video_url  ON flags(video_url);
CREATE INDEX IF NOT EXISTS idx_flags_created_at ON flags(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_flags_status     ON flags(status);
