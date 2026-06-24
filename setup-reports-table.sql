-- TruthLens AI Reports Table Setup
-- Run this in your Supabase SQL Editor

-- Create reports table
CREATE TABLE IF NOT EXISTS reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  truth_score INTEGER NOT NULL CHECK (truth_score >= 0 AND truth_score <= 100),
  summary TEXT,
  meaning TEXT,
  sources JSONB DEFAULT '[]'::jsonb,
  thumbnail TEXT,
  video_id VARCHAR(20),
  content_type VARCHAR(20) DEFAULT 'video',
  platform_id VARCHAR(30) DEFAULT 'youtube',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  
  -- Unique constraint to prevent duplicate reports per user
  UNIQUE(user_id, url)
);

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_reports_user_id ON reports(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reports_truth_score ON reports(truth_score);

-- Enable Row Level Security
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;

-- RLS Policies for reports
CREATE POLICY "Users can view own reports" ON reports
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own reports" ON reports
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reports" ON reports
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own reports" ON reports
  FOR DELETE USING (auth.uid() = user_id);

-- Grant permissions
GRANT ALL ON reports TO authenticated;
GRANT ALL ON reports TO service_role;