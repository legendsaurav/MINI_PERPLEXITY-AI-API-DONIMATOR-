async function testTables() {
  const url = 'https://cowmafailphyzkvodjdl.supabase.co';
  const key = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImNvd21hZmFpbHBoeXprdm9kamRsIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc4MTQzOTU1NCwiZXhwIjoyMDk3MDE1NTU0fQ.B9Zl7KYSldGO_8B-LxL-yiaupT0K9jccRChs079VsDU';
  
  const headers = {
    'apikey': key,
    'Authorization': `Bearer ${key}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  try {
    console.log('1. Testing conversations GET...');
    const getConvRes = await fetch(`${url}/rest/v1/conversations?select=*&limit=1`, { headers });
    console.log('GET conversations status:', getConvRes.status);
    const convs = await getConvRes.json();
    console.log('GET conversations data:', convs);

    console.log('\n2. Testing conversations INSERT...');
    const testId = 'test-conv-' + Date.now();
    const insertConvRes = await fetch(`${url}/rest/v1/conversations`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        id: testId,
        owner_id: 'test-owner',
        title: 'Test Conversation from script',
        metadata: { source: 'test-script' }
      })
    });
    console.log('INSERT conversation status:', insertConvRes.status);
    const insertedConv = await insertConvRes.json();
    console.log('INSERT conversation data:', insertedConv);

    console.log('\n3. Testing messages INSERT...');
    const insertMsgRes = await fetch(`${url}/rest/v1/messages`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        conversation_id: testId,
        role: 'user',
        content: 'Hello, this is a test message!'
      })
    });
    console.log('INSERT message status:', insertMsgRes.status);
    const insertedMsg = await insertMsgRes.json();
    console.log('INSERT message data:', insertedMsg);

    // Clean up
    console.log('\n4. Testing DELETE...');
    const deleteRes = await fetch(`${url}/rest/v1/conversations?id=eq.${testId}`, {
      method: 'DELETE',
      headers
    });
    console.log('DELETE conversation status:', deleteRes.status);

  } catch (err) {
    console.error('Error during tables test:', err.message);
  }
}

testTables();
