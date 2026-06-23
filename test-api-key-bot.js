const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const http = require('http');
const { spawn } = require('child_process');

// Helper to read .env config
const getEnvVar = (key) => {
  if (process.env[key]) return process.env[key];
  try {
    const envPath = path.join(__dirname, '.env');
    if (fs.existsSync(envPath)) {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          const parts = trimmed.split('=');
          if (parts[0].trim() === key) {
            return parts.slice(1).join('=').trim().replace(/^["']|["']$/g, '');
          }
        }
      }
    }
  } catch (e) {
    console.error('Error reading env file:', e);
  }
  return null;
};

const sbUrl = getEnvVar('SUPABASE_URL');
const sbKey = getEnvVar('SUPABASE_KEY');

if (!sbUrl || !sbKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_KEY are required in .env');
  process.exit(1);
}

// Generate unique IDs for testing to avoid conflicts
const testId = crypto.randomBytes(6).toString('hex');
const activeKey = `sk_copilot_active_${testId}`;
const inactiveKey = `sk_copilot_inactive_${testId}`;
const wildcardKey = `sk_copilot_wildcard_${testId}`;

const activeConvId = `conv_active_${testId}`;
const inactiveConvId = `conv_inactive_${testId}`;
const wildcardConvId = `conv_wildcard_${testId}`;

const username = `test_bot_${testId}`;
const passwordHash = crypto.createHash('sha256').update('secret123').digest('hex');

