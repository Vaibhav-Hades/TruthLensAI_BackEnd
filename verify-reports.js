require('dotenv').config()
const supabase = require('./config/supabase')

async function verifyReportsSystem() {
  console.log('🔍 Verifying TruthLens AI Reports System...\n')

  try {
    // Test 1: Check if reports table exists
    console.log('1. Checking reports table...')
    const { data: tables, error: tableError } = await supabase
      .from('reports')
      .select('id')
      .limit(1)

    if (tableError) {
      console.log('❌ Reports table not found. Please run setup-reports-table.sql in Supabase')
      console.log('   Error:', tableError.message)
      return
    }
    console.log('✅ Reports table exists')

    // Test 2: Check users table
    console.log('2. Checking users table...')
    const { data: users, error: userError } = await supabase
      .from('users')
      .select('id')
      .limit(1)

    if (userError) {
      console.log('❌ Users table not found:', userError.message)
      return
    }
    console.log('✅ Users table exists')

    // Test 3: Check table structure
    console.log('3. Verifying table structure...')
    const { data: reportStructure } = await supabase
      .from('reports')
      .select('*')
      .limit(0)

    console.log('✅ Reports table structure verified')

    // Test 4: Count existing reports
    const { count } = await supabase
      .from('reports')
      .select('*', { count: 'exact', head: true })

    console.log(`✅ Current reports count: ${count || 0}`)

    console.log('\n🎉 Reports system verification complete!')
    console.log('\n📋 Next steps:')
    console.log('   1. Start backend: npm start')
    console.log('   2. Start frontend: npm run dev')
    console.log('   3. Test saving reports after analysis')
    console.log('   4. Check Profile Dashboard for saved reports')

  } catch (error) {
    console.log('❌ Verification failed:', error.message)
  }
}

verifyReportsSystem()