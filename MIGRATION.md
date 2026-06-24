# MongoDB to Supabase Migration

This backend has been migrated from MongoDB to Supabase for better scalability and easier deployment.

## Changes Made

### Removed Files/Dependencies
- ❌ `mongoose` dependency removed from package.json
- ❌ `config/db.js` - MongoDB connection file
- ❌ `models/User.js` - MongoDB User model
- ❌ `models/Source.js` - MongoDB Source model
- ❌ `seed.js` - MongoDB seeding script

### Added Files
- ✅ `config/sources.js` - Supabase sources configuration
- ✅ `seed-supabase.js` - New Supabase seeding script
- ✅ `setup-supabase.sql` - Database schema setup
- ✅ Updated `.env.example` with Supabase variables

### Updated Files
- ✅ `controllers/adminController.js` - Uses Supabase for source counting
- ✅ `services/similarityService.js` - Fetches sources from Supabase
- ✅ `controllers/authController.js` - Already using Supabase
- ✅ `controllers/reportsController.js` - Already using Supabase
- ✅ `package.json` - Added seed script, removed mongoose

## Setup Instructions

1. **Create Supabase Project**
   - Go to https://supabase.com
   - Create a new project
   - Get your project URL and anon key

2. **Setup Database**
   - Run the SQL commands in `setup-supabase.sql` in your Supabase SQL editor
   - This creates the required tables: users, sources, reports

3. **Environment Variables**
   - Copy `.env.example` to `.env`
   - Fill in your Supabase credentials:
     ```
     SUPABASE_URL=your_supabase_project_url
     SUPABASE_ANON_KEY=your_supabase_anon_key
     JWT_SECRET=your_jwt_secret_here
     ```

4. **Seed Data**
   - Run `npm run seed` to populate the sources table
   - This replaces the old MongoDB seeding process

## Database Schema

### users
- `id` (UUID, Primary Key)
- `name` (VARCHAR(80))
- `email` (VARCHAR(255), Unique)
- `password` (VARCHAR(255), Hashed)
- `created_at` (Timestamp)

### sources
- `id` (UUID, Primary Key)
- `label` (VARCHAR(255))
- `url` (VARCHAR(512))
- `embedding` (FLOAT8[])
- `created_at` (Timestamp)

### reports
- `id` (UUID, Primary Key)
- `user_id` (UUID, Foreign Key)
- `url` (VARCHAR(2048))
- `truth_score` (INTEGER, 0-100)
- `summary` (VARCHAR(500))
- `meaning` (VARCHAR(500))
- `sources` (JSONB)
- `thumbnail` (VARCHAR(512))
- `video_id` (VARCHAR(20))
- `content_type` (VARCHAR(20))
- `platform_id` (VARCHAR(30))
- `created_at` (Timestamp)

## Benefits of Migration

- ✅ **No Database Setup**: No need to install/manage MongoDB
- ✅ **Built-in Auth**: Supabase provides authentication out of the box
- ✅ **Real-time**: Built-in real-time subscriptions
- ✅ **Scalable**: Automatic scaling and backups
- ✅ **SQL**: Familiar SQL syntax instead of MongoDB queries
- ✅ **Row Level Security**: Built-in security policies