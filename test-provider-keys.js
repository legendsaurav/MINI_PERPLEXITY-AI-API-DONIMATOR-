// =========================================================================
// test-provider-keys.js
//
// End-to-end test of each per-provider gateway API key produced by
// generate-provider-keys.js. Extends the harness pattern of test-api-key-bot.js.
//
// For each provider it boots:
//   - a mock downstream "LLM" on :9876 (the port the real app bridge uses),
//     echoing `Mock response for model <model>`
//   - the Go gateway on :8080 with a temp config routing every provider -> :9876
//
// Then, per provider key, it asserts:
//   1. model=<provider>            -> 200 + correct routed content   (key works)
//   2. model=<other provider>      -> 403 Forbidden                  (per-key scoping)
//   3. user+assistant messages persisted under the key conversation_id in Supabase
//
// Test messages/conversations are cleaned up afterwards; the keys are kept.
//
// Usage: node test-provider-keys.js
// =========================================================================

const fs = require('fs');
const path = require('path');
const http = require('http');
const { spawn } = require('child_process');

const PROVIDERS = ['chatgpt', 'gemini', 'claude', 'kimi', 'deepseek', 'perplexity', 'google'];
const KEYS_FILE = path.join(__dirname, 'provider-keys.local.json');
const MOCK_PORT = 9876;
const GATEWAY_PORT = 8080;

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
  } catch (e) {}
  return null;
};

const sbUrl = getEnvVar('SUPABASE_URL');
const sbKey = getEnvVar('SUPABASE_KEY');
if (!sbUrl || !sbKey) {
  console.error('Error: SUPABASE_URL and SUPABASE_KEY are required in .env');
  process.exit(1);
}

const supabaseHeaders = {
  'apikey': sbKey,
  'Authorization': `Bearer ${sbKey}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

if (!fs.existsSync(KEYS_FILE)) {
  console.error(`Error: ${KEYS_FILE} not found. Run: node generate-provider-keys.js`);
  process.exit(1);
}
const keys = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8'));

// --- Mock downstream LLM on :9876 (mirrors test-api-key-bot.js) -----------
let mockServer;
function startMockServer() {
  return new Promise((resolve, reject) => {
    mockServer = http.createServer((req, res) => {
      if ((req.url === '/chat/completions' || req.url === '/v1/chat/completions') && req.method === 'POST') {
        let body = '';
        req.on('data', (c) => { body += c; });
        req.on('end', () => {
          let model = 'unknown';
          try { model = JSON.parse(body).model; } catch (e) {}
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({
            choices: [{ message: { role: 'assistant', content: `Mock response for model ${model}` } }],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
          }));
        });
      } else {
        res.writeHead(404); res.end();
      }
    });
    mockServer.on('error', reject);
    mockServer.listen(MOCK_PORT, () => {
      console.log(`Mock downstream server listening on :${MOCK_PORT}`);
      resolve();
    });
  });
}

// --- Temp gateway config: every provider -> mock --------------------------
const configPath = path.join(__dirname, 'test-config.json');
function writeTestConfig() {
  const models = { default: `http://localhost:${MOCK_PORT}` };
  for (const p of PROVIDERS) models[p] = `http://localhost:${MOCK_PORT}`;
  const config = { port: String(GATEWAY_PORT), api_key: 'static-fallback-key', models };
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2), 'utf8');
  console.log('Wrote temporary test-config.json');
}

// --- Boot Go gateway ------------------------------------------------------
let gatewayProc;
function startGateway() {
  return new Promise((resolve, reject) => {
    const gwDir = path.join(__dirname, 'backend-gateway');
    const exe = path.join(gwDir, process.platform === 'win32' ? 'gateway.exe' : 'gateway');
    // Prefer the prebuilt binary (fast); fall back to `go run` if it's missing.
    const useExe = fs.existsSync(exe);
    console.log(`Starting backend-gateway Go server (${useExe ? 'prebuilt binary' : 'go run'})...`);
    const cmd = useExe ? exe : 'go';
    const cmdArgs = useExe ? [] : ['run', 'cmd/gateway/main.go'];
    gatewayProc = spawn(cmd, cmdArgs, {
      cwd: gwDir,
      env: { ...process.env, SUPABASE_URL: sbUrl, SUPABASE_KEY: sbKey, CONFIG_PATH: configPath, PORT: String(GATEWAY_PORT) }
    });
    gatewayProc.stdout.on('data', (d) => console.log(`[Gateway] ${d.toString().trim()}`));
    gatewayProc.stderr.on('data', (d) => console.log(`[Gateway] ${d.toString().trim()}`));
    gatewayProc.on('error', reject);

    const interval = setInterval(async () => {
      try {
        const res = await fetch(`http://localhost:${GATEWAY_PORT}/health`);
        if (res.status === 200) { clearInterval(interval); console.log('Gateway healthy.'); resolve(); }
      } catch (e) {}
    }, 500);
    setTimeout(() => { clearInterval(interval); reject(new Error('Gateway failed to start in 30s.')); }, 30000);
  });
}

