async function fetchSchema() {
  const url = 'https://cowmafailphyzkvodjdl.supabase.co';
  const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvd21hZmFpbHBoeXprdm9kamRsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQzOTU1NCwiZXhwIjoyMDk3MDE1NTU0fQ.B9Zl7KYSldGO_8B-LxL-yiaupT0K9jccRChs079VsDU';
  try {
    const res = await fetch(`${url}/rest/v1/`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });
    console.log('Status:', res.status);
    const data = await res.json();
    console.log('Exposed Paths:');
    if (data.paths) {
      for (const p of Object.keys(data.paths)) {
        console.log(`- ${p}`);
      }
    } else {
      console.log(data);
    }
  } catch (err) {
    console.error('Error fetching schema:', err.message);
  }
}

fetchSchema();
