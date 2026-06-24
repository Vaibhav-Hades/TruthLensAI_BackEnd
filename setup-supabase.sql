-- TruthLens AI Supabase Database Setup
-- Run these commands in your Supabase SQL editor

-- Users table (replaces MongoDB User model)
CREATE TABLE IF NOT EXISTS users (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  email VARCHAR(255) UNIQUE NOT NULL,
  password VARCHAR(255) NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Sources table (replaces MongoDB Source model)
CREATE TABLE IF NOT EXISTS sources (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  label VARCHAR(255) NOT NULL,
  url VARCHAR(512) NOT NULL,
  embedding FLOAT8[] NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Reports table (for saved user reports)
CREATE TABLE IF NOT EXISTS reports (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  url VARCHAR(2048) NOT NULL,
  truth_score INTEGER NOT NULL CHECK (truth_score >= 0 AND truth_score <= 100),
  summary VARCHAR(500),
  meaning VARCHAR(500),
  sources JSONB DEFAULT '[]'::jsonb,
  thumbnail VARCHAR(512),
  video_id VARCHAR(20),
  content_type VARCHAR(20) DEFAULT 'video',
  platform_id VARCHAR(30) DEFAULT 'youtube',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  UNIQUE(user_id, url)
);

-- Indexes for better performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
CREATE INDEX IF NOT EXISTS idx_reports_user_id ON reports(user_id);
CREATE INDEX IF NOT EXISTS idx_reports_created_at ON reports(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_sources_created_at ON sources(created_at);

-- Enable Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE sources ENABLE ROW LEVEL SECURITY;

-- RLS Policies
-- Users can only see their own data
CREATE POLICY "Users can view own profile" ON users
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "Users can update own profile" ON users
  FOR UPDATE USING (auth.uid() = id);

-- Reports policies
CREATE POLICY "Users can view own reports" ON reports
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own reports" ON reports
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own reports" ON reports
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own reports" ON reports
  FOR DELETE USING (auth.uid() = user_id);

-- Sources are publicly readable (for fact-checking)
CREATE POLICY "Sources are publicly readable" ON sources
  FOR SELECT TO authenticated, anon USING (true);

-- Only service role can modify sources
CREATE POLICY "Only service role can modify sources" ON sources
  FOR ALL USING (auth.role() = 'service_role');