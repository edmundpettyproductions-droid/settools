// Typed wrapper around the Supabase claude-proxy Edge Function.
// Used for any client-side AI extraction (Cast Bible today; can be reused
// for in-Svelte call sheet / DOOD / script extraction when we port those).

const SUPABASE_URL = 'https://qywzcaghcyueegxnkhjj.supabase.co';
const SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF5d3pjYWdoY3l1ZWVneG5raGpqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzg0ODA2MTAsImV4cCI6MjA5NDA1NjYxMH0.is6qHpLiDI-fi2z30bjs4LReBFvWLB3yPoo4XypTLsA';
const PROXY_URL = `${SUPABASE_URL}/functions/v1/claude-proxy`;

const MAX_TOKENS = 16000;
const DEFAULT_MODEL = 'claude-sonnet-4-6';

export interface ExtractOpts {
  /** Override the model. Default: claude-sonnet-4-6. */
  model?: string;
  /** Optional system prompt. */
  system?: string;
  /** Max tokens for response. Default 16000, hard-capped at 32000 by the proxy. */
  maxTokens?: number;
  /** Anthropic beta flags (e.g. "pdfs-2024-09-25"). Auto-added for PDFs. */
  beta?: string;
}

/** Read a File as a base64 string (the part after the data: prefix). */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = r.result as string;
      const idx = result.indexOf(',');
      resolve(idx >= 0 ? result.slice(idx + 1) : result);
    };
    r.onerror = () => reject(new Error('Failed to read file'));
    r.readAsDataURL(file);
  });
}

/** Read a File as UTF-8 text. */
export function fileToText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(new Error('Failed to read file'));
    r.readAsText(file);
  });
}

/** Minimal subset of the SheetJS API we use. */
interface SheetJsLib {
  read: (data: ArrayBuffer, opts: { type: 'array' }) => SheetJsBook;
  utils: {
    sheet_to_csv: (sheet: unknown, opts?: { FS?: string; RS?: string; blankrows?: boolean }) => string;
  };
}
interface SheetJsBook { SheetNames: string[]; Sheets: Record<string, unknown> }

let xlsxLib: SheetJsLib | null = null;

/** Lazy-load SheetJS from CDN. Only invoked when user uploads an XLSX. */
async function loadSheetJs(): Promise<SheetJsLib> {
  if (xlsxLib) return xlsxLib;
  if ((window as unknown as { XLSX?: SheetJsLib }).XLSX) {
    xlsxLib = (window as unknown as { XLSX: SheetJsLib }).XLSX;
    return xlsxLib;
  }
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load SheetJS CDN'));
    document.head.appendChild(s);
  });
  const w = window as unknown as { XLSX?: SheetJsLib };
  if (!w.XLSX) throw new Error('SheetJS loaded but window.XLSX missing');
  xlsxLib = w.XLSX;
  return xlsxLib;
}

/** Read an XLSX/XLSM/XLS file and return all sheets concatenated as labeled CSV.
 *  Format: "## Sheet: NAME\n<csv>\n\n## Sheet: NAME2\n..."  — Claude can read this
 *  shape easily and understands tab boundaries.
 */
export async function xlsxToText(file: File): Promise<string> {
  const XLSX = await loadSheetJs();
  const buf = await file.arrayBuffer();
  const book = XLSX.read(buf, { type: 'array' });
  const parts: string[] = [];
  for (const name of book.SheetNames) {
    const sheet = book.Sheets[name];
    if (!sheet) continue;
    const csv = XLSX.utils.sheet_to_csv(sheet, { blankrows: false });
    parts.push(`## Sheet: ${name}\n${csv.trim()}`);
  }
  return parts.join('\n\n');
}

interface ProxyResponse {
  content?: Array<{ type?: string; text?: string }>;
  error?: { message?: string; type?: string };
}

async function callProxy(body: Record<string, unknown>): Promise<string> {
  let resp: Response;
  try {
    resp = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify(body),
    });
  } catch (e) {
    throw new Error(`Network error reaching proxy: ${e instanceof Error ? e.message : String(e)}`);
  }
  const text = await resp.text();
  if (!resp.ok) {
    throw new Error(`Proxy HTTP ${resp.status}: ${text.slice(0, 300)}`);
  }
  let json: ProxyResponse;
  try { json = JSON.parse(text) as ProxyResponse; }
  catch { throw new Error(`Proxy returned non-JSON: ${text.slice(0, 200)}`); }
  if (json.error) throw new Error(`Anthropic: ${json.error.message ?? json.error.type ?? 'unknown'}`);
  const parts = (json.content ?? []).map((b) => b.text ?? '').filter(Boolean);
  if (!parts.length) throw new Error('Anthropic returned an empty response');
  return parts.join('');
}

/** Extract structured data from a PDF file via Claude. Returns raw response text. */
export async function extractFromPdf(pdfBase64: string, prompt: string, opts: ExtractOpts = {}): Promise<string> {
  return callProxy({
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? MAX_TOKENS,
    system: opts.system,
    beta: opts.beta ?? 'pdfs-2024-09-25',
    messages: [
      {
        role: 'user',
        content: [
          { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 } },
          { type: 'text', text: prompt },
        ],
      },
    ],
  });
}

/** Extract structured data from text input via Claude. Returns raw response text. */
export async function extractFromText(content: string, prompt: string, opts: ExtractOpts = {}): Promise<string> {
  return callProxy({
    model: opts.model ?? DEFAULT_MODEL,
    max_tokens: opts.maxTokens ?? MAX_TOKENS,
    system: opts.system,
    messages: [
      { role: 'user', content: `${prompt}\n\n---SOURCE---\n${content}` },
    ],
  });
}

/** Strip Markdown code fences from a Claude response and try to JSON.parse.
 *  Falls back to extracting the first balanced { ... } block.
 */
export function parseJsonResponse<T>(raw: string): T {
  const cleaned = raw.replace(/^```[a-z]*\n?/i, '').replace(/```\s*$/i, '').trim();
  try { return JSON.parse(cleaned) as T; } catch { /* fall through */ }
  // Find the first { ... } block, balancing braces.
  const start = cleaned.indexOf('{');
  if (start === -1) throw new Error('No JSON object found in response');
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) {
        const candidate = cleaned.slice(start, i + 1);
        return JSON.parse(candidate) as T;
      }
    }
  }
  throw new Error('Unterminated JSON object in response');
}
