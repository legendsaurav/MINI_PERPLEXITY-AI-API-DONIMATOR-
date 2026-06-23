async function testKeysTable() {
  const url = 'https://cowmafailphyzkvodjdl.supabase.co';
  const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvd21hZmFpbHBoeXprdm9kamRsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQzOTU1NCwiZXhwIjoyMDk3MDE1NTU0fQ.B9Zl7KYSldGO_8B-LxL-yiaupT0K9jccRChs079VsDU';
  const headers = { 'apikey': key, 'Authorization': `Bearer ${key}` };

  console.log('1. Trying /rest/v1/api_keys...');
  const res1 = await fetch(`${url}/rest/v1/api_keys?select=*&limit=1`, { headers });
  console.log('Status api_keys:', res1.status);
  try { console.log('Data api_keys:', await res1.json()); } catch (e) { console.log('Err parsing api_keys json'); }

  console.log('\n2. Trying /rest/v1/user_api_keys...');
  const res2 = await fetch(`${url}/rest/v1/user_api_keys?select=*&limit=1`, { headers });
  console.log('Status user_api_keys:', res2.status);
  try { console.log('Data user_api_keys:', await res2.json()); } catch (e) { console.log('Err parsing user_api_keys json'); }
}

testKeysTable();
