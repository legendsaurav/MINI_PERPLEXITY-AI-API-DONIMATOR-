// =========================================================================
// generate-provider-keys.js
//
// Provisions one persistent gateway API key (sk_copilot_...) per browser
// provider in remote Supabase, mirroring the exact insert shape used by the
// Electron Settings UI (src/main/ipc-manager.js -> "generate-api-key").
//
// Each key:
//   - owner_id / username = the provider name (per-provider authorized login)
//   - password_hash       = sha256(KEY_PASSWORD)  (shared password)
//   - available_models    = [<provider>]          (scoped to that provider)
//   - conversation_id     = conv_<provider>_<rand>
//   - status              = active
//
// Idempotent: a provider that already has a title=API_KEY row is skipped
// unless --force is passed (which rotates it: delete old, insert new).
//
// Plaintext keys are written to gitignored provider-keys.local.json so they
// can be used as bearer tokens and consumed by test-provider-keys.js.
//
// Usage:
//   KEY_PASSWORD=yourpass node generate-provider-keys.js [--force]
//   (if KEY_PASSWORD unset, a strong password is generated and printed once)
// =========================================================================

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PROVIDERS = ['chatgpt', 'gemini', 'claude', 'kimi', 'deepseek', 'perplexity', 'google'];
const KEYS_FILE = path.join(__dirname, 'provider-keys.local.json');
const FORCE = process.argv.includes('--force');

// --- .env reader (same approach as test-api-key-bot.js) ------------------
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

const supabaseHeaders = {
  'apikey': sbKey,
  'Authorization': `Bearer ${sbKey}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

// Shared password: env var, or generate + print once.
let password = process.env.KEY_PASSWORD;
let generatedPassword = false;
if (!password) {
  password = 'cp_' + crypto.randomBytes(9).toString('base64url');
  generatedPassword = true;
}
const passwordHash = crypto.createHash('sha256').update(password).digest('hex');

async function existingKeyFor(provider) {
  const res = await fetch(
    `${sbUrl}/rest/v1/conversations?owner_id=eq.${encodeURIComponent(provider)}&title=eq.API_KEY&select=*`,
    { headers: supabaseHeaders }
  );
  if (!res.ok) return null;
  const rows = await res.json();
  return rows && rows.length ? rows[0] : null;
}

async function deleteRow(id) {
  await fetch(`${sbUrl}/rest/v1/conversations?id=eq.${encodeURIComponent(id)}`, {
    method: 'DELETE',
    headers: supabaseHeaders
  });
}

async function insertKey(provider) {
  const rawKey = 'sk_copilot_' + crypto.randomBytes(24).toString('hex');
  const conversationID = `conv_${provider}_` + crypto.randomBytes(6).toString('hex');
  const body = {
    id: rawKey,
    owner_id: provider,
    title: 'API_KEY',
    metadata: {
      type: 'api_key_config',
      username: provider,
      password_hash: passwordHash,
      available_models: [provider],
      conversation_id: conversationID,
      status: 'active',
      created_at: new Date().toISOString()
    }
  };
  const res = await fetch(`${sbUrl}/rest/v1/conversations`, {
    method: 'POST',
    headers: supabaseHeaders,
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to insert key for ${provider}: ${text}`);
  }
  return { key: rawKey, conversationID };
}

function mask(key) {
  return key.substring(0, 11) + '...' + key.substring(key.length - 4);
}

async function main() {
  console.log('=== Generating per-provider gateway API keys ===\n');

  // Load any previously stored plaintext keys so we don't lose ones we can't re-read.
  let store = {};
  if (fs.existsSync(KEYS_FILE)) {
    try { store = JSON.parse(fs.readFileSync(KEYS_FILE, 'utf8')); } catch (e) {}
  }

  const summary = [];

  for (const provider of PROVIDERS) {
    const existing = await existingKeyFor(provider);

    if (existing && !FORCE) {
      // Key exists in Supabase. We can't recover its plaintext from Supabase
      // (only the id, which IS the plaintext key here), so reuse existing.id.
      const convId = existing.metadata && existing.metadata.conversation_id;
      store[provider] = { key: existing.id, username: provider, conversationID: convId, status: 'reused' };
      summary.push({ provider, key: existing.id, conversationID: convId, action: 'skipped (exists)' });
      console.log(`• ${provider.padEnd(11)} exists  -> ${mask(existing.id)}  (use --force to rotate)`);
      continue;
    }

    if (existing && FORCE) {
      await deleteRow(existing.id);
    }

    const { key, conversationID } = await insertKey(provider);
    store[provider] = { key, username: provider, conversationID, status: 'active' };
    summary.push({ provider, key, conversationID, action: existing ? 'rotated' : 'created' });
    console.log(`• ${provider.padEnd(11)} ${existing ? 'rotated' : 'created'} -> ${mask(key)}`);
  }

  // Persist plaintext locally (gitignored) for use as bearer tokens / tests.
  fs.writeFileSync(KEYS_FILE, JSON.stringify(store, null, 2), 'utf8');

  console.log('\n=== Reveal login (per provider) ===');
  console.log('username = <provider name> (chatgpt, gemini, claude, kimi, deepseek, perplexity, google)');
  if (generatedPassword) {
    console.log('\n  ⚠  Generated shared password (SAVE THIS — only its hash is stored, it cannot be recovered):');
    console.log(`      KEY_PASSWORD = ${password}`);
  } else {
    console.log('  password = (the KEY_PASSWORD you provided)');
  }

  console.log(`\nPlaintext keys written to: ${KEYS_FILE} (gitignored)`);
  console.log('\nDone.');
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