// Supabase headers
const supabaseHeaders = {
  'apikey': sbKey,
  'Authorization': `Bearer ${sbKey}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

async function setupSupabaseKeys() {
  console.log('--- Setting up Test API Keys in Supabase ---');
  
  const activeBody = {
    id: activeKey,
    owner_id: username,
    title: 'API_KEY',
    metadata: {
      type: 'api_key_config',
      username: username,
      password_hash: passwordHash,
      available_models: ['gpt-4', 'gpt-3.5-turbo'],
      conversation_id: activeConvId,
      status: 'active',
      created_at: new Date().toISOString()
    }
  };

  const inactiveBody = {
    id: inactiveKey,
    owner_id: username,
    title: 'API_KEY',
    metadata: {
      type: 'api_key_config',
      username: username,
      password_hash: passwordHash,
      available_models: ['gpt-4'],
      conversation_id: inactiveConvId,
      status: 'inactive',
      created_at: new Date().toISOString()
    }
  };

  const wildcardBody = {
    id: wildcardKey,
    owner_id: username,
    title: 'API_KEY',
    metadata: {
      type: 'api_key_config',
      username: username,
      password_hash: passwordHash,
      available_models: ['*'],
      conversation_id: wildcardConvId,
      status: 'active',
      created_at: new Date().toISOString()
    }
  };

  // Insert configurations
  for (const body of [activeBody, inactiveBody, wildcardBody]) {
    const res = await fetch(`${sbUrl}/rest/v1/conversations`, {
      method: 'POST',
      headers: supabaseHeaders,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`Failed to insert test key ${body.id}: ${text}`);
    }
    console.log(`Successfully created key: ${body.id}`);
  }
}

async function cleanupSupabaseKeys() {
  console.log('\n--- Cleaning up Test API Keys in Supabase ---');
  
  const keys = [activeKey, inactiveKey, wildcardKey];
  const query = `id=in.(${keys.join(',')})`;
  
  // 1. Delete matching messages first to avoid foreign key conflicts
  const convs = [activeConvId, inactiveConvId, wildcardConvId];
  const msgQuery = `conversation_id=in.(${convs.join(',')})`;
  const resMsg = await fetch(`${sbUrl}/rest/v1/messages?${msgQuery}`, {
    method: 'DELETE',
    headers: supabaseHeaders
  });
  if (resMsg.ok) {
    console.log('Cleaned up test messages.');
  }

  // 2. Delete test conversations created in tests
  const resConv = await fetch(`${sbUrl}/rest/v1/conversations?id=in.(${convs.join(',')})`, {
    method: 'DELETE',
    headers: supabaseHeaders
  });
  if (resConv.ok) {
    console.log('Cleaned up test conversations.');
  }

  // 3. Delete the keys (they are stored in conversations table as rows)
  const resKeys = await fetch(`${sbUrl}/rest/v1/conversations?${query}`, {
    method: 'DELETE',
    headers: supabaseHeaders
  });
  if (resKeys.ok) {
    console.log('Cleaned up test keys.');
  }
}

// Spin up a mock downstream LLM server
let mockServer;
function startMockServer() {
  return new Promise((resolve) => {
    mockServer = http.createServer((req, res) => {
      if (req.url === '/chat/completions' && req.method === 'POST') {
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const parsed = JSON.parse(body);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            choices: [
              {
                message: {
                  role: 'assistant',
                  content: `Mock response for model ${parsed.model}`
                }
              }
            ],
            usage: {
              prompt_tokens: 15,
              completion_tokens: 8,
              total_tokens: 23
            }
          }));
        });
      } else {
        res.writeHead(404);
        res.end();
      }
    });
    
    mockServer.listen(8081, () => {
      console.log('Mock downstream server listening on port 8081');
      resolve();
    });
  });
}

// Write temporary test-config.json
const configPath = path.join(__dirname, 'test-config.json');
function writeTestConfig() {
  const config = {
    port: '8080',
    api_key: 'static-fallback-key',
    models: {
      'gpt-4': 'http://localhost:8081',
      'gpt-3.5-turbo': 'http://localhost:8081',
      'local': 'http://localhost:8081',
      'default': 'http://localhost:8081'
    }
  };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  console.log('Wrote temporary test-config.json');
}

// Start gateway server
let gatewayProc;
function startGateway() {
  return new Promise((resolve, reject) => {
    console.log('Starting backend-gateway Go server...');
    gatewayProc = spawn('go', ['run', 'cmd/gateway/main.go'], {
      cwd: path.join(__dirname, 'backend-gateway'),
      env: {
        ...process.env,
        SUPABASE_URL: sbUrl,
        SUPABASE_KEY: sbKey,
        CONFIG_PATH: configPath,
        PORT: '8080'
      }
    });

    gatewayProc.stdout.on('data', (data) => {
      const line = data.toString().trim();
      console.log(`[Gateway STDOUT] ${line}`);
    });

    gatewayProc.stderr.on('data', (data) => {
      const line = data.toString().trim();
      console.log(`[Gateway STDERR] ${line}`);
    });

    gatewayProc.on('error', (err) => {
      reject(err);
    });

    // Poll health endpoint
    const interval = setInterval(async () => {
      try {
        const res = await fetch('http://localhost:8080/health');
        if (res.status === 200) {
          clearInterval(interval);
          console.log('Gateway is healthy and ready!');
          resolve();
        }
      } catch (e) {
        // Wait
      }
    }, 500);

    // Timeout after 15s
    setTimeout(() => {
      clearInterval(interval);
      reject(new Error('Gateway server failed to start within 15 seconds.'));
    }, 15000);
  });
}

// Helper to make API calls to local gateway
async function callGateway(authKey, model, messages, conversationID = undefined) {
  const body = { model, messages };
  if (conversationID !== undefined) {
    body.conversation_id = conversationID;
  }
  
  const headers = { 'Content-Type': 'application/json' };
  if (authKey) {
    headers['Authorization'] = `Bearer ${authKey}`;
  }

  const res = await fetch('http://localhost:8080/v1/chat/completions', {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  const status = res.status;
  let text = '';
  try {
    text = await res.text();
  } catch (e) {}

  return { status, text };
}

// Verify database message insertion
async function getSupabaseMessages(convId) {
  const res = await fetch(`${sbUrl}/rest/v1/messages?conversation_id=eq.${convId}&select=*`, {
    headers: supabaseHeaders
  });
  if (res.ok) {
    return await res.json();
  }
  return [];
}

async function runTests() {
  let failed = false;

  console.log('\n--- Running API Key Validation Tests ---');

  // Test Case 1: Missing API Key
  try {
    console.log('\n[Test 1] Testing request with missing API key...');
    const res = await callGateway(null, 'gpt-4', [{ role: 'user', content: 'hello' }]);
    if (res.status === 401) {
      console.log('✅ Success: Rejected with 401 Unauthorized.');
    } else {
      console.error(`❌ Fail: Expected status 401, got ${res.status}. Response: ${res.text}`);
      failed = true;
    }
  } catch (e) {
    console.error('❌ Fail: Request error:', e.message);
    failed = true;
  }

  // Test Case 2: Invalid API Key
  try {
    console.log('\n[Test 2] Testing request with invalid API key...');
    const res = await callGateway('sk_copilot_fakekey_123', 'gpt-4', [{ role: 'user', content: 'hello' }]);
    if (res.status === 401) {
      console.log('✅ Success: Rejected with 401 Unauthorized.');
    } else {
      console.error(`❌ Fail: Expected status 401, got ${res.status}. Response: ${res.text}`);
      failed = true;
    }
  } catch (e) {
    console.error('❌ Fail: Request error:', e.message);
    failed = true;
  }

  // Test Case 3: Inactive API Key
  try {
    console.log('\n[Test 3] Testing request with inactive API key...');
    const res = await callGateway(inactiveKey, 'gpt-4', [{ role: 'user', content: 'hello' }]);
    if (res.status === 401) {
      console.log('✅ Success: Rejected with 401 Unauthorized.');
    } else {
      console.error(`❌ Fail: Expected status 401, got ${res.status}. Response: ${res.text}`);
      failed = true;
    }
  } catch (e) {
    console.error('❌ Fail: Request error:', e.message);
    failed = true;
  }

  // Test Case 4: Forbidden - Wrong Model (Model not listed in allowed list)
  try {
    console.log('\n[Test 4] Testing request with forbidden model for key...');
    const res = await callGateway(activeKey, 'local', [{ role: 'user', content: 'hello' }]);
    if (res.status === 403 && res.text.includes('Forbidden: API Key does not have access to model')) {
      console.log('✅ Success: Rejected with 403 Forbidden due to model restriction.');
    } else {
      console.error(`❌ Fail: Expected status 403, got ${res.status}. Response: ${res.text}`);
      failed = true;
    }
  } catch (e) {
    console.error('❌ Fail: Request error:', e.message);
    failed = true;
  }

  // Test Case 5: Forbidden - Wrong Conversation ID
  try {
    console.log('\n[Test 5] Testing request with mismatched conversation_id...');
    const res = await callGateway(activeKey, 'gpt-4', [{ role: 'user', content: 'hello' }], 'conv_wrong_id_xyz');
    if (res.status === 403 && res.text.includes('Forbidden: Conversation ID does not match API Key context')) {
      console.log('✅ Success: Rejected with 403 Forbidden due to conversation ID restriction.');
    } else {
      console.error(`❌ Fail: Expected status 403, got ${res.status}. Response: ${res.text}`);
      failed = true;
    }
  } catch (e) {
    console.error('❌ Fail: Request error:', e.message);
    failed = true;
  }

  // Test Case 6: Success - Valid Key, No Conversation ID (Auto-Injected)
  try {
    console.log('\n[Test 6] Testing request with valid key and no conversation_id...');
    const res = await callGateway(activeKey, 'gpt-4', [{ role: 'user', content: 'hello from active bot' }]);
    if (res.status === 200) {
      console.log('✅ Success: Status 200.');
      const data = JSON.parse(res.text);
      if (data.content && data.content.includes('Mock response for model gpt-4')) {
        console.log('✅ Success: Response matches mock downstream.');
        
        // Wait briefly for repository writing async flows
        await new Promise(r => setTimeout(r, 1000));
        
        // Query Supabase to confirm message was written under activeConvId
        const msgs = await getSupabaseMessages(activeConvId);
        const userMsg = msgs.find(m => m.role === 'user');
        const assistantMsg = msgs.find(m => m.role === 'assistant');
        if (userMsg && userMsg.content === 'hello from active bot' && assistantMsg) {
          console.log('✅ Success: Message successfully saved in Supabase with correct conversation ID context.');
        } else {
          console.error('❌ Fail: Message record not found or incorrect in Supabase messages table.', msgs);
          failed = true;
        }
      } else {
        console.error('❌ Fail: Response payload content wrong:', res.text);
        failed = true;
      }
    } else {
      console.error(`❌ Fail: Expected status 200, got ${res.status}. Response: ${res.text}`);
      failed = true;
    }
  } catch (e) {
    console.error('❌ Fail: Request error:', e.message);
    failed = true;
  }

  // Test Case 7: Success - Exact matching Conversation ID
  try {
    console.log('\n[Test 7] Testing request with matching conversation_id...');
    const res = await callGateway(activeKey, 'gpt-4', [{ role: 'user', content: 'matching conversation check' }], activeConvId);
    if (res.status === 200) {
      console.log('✅ Success: Status 200.');
    } else {
      console.error(`❌ Fail: Expected status 200, got ${res.status}. Response: ${res.text}`);
      failed = true;
    }
  } catch (e) {
    console.error('❌ Fail: Request error:', e.message);
    failed = true;
  }

  // Test Case 8: Success - Wildcard model access validation
  try {
    console.log('\n[Test 8] Testing request with wildcard model key for restricted model...');
    const res = await callGateway(wildcardKey, 'local', [{ role: 'user', content: 'wildcard check' }]);
    if (res.status === 200) {
      console.log('✅ Success: Status 200 with wildcard model permissions.');
    } else {
      console.error(`❌ Fail: Expected status 200, got ${res.status}. Response: ${res.text}`);
      failed = true;
    }
  } catch (e) {
    console.error('❌ Fail: Request error:', e.message);
    failed = true;
  }

  if (failed) {
    console.error('\n❌ SOME TESTS FAILED.');
    process.exit(1);
  } else {
    console.log('\n🎉 ALL TESTS PASSED SUCCESSFULLY!');
  }
}

async function main() {
  try {
    await setupSupabaseKeys();
    await startMockServer();
    writeTestConfig();
    await startGateway();
    
    await runTests();
  } catch (err) {
    console.error('Critical test runner error:', err);
    process.exit(1);
  } finally {
    // Shutdown processes and cleanup
    console.log('\nCleaning up processes...');
    if (gatewayProc) {
      try {
        gatewayProc.kill();
        console.log('Killed gateway process.');
      } catch (e) {}
    }
    if (mockServer) {
      mockServer.close();
      console.log('Closed mock downstream server.');
    }
    try {
      if (fs.existsSync(configPath)) {
        fs.unlinkSync(configPath);
        console.log('Removed temporary test-config.json');
      }
    } catch (e) {}
    
    // Clean up Supabase
    try {
      await cleanupSupabaseKeys();
    } catch (e) {
      console.error('Failed cleaning up Supabase:', e.message);
    }
  }
}

main();
