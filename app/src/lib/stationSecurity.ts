export interface StationCredentials {
  username: string;
  password: string;
}

export interface ParsedStationAddress {
  origin: string;
  authorization: string | null;
  credentials: StationCredentials | null;
}

// Standard base64 over UTF-8 bytes. Hermes does not consistently expose btoa,
// and its latin1-only contract is wrong for URL-decoded Unicode credentials.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64(input: string): string {
  const bytes: number[] = [];
  for (let i = 0; i < input.length; i++) {
    let c = input.charCodeAt(i);
    if (c < 0x80) bytes.push(c);
    else if (c < 0x800) bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < input.length) {
      const lo = input.charCodeAt(++i);
      c = 0x10000 + ((c & 0x3ff) << 10) + (lo & 0x3ff);
      bytes.push(
        0xf0 | (c >> 18),
        0x80 | ((c >> 12) & 0x3f),
        0x80 | ((c >> 6) & 0x3f),
        0x80 | (c & 0x3f),
      );
    } else {
      bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
    }
  }
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]!;
    const b1 = bytes[i + 1];
    const b2 = bytes[i + 2];
    out += B64[b0 >> 2];
    out += B64[((b0 & 3) << 4) | (b1 === undefined ? 0 : b1 >> 4)];
    out += b1 === undefined ? '=' : B64[((b1 & 15) << 2) | (b2 === undefined ? 0 : b2 >> 6)];
    out += b2 === undefined ? '=' : B64[b2 & 63];
  }
  return out;
}

function decoded(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/** Parse a station address into its public identity and optional secret.
 *  Identity is always an HTTP(S) origin: no userinfo, path, query, or hash. */
export function parseStationAddress(raw: string): ParsedStationAddress {
  let input = String(raw || '').trim();
  if (!input) return { origin: '', authorization: null, credentials: null };
  if (!/^https?:\/\//i.test(input)) input = `https://${input}`;
  try {
    const url = new URL(input);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { origin: '', authorization: null, credentials: null };
    }
    const hasCredentials = !!(url.username || url.password);
    const credentials = hasCredentials
      ? { username: decoded(url.username), password: decoded(url.password) }
      : null;
    return {
      origin: url.origin,
      authorization: credentials
        ? `Basic ${base64(`${credentials.username}:${credentials.password}`)}`
        : null,
      credentials,
    };
  } catch {
    return { origin: '', authorization: null, credentials: null };
  }
}

export function normalizeStationOrigin(raw: string): string {
  return parseStationAddress(raw).origin;
}

/** Valid SecureStore key deterministically owned by one sanitized origin. */
export function secureKeyForOrigin(rawOrigin: string): string {
  const origin = normalizeStationOrigin(rawOrigin);
  const encoded = base64(origin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  return `subwave.station.auth.v1.${encoded}`;
}

/** Replace generated URL-like labels with a public host while preserving real
 *  operator names. This also cleans legacy names derived from userinfo URLs. */
export function safeStationLabel(name: unknown, rawUrl: string): string {
  const parsed = parseStationAddress(rawUrl);
  if (!parsed.origin) return '';
  const fallback = new URL(parsed.origin).host;
  const label = String(name ?? '').trim();
  if (!label) return fallback;
  if (
    parsed.credentials
    && (
      label.includes('@')
      || label.includes(parsed.credentials.username)
      || (!!parsed.credentials.password && label.includes(parsed.credentials.password))
    )
  ) {
    return fallback;
  }
  return sanitizeDiagnostic(label);
}

/** Scrub credential-bearing URLs and authorization values before UI/log use. */
export function sanitizeDiagnostic(value: unknown): string {
  let text = String(value ?? '');
  text = text.replace(/\b(?:Basic|Bearer)\s+[A-Za-z0-9._~+/=-]+/gi, (match) => {
    const scheme = match.slice(0, match.indexOf(' '));
    return `${scheme} [redacted]`;
  });
  text = text.replace(/https?:\/\/[^\s"'<>]+/gi, (candidate) => {
    const trailing = candidate.match(/[),.;!?]+$/)?.[0] || '';
    const core = trailing ? candidate.slice(0, -trailing.length) : candidate;
    try {
      const url = new URL(core);
      return `${url.origin}${url.pathname === '/' ? '' : url.pathname}${trailing}`;
    } catch {
      return core.replace(/^(https?:\/\/)[^/@\s]+@/i, '$1') + trailing;
    }
  });
  return text.replace(/\b[^/\s:@]+:[^/\s@]+@([a-z0-9.-]+(?::\d+)?)/gi, '$1');
}
