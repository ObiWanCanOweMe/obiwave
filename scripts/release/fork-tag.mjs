const VERSION = '(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)';
const TAG_RE = new RegExp(`^v(${VERSION})-obiwave\\.([1-9][0-9]*)$`);
const VERSION_RE = new RegExp(`^${VERSION}$`);

export function parseForkTag(value) {
  const match = TAG_RE.exec(value);
  if (!match) throw new Error(`Expected a fork-qualified release tag, received: ${value}`);
  return { tag: value, version: match[1], revision: Number(match[5]) };
}

export function makeForkTag(version, revision) {
  const normalized = String(revision);
  if (!VERSION_RE.test(version) || !/^[1-9][0-9]*$/.test(normalized)) {
    throw new Error(`Cannot construct fork-qualified release tag from ${version} revision ${revision}`);
  }
  return `v${version}-obiwave.${normalized}`;
}
