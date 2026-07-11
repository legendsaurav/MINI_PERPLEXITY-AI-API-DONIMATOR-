const assert = require('assert');
const fs = require('fs');
const path = require('path');

const scriptPath = 'C:/Users/proka/.gemini/antigravity-ide/scratch/autonomous_agent.py';
const source = fs.readFileSync(scriptPath, 'utf8');

assert(/new tab/i.test(source), 'Expected agent prompt guidance to mention new tab handling');
assert(/search/i.test(source), 'Expected agent prompt guidance to mention search behavior');
assert(/visual studio code|vs code/i.test(source), 'Expected agent prompt guidance to mention VS Code handling');
assert(/new file/i.test(source), 'Expected agent prompt guidance to mention new file handling');
assert(/reuse the existing vs code window/i.test(source), 'Expected agent prompt guidance to prefer reusing the existing VS Code window');
assert(/subfolder/i.test(source), 'Expected agent prompt guidance to mention nested folder handling');
assert(/src\/login\.html/i.test(source), 'Expected agent prompt guidance to mention nested file paths');
assert(/focus_existing_window_by_name/i.test(source), 'Expected executor logic to reuse existing app windows');
assert(/looks_like_coding_task/i.test(source), 'Expected executor logic to detect coding tasks');
assert(/ctrl\+n/i.test(source), 'Expected executor logic to use a fallback keyboard shortcut for new files');
assert(/output only step tags/i.test(source), 'Expected agent prompt guidance to require tag-only output');
assert(/do not say things like/i.test(source), 'Expected agent prompt guidance to forbid prose commentary');
console.log('agent prompt guidance check passed');