async function callGateway(authKey, model, messages, conversationID) {
  const body = { model, messages };
  if (conversationID !== undefined) body.conversation_id = conversationID;
  const headers = { 'Content-Type': 'application/json' };
  if (authKey) headers['Authorization'] = `Bearer ${authKey}`;
  const res = await fetch(`http://localhost:${GATEWAY_PORT}/v1/chat/completions`, {
    method: 'POST', headers, body: JSON.stringify(body)
  });
  let text = '';
  try { text = await res.text(); } catch (e) {}
  return { status: res.status, text };
}

async function getSupabaseMessages(convId) {
  const res = await fetch(`${sbUrl}/rest/v1/messages?conversation_id=eq.${encodeURIComponent(convId)}&select=*`, { headers: supabaseHeaders });
  return res.ok ? res.json() : [];
}

async function cleanupTestMessages(convIds) {
  if (!convIds.length) return;
  const q = `conversation_id=in.(${convIds.join(',')})`;
  await fetch(`${sbUrl}/rest/v1/messages?${q}`, { method: 'DELETE', headers: supabaseHeaders }).catch(() => {});
  // The gateway auto-creates a conversation row for the key's conversation_id;
  // that row IS the key config for provider keys, so we must NOT delete it.
  // We only remove messages we generated during the test.
}

async function runTests() {
  const results = [];
  const touchedConvs = [];

  for (const provider of PROVIDERS) {
    const entry = keys[provider];
    const row = { provider, works: false, scoped: false, persisted: false, note: '' };

    if (!entry || !entry.key) {
      row.note = 'no key in provider-keys.local.json';
      results.push(row);
      continue;
    }
    const { key, conversationID } = entry;
    if (conversationID) touchedConvs.push(conversationID);

    // 1. Correct model -> 200 + routed content
    try {
      const res = await callGateway(key, provider, [{ role: 'user', content: `ping ${provider}` }]);
      if (res.status === 200) {
        let content = '';
        try { content = JSON.parse(res.text).content || ''; } catch (e) {}
        if (content.includes(`Mock response for model ${provider}`)) {
          row.works = true;
        } else {
          row.note = `200 but unexpected content: ${res.text.slice(0, 120)}`;
        }
      } else {
        row.note = `expected 200, got ${res.status}: ${res.text.slice(0, 120)}`;
      }
    } catch (e) {
      row.note = `request error: ${e.message}`;
    }

    // 2. Different provider's model on same key -> 403 (scoping)
    try {
      const other = provider === 'chatgpt' ? 'gemini' : 'chatgpt';
      const res = await callGateway(key, other, [{ role: 'user', content: 'scope check' }]);
      row.scoped = res.status === 403;
      if (!row.scoped && !row.note) row.note = `scope: expected 403 for '${other}', got ${res.status}`;
    } catch (e) {
      if (!row.note) row.note = `scope request error: ${e.message}`;
    }

    // 3. Messages persisted under the key conversation_id
    try {
      await new Promise((r) => setTimeout(r, 800));
      const msgs = await getSupabaseMessages(conversationID);
      const u = msgs.find((m) => m.role === 'user' && m.content === `ping ${provider}`);
      const a = msgs.find((m) => m.role === 'assistant');
      row.persisted = !!(u && a);
      if (!row.persisted && !row.note) row.note = 'messages not found in Supabase';
    } catch (e) {
      if (!row.note) row.note = `db check error: ${e.message}`;
    }

    results.push(row);
  }

  await cleanupTestMessages(touchedConvs);

  // Report
  console.log('\n================ Per-Provider Key Results ================');
  console.log('provider     | works | scoped(403) | persisted | note');
  console.log('-------------+-------+-------------+-----------+---------------------------');
  let allPass = true;
  for (const r of results) {
    const pass = r.works && r.scoped && r.persisted;
    if (!pass) allPass = false;
    const mark = (b) => (b ? '  ✅  ' : '  ❌  ');
    console.log(
      `${r.provider.padEnd(12)} |${mark(r.works)}|${mark(r.scoped).padEnd(13)}|${mark(r.persisted).padEnd(11)}| ${r.note}`
    );
  }
  console.log('==========================================================');
  if (allPass) {
    console.log('\n🎉 ALL PROVIDER KEYS WORK (auth + routing + scoping + persistence).');
  } else {
    console.error('\n❌ Some provider keys failed — see notes above.');
    process.exitCode = 1;
  }
}

async function main() {
  try {
    await startMockServer();
    writeTestConfig();
    await startGateway();
    await runTests();
  } catch (err) {
    console.error('Critical test runner error:', err);
    process.exitCode = 1;
  } finally {
    console.log('\nCleaning up processes...');
    if (gatewayProc) { try { gatewayProc.kill(); } catch (e) {} }
    if (mockServer) { try { mockServer.close(); } catch (e) {} }
    try { if (fs.existsSync(configPath)) fs.unlinkSync(configPath); } catch (e) {}
  }
}

main();
