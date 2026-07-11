const assert = require('assert');
const path = require('path');
const fs = require('fs');

const scriptPath = 'C:/Users/proka/.gemini/antigravity-ide/scratch/autonomous_agent.py';
const content = fs.readFileSync(scriptPath, 'utf8');

assert(content.includes('def ensure_coding_path_exists'));
assert(content.includes('def open_path_in_vscode'));
assert(content.includes('created_path = ensure_coding_path_exists(target)'));
console.log('coding path creation regression check passed');
