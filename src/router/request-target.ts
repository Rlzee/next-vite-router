/**
 * URL normalization shared by routing and SSR. This module deliberately has
 * no router dependency so the SSR entry can run in a router-only worker.
 */
const ORIGIN = "http://next-vite-router.invalid/";
const AUTHORITY = /^https?:\/\/[^/?#]*/i;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const SINGLE_DOT = /^(?:\.|%2e)$/i;
const DOUBLE_DOT = /^(?:\.\.|%2e\.|\.%2e|%2e%2e)$/i;

function isAbsoluteForm(url: string): boolean {
  const host = /^https?:\/\/([^/?#]*)/i.exec(url);
  return !!host && host[1] !== "";
}

function isUndecodable(path: string): boolean {
  if (!path.includes("%")) return false;
  try {
    decodeURIComponent(path);
    return false;
  } catch {
    return true;
  }
}

function resolveByHand(path: string): string {
  // Keep one or two leading slashes outside the stack: `//host/../../x`
  // remains a path beginning with two slashes, not a different authority.
  const prefix = /^\/{1,2}/.exec(path)?.[0] ?? "";
  const kept: string[] = [];
  let endsOnDot = false;
  for (const segment of path.slice(prefix.length).split("/")) {
    // URL dot segments include their encoded forms; preserve every other
    // escape byte-for-byte, including malformed UTF-8 sequences.
    if (SINGLE_DOT.test(segment)) {
      endsOnDot = true;
      continue;
    }
    if (DOUBLE_DOT.test(segment)) {
      if (kept.length > 0) kept.pop();
      endsOnDot = true;
      continue;
    }
    endsOnDot = false;
    kept.push(segment);
  }
  const lead = prefix === "" ? "/" : prefix;
  const body = kept.join("/");
  const resolved = body === "" ? lead : `${lead}${body}`;
  return endsOnDot && !resolved.endsWith("/") ? `${resolved}/` : resolved;
}

function withoutSuffix(url: string): string {
  const cut = url.search(/[?#]/);
  return cut === -1 ? url : url.slice(0, cut);
}

export function normalizeRequestTarget(url: string): string {
  // HTTP origin-form, HTTP absolute-form, malformed escapes and protocol
  // relative paths are handled without inventing a browser origin.
  const absolute = isAbsoluteForm(url);
  if (!absolute && !url.startsWith("//") && SCHEME.test(url)
    && !url.startsWith("?") && !url.startsWith("#")) {
    return url;
  }

  const path = absolute ? withoutSuffix(url.replace(AUTHORITY, "")) : withoutSuffix(url);
  if (path.startsWith("//") || isUndecodable(path)) return resolveByHand(path);

  try {
    return new URL(path.startsWith("/") ? path : `/${path}`, ORIGIN).pathname;
  } catch {
    return path;
  }
}
