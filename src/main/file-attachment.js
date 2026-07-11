'use strict';

const fs = require('fs');
const path = require('path');

/**
 * File Attachment
 * ---------------------------------------------------------------------------
 * Turns a list of picked file paths into structured, prompt-ready descriptors.
 *
 *   parseFiles(paths) -> Promise<Array<{
 *     name, path, kind: 'text'|'image'|'pdf'|'docx'|'binary',
 *     inlineText?: string,        // for text/pdf/docx (capped + maybe truncated)
 *     imageBase64?: string,       // data URL for images (vision path)
 *     note?: string,              // for binary / failed reads
 *     truncated: boolean, charCount: number
 *   }>>
 *
 * PDF (pdf-parse) and .docx (mammoth) parsers are lazy-required inside a
 * try/catch so the app still boots and other file types still work even if
 * those optional dependencies are not installed.
 */

const INLINE_CHAR_CAP = 20000;   // per-file inline text cap
const TOTAL_CHAR_CAP = 48000;    // overall budget enforced by prompt-composer

const TEXT_EXT = new Set([
  '.txt', '.md', '.markdown', '.json', '.csv', '.tsv', '.xml', '.yaml', '.yml',
  '.toml', '.ini', '.cfg', '.conf', '.env', '.log', '.sql',
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs', '.py', '.java', '.c', '.cc',
  '.cpp', '.h', '.hpp', '.cs', '.go', '.rs', '.rb', '.php', '.swift', '.kt',
  '.r', '.m', '.lua', '.pl', '.sh', '.bat', '.ps1', '.html', '.htm', '.css',
  '.scss', '.sass', '.less', '.vue', '.svelte', '.gradle', '.properties',
]);
const IMAGE_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp']);
const MAX_TEXT_BYTES = 5 * 1024 * 1024;   // don't slurp huge files into memory
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;

function imageMime(ext) {
  switch (ext) {
    case '.jpg':
    case '.jpeg': return 'image/jpeg';
    case '.gif': return 'image/gif';
    case '.webp': return 'image/webp';
    case '.bmp': return 'image/bmp';
    default: return 'image/png';
  }
}

function depNote(label, pkg, err) {
  if (err && err.code === 'MODULE_NOT_FOUND') {
    return `${label} detected but the "${pkg}" package is not installed. Run: npm install ${pkg}`;
  }
  return `${label} detected but could not be read (${err.message}).`;
}

function truncate(text) {
  const str = String(text || '');
  if (str.length <= INLINE_CHAR_CAP) {
    return { text: str, truncated: false };
  }
  const cut = str.slice(0, INLINE_CHAR_CAP);
  return {
    text: `${cut}\n…[truncated — ${str.length - INLINE_CHAR_CAP} more characters omitted]`,
    truncated: true,
  };
}

async function parseOne(filePath) {
  const name = path.basename(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const base = { name, path: filePath, truncated: false, charCount: 0 };

  let stat;
  try {
    stat = fs.statSync(filePath);
  } catch (err) {
    return { ...base, kind: 'binary', note: `Could not read file (${err.code || err.message}).` };
  }

  try {
    // ── Plain text / code ────────────────────────────────────────────────
    if (TEXT_EXT.has(ext)) {
      if (stat.size > MAX_TEXT_BYTES) {
        return { ...base, kind: 'binary', note: `Text file too large (${Math.round(stat.size / 1024)} KB) to inline.` };
      }
      const raw = fs.readFileSync(filePath, 'utf8');
      const { text, truncated } = truncate(raw);
      return { ...base, kind: 'text', inlineText: text, truncated, charCount: text.length };
    }

    // ── Images → base64 data URL (handled by the vision path) ────────────
    if (IMAGE_EXT.has(ext)) {
      if (stat.size > MAX_IMAGE_BYTES) {
        return { ...base, kind: 'binary', note: `Image too large (${Math.round(stat.size / 1024)} KB) to attach.` };
      }
      const b64 = fs.readFileSync(filePath).toString('base64');
      return { ...base, kind: 'image', imageBase64: `data:${imageMime(ext)};base64,${b64}` };
    }

    // ── PDF (optional dependency) ────────────────────────────────────────
    if (ext === '.pdf') {
      try {
        const pdfParse = require('pdf-parse');
        const data = await pdfParse(fs.readFileSync(filePath));
        const { text, truncated } = truncate(data.text);
        return { ...base, kind: 'pdf', inlineText: text, truncated, charCount: text.length };
      } catch (err) {
        return { ...base, kind: 'binary', note: depNote('PDF', 'pdf-parse', err) };
      }
    }

    // ── Word .docx (optional dependency) ─────────────────────────────────
    if (ext === '.docx') {
      try {
        const mammoth = require('mammoth');
        const result = await mammoth.extractRawText({ path: filePath });
        const { text, truncated } = truncate(result.value);
        return { ...base, kind: 'docx', inlineText: text, truncated, charCount: text.length };
      } catch (err) {
        return { ...base, kind: 'binary', note: depNote('Word document', 'mammoth', err) };
      }
    }

    // ── Anything else → metadata note only ───────────────────────────────
    return { ...base, kind: 'binary', note: `Binary/unsupported file (${ext || 'no extension'}, ${Math.round(stat.size / 1024)} KB) — contents not included.` };
  } catch (err) {
    return { ...base, kind: 'binary', note: `Failed to parse file: ${err.message}` };
  }
}

async function parseFiles(filePaths) {
  if (!Array.isArray(filePaths) || filePaths.length === 0) return [];
  return Promise.all(filePaths.map(parseOne));
}

module.exports = { parseFiles, INLINE_CHAR_CAP, TOTAL_CHAR_CAP, TEXT_EXT, IMAGE_EXT };
