async function testTables() {
  // Load credentials from environment variables to avoid committing secrets.
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || '';
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || '';

  if (!url || !key) {
    console.error('Supabase URL or key not set. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY environment variables, or update provider-keys.local.json (ignored).');
    console.error('Exiting test to avoid using hardcoded credentials.');
    return;
  }

  const headers = {
    apikey: key,
    Authorization: `Bearer ${key}`,
    'Content-Type': 'application/json',
    Prefer: 'return=representation'
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
// Usage: set environment variables and run with Node:
// SUPABASE_URL=https://your-project.supabase.co SUPABASE_SERVICE_ROLE_KEY=your_key node test-tables.js
