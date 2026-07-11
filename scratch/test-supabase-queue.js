const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const getEnvVar = (key) => {
  if (process.env[key]) return process.env[key];
  try {
    const envPath = path.join(__dirname, '../.env');
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
  } catch (e) {}
  return null;
};

const sbUrl = getEnvVar('SUPABASE_URL');
const sbKey = getEnvVar('SUPABASE_KEY');

if (!sbUrl || !sbKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_KEY are required in .env');
  process.exit(1);
}

const testId = crypto.randomBytes(6).toString('hex');
const testApiKey = `sk_copilot_test_${testId}`;
const testConvId = `conv_test_${testId}`;
const username = `test_user_${testId}`;
const passwordHash = crypto.createHash('sha256').update('password123').digest('hex');

const headers = {
  'apikey': sbKey,
  'Authorization': `Bearer ${sbKey}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

async function setupTestKey() {
  console.log('1. Setting up test API key in Supabase...');
  const body = {
    id: testApiKey,
    owner_id: username,
    title: 'API_KEY',
    metadata: {
      type: 'api_key_config',
      username: username,
      password_hash: passwordHash,
      available_models: ['*'],
      conversation_id: testConvId,
      status: 'active',
      created_at: new Date().toISOString()
    }
  };

  const res = await fetch(`${sbUrl}/rest/v1/conversations`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    throw new Error(`Failed to setup test key: ${await res.text()}`);
  }
  console.log('✓ Test API key created.');
}

async function cleanupTestKey() {
  console.log('\n5. Cleaning up test keys and messages from Supabase...');
  
  // Delete conversation configuration
  await fetch(`${sbUrl}/rest/v1/conversations?id=eq.${testApiKey}`, {
    method: 'DELETE',
    headers
  });
  // Delete test conversation record if created
  await fetch(`${sbUrl}/rest/v1/conversations?id=eq.${testConvId}`, {
    method: 'DELETE',
    headers
  });
  // Delete leftover messages if any
  await fetch(`${sbUrl}/rest/v1/messages?conversation_id=eq.${testConvId}`, {
    method: 'DELETE',
    headers
  });
  console.log('✓ Cleanup completed.');
}

// Mock Electron Polling Agent
let mockAgentInterval;
function startMockElectronAgent() {
  console.log('2. Starting Mock Electron Polling Agent...');
  
  mockAgentInterval = setInterval(async () => {
    try {
      // Poll pending messages
      const res = await fetch(`${sbUrl}/rest/v1/messages?role=eq.user&device_id=is.null&model=eq.mini-perplexity&order=created_at.desc&limit=1`, {
        headers
      });

      if (!res.ok) return;

      const results = await res.json();
      if (!results || results.length === 0) return;

      const pendingMsg = results[0];
      console.log(`[MockAgent] Found pending query: "${pendingMsg.content}"`);

      // Lock message
      const lockRes = await fetch(`${sbUrl}/rest/v1/messages?id=eq.${pendingMsg.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ device_id: 'processing' })
      });

      if (!lockRes.ok) {
        console.error('[MockAgent] Failed to lock message');
        return;
      }
      console.log('[MockAgent] Message locked. Simulating response...');

      // Wait 2 seconds (simulate browser latency)
      await new Promise(r => setTimeout(r, 2000));

      const mockReply = `Hello! This is a mock response from the Electron App for your query: "${pendingMsg.content}"`;

      // Insert assistant reply
      const saveRes = await fetch(`${sbUrl}/rest/v1/messages`, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          conversation_id: pendingMsg.conversation_id,
          role: 'assistant',
          content: mockReply,
          model: 'mock-provider',
          user_id: 'gateway'
        })
      });

      if (!saveRes.ok) {
        console.error('[MockAgent] Failed to save assistant reply:', await saveRes.text());
        return;
      }
      console.log('[MockAgent] Reply saved to Supabase.');

      // Mark user message as completed
      await fetch(`${sbUrl}/rest/v1/messages?id=eq.${pendingMsg.id}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ device_id: 'completed' })
      });

    } catch (e) {
      console.error('[MockAgent] Error:', e.message);
    }
  }, 1000);
}

// Start Go Gateway
let gatewayProc;
function startGateway() {
  return new Promise((resolve, reject) => {
    console.log('3. Starting Go Gateway on port 8080...');
    
    // We use a temporary config
    const configPath = path.join(__dirname, 'temp-config.json');
    fs.writeFileSync(configPath, JSON.stringify({
      port: '8080',
      api_key: 'static-fallback-key',
      models: {
        'mini-perplexity': 'http://localhost:9876'
      }
    }), 'utf8');

    gatewayProc = spawn('go', ['run', 'cmd/gateway/main.go'], {
      cwd: path.join(__dirname, '../backend-gateway'),
      env: {
        ...process.env,
        SUPABASE_URL: sbUrl,
        SUPABASE_KEY: sbKey,
        CONFIG_PATH: configPath,
        PORT: '8080'
      }
    });

    gatewayProc.stdout.on('data', (data) => {
      // console.log(`[Gateway STDOUT] ${data}`);
    });

    gatewayProc.stderr.on('data', (data) => {
      // console.log(`[Gateway STDERR] ${data}`);
    });

    // Check health
    const interval = setInterval(async () => {
      try {
        const res = await fetch('http://localhost:8080/health');
        if (res.status === 200) {
          clearInterval(interval);
          fs.unlinkSync(configPath);
          console.log('✓ Go Gateway started and healthy.');
          resolve();
        }
      } catch (e) {}
    }, 500);

    setTimeout(() => {
      clearInterval(interval);
      reject(new Error('Gateway failed to start'));
    }, 10000);
  });
}

async function testQuery() {
  console.log('\n4. Sending request "hi" to local gateway using test API key...');
  const res = await fetch('http://localhost:8080/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${testApiKey}`
    },
    body: JSON.stringify({
      model: 'mini-perplexity',
      messages: [{ role: 'user', content: 'hi' }]
    })
  });

  console.log(`Response Status: ${res.status}`);
  const data = await res.json();
  console.log('Response Body:', JSON.stringify(data, null, 2));

  // Verify deletion cleanup in Supabase
  await new Promise(r => setTimeout(r, 2000));
  const cleanRes = await fetch(`${sbUrl}/rest/v1/messages?conversation_id=eq.${testConvId}&select=*`, {
    headers
  });
  const msgsLeft = await cleanRes.json();
  console.log(`\nMessages remaining in Supabase for this conversation: ${msgsLeft.length} (Expected: 0)`);
  if (msgsLeft.length === 0) {
    console.log('✓ Success: Database cleaned up successfully.');
  } else {
    console.log('✗ Failure: Messages were not cleaned up.');
  }
}

async function main() {
  try {
    await setupTestKey();
    startMockElectronAgent();
    await startGateway();
    await testQuery();
  } catch (e) {
    console.error('Test error:', e);
  } finally {
    clearInterval(mockAgentInterval);
    if (gatewayProc) gatewayProc.kill();
    await cleanupTestKey();
  }
}

main();
