// =========================================================================
// set-multiconv-keys.js
//
// Marks the existing per-provider gateway keys as MULTI-CONVERSATION by
// setting metadata.conversation_id = "*". A multi-conversation key lets a
// single shared key (e.g. the website's chatbot key) serve unlimited users,
// each with their own conversation_id, without the gateway's 403 binding.
//
// By default it updates the `chatgpt` and `kimi` keys (chatbot + repo analyser).
//
// Usage:  node set-multiconv-keys.js [provider ...]
//         node set-multiconv-keys.js            # -> chatgpt kimi
//         node set-multiconv-keys.js chatgpt    # -> just chatgpt
// =========================================================================

const fs = require('fs');
const path = require('path');

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

const headers = {
  'apikey': sbKey,
  'Authorization': `Bearer ${sbKey}`,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

const providers = process.argv.slice(2).length ? process.argv.slice(2) : ['chatgpt', 'kimi'];

async function setMulti(provider) {
  // Fetch the key row for this provider (owner_id = provider, title = API_KEY).
  const getRes = await fetch(
    `${sbUrl}/rest/v1/conversations?owner_id=eq.${encodeURIComponent(provider)}&title=eq.API_KEY&select=*`,
    { headers }
  );
  if (!getRes.ok) throw new Error(`fetch ${provider}: ${await getRes.text()}`);
  const rows = await getRes.json();
  if (!rows.length) {
    console.log(`• ${provider.padEnd(10)} SKIP (no key found — run generate-provider-keys.js first)`);
    return;
  }

  const row = rows[0];
  const metadata = { ...row.metadata, conversation_id: '*' };

  const patchRes = await fetch(
    `${sbUrl}/rest/v1/conversations?id=eq.${encodeURIComponent(row.id)}`,
    { method: 'PATCH', headers, body: JSON.stringify({ metadata }) }
  );
  if (!patchRes.ok) throw new Error(`patch ${provider}: ${await patchRes.text()}`);

  const masked = row.id.substring(0, 11) + '...' + row.id.slice(-4);
  console.log(`• ${provider.padEnd(10)} OK  conversation_id="*"  (${masked})`);
}

(async () => {
  console.log('=== Marking keys multi-conversation (conversation_id="*") ===');
  for (const p of providers) {
    try { await setMulti(p); } catch (e) { console.error(`• ${p.padEnd(10)} FAIL: ${e.message}`); process.exitCode = 1; }
  }
  console.log('Done.');
})();
