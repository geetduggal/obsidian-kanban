import { Board } from 'src/components/types';
// Omit I and O to reduce ambiguity with 1 and 0.
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const alnum = 'ABCDEFGHJKLMNPQRSTUVWXYZ0123456789';

export function sanitizeCardIdPrefix(prefix?: string): string {
  const normalized = (prefix || '').trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-');
  const collapsed = normalized.replace(/-+/g, '-').replace(/^-+|-+$/g, '');
  return collapsed;
}

export function collectCardBlockIds(board?: Board, includeArchive = true): Set<string> {
  const ids = new Set<string>();
  if (!board) return ids;

  for (const lane of board.children || []) {
    for (const item of lane.children || []) {
      if (item.data.blockId) ids.add(item.data.blockId);
    }
  }

  if (includeArchive) {
    for (const item of board.data.archive || []) {
      if (item.data.blockId) ids.add(item.data.blockId);
    }
  }

  return ids;
}

function toAlphaCode(index: number): string {
  let n = index;
  let out = '';
  while (n > 0) {
    n -= 1;
    out = alphabet[n % alphabet.length] + out;
    n = Math.floor(n / alphabet.length);
  }
  return out;
}

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function generateNextCardId(prefix: string, used: Set<string>): string {
  const safePrefix = sanitizeCardIdPrefix(prefix);
  const re =
    safePrefix.length > 0
      ? new RegExp(`^${escapeRegExp(safePrefix)}-(\\d+)$`)
      : /^(\d+)$/;
  let maxNum = 0;

  for (const id of used) {
    const match = id.match(re);
    if (!match) continue;

    const num = parseInt(match[1], 10);
    if (!Number.isNaN(num) && num > maxNum) {
      maxNum = num;
    }
  }

  let next = maxNum + 1;
  let candidate = safePrefix.length > 0 ? `${safePrefix}-${next}` : `${next}`;
  while (used.has(candidate)) {
    next += 1;
    candidate = safePrefix.length > 0 ? `${safePrefix}-${next}` : `${next}`;
  }

  return candidate;
}

function randomCode(chars: string, length: number): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function getCodeFromId(id: string, prefix: string): string | null {
  if (prefix.length > 0) {
    const pre = `${prefix}-`;
    if (!id.startsWith(pre)) return null;
    return id.slice(pre.length);
  }

  return id;
}

function countIdsInRandomNamespace(used: Set<string>, prefix: string, chars: string): number {
  const allowed = new Set(chars.split(''));
  let count = 0;

  for (const id of used) {
    const code = getCodeFromId(id, prefix);
    if (!code || code.length < 1) continue;

    let valid = true;
    for (let i = 0; i < code.length; i++) {
      if (!allowed.has(code[i])) {
        valid = false;
        break;
      }
    }

    if (valid) count += 1;
  }

  return count;
}

function minLengthForCapacity(base: number, requiredCount: number, minLength: number): number {
  let length = Math.max(2, Math.min(8, minLength));
  while (length < 8 && Math.pow(base, length) <= requiredCount) {
    length += 1;
  }
  return length;
}

export type CardIdGenerationMode =
  | 'sequential-number'
  | 'sequential-alpha'
  | 'random-alpha'
  | 'random-alphanumeric';

export function generateCardId(
  mode: CardIdGenerationMode,
  used: Set<string>,
  opts?: { prefix?: string; length?: number }
): string {
  const prefix = sanitizeCardIdPrefix(opts?.prefix || '');
  const minLen = Math.max(2, Math.min(8, opts?.length || 2));
  const safeMode = mode || 'sequential-alpha';

  if (safeMode === 'sequential-number') {
    return generateNextCardId(prefix, used);
  }

  if (safeMode === 'sequential-alpha') {
    let i = 1;
    while (i < 1000000) {
      const code = toAlphaCode(i);
      const id = prefix.length > 0 ? `${prefix}-${code}` : code;
      if (!used.has(id)) return id;
      i += 1;
    }
  }

  const chars = safeMode === 'random-alpha' ? alphabet : alnum;
  const namespaceCount = countIdsInRandomNamespace(used, prefix, chars);
  const startLen = minLengthForCapacity(chars.length, namespaceCount + 1, minLen);

  for (let len = startLen; len <= 8; len++) {
    const capacity = Math.pow(chars.length, len);
    const attempts = Math.min(20000, Math.max(500, Math.floor(capacity * 0.2)));

    for (let i = 0; i < attempts; i++) {
      const code = randomCode(chars, len);
      const id = prefix.length > 0 ? `${prefix}-${code}` : code;
      if (!used.has(id)) return id;
    }
  }

  // Last-resort deterministic fallback.
  return generateNextCardId(prefix, used);
}

export function displayCardId(rawId?: string): string {
  if (!rawId) return '';
  // Hide common textual prefix automatically, e.g. tb-ABC -> ABC
  const match = rawId.match(/^[a-z]{1,4}-(.+)$/i);
  if (match?.[1]) return match[1];
  return rawId;
}
