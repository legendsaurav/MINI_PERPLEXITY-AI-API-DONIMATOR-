async function testSupabase() {
  console.log('\nTesting connection to Supabase REST API...');
  const url = 'https://cowmafailphyzkvodjdl.supabase.co';
  const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvd21hZmFpbHBoeXprdm9kamRsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQzOTU1NCwiZXhwIjoyMDk3MDE1NTU0fQ.B9Zl7KYSldGO_8B-LxL-yiaupT0K9jccRChs079VsDU';
  try {
    const res = await fetch(`${url}/rest/v1/workspaces?select=*`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });
    console.log('Supabase status:', res.status);
    const data = await res.json();
    console.log('Supabase response:', data);
  } catch (err) {
    console.error('Failed to connect to Supabase REST:', err.message);
  }
}

testSupabase();
