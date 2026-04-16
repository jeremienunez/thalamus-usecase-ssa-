const FABRICATION_TOKENS = [
  /\btypical(ly)?\b/i,
  /\bapprox(imately)?\b/i,
  /\babout\b/i,
  /\baround\b/i,
  /\broughly\b/i,
  /\bestimate[ds]?\b/i,
  /\bvarious\b/i,
  /\busually\b/i,
  /\bgeneral(ly)?\b/i,
  /\bcommon(ly)?\b/i,
  /\bmost\s+of\b/i,
  /\bN\/A\b/i,
  /\bunknown\b/i,
  /\bnot\s+specified\b/i,
  /\bnot\s+available\b/i,
  /\bvariable\b/i,
  /\bdepends?\b/i,
  /\branges?\s+from\b/i,
  /\bvaries\b/i,
];

export function detectFabrication(text: string): string | null {
  for (const re of FABRICATION_TOKENS) {
    const m = re.exec(text);
    if (m) return m[0];
  }
  return null;
}
