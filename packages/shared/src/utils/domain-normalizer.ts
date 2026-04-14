/**
 * SPEC-SH-004 — Domain Normalizer
 * Derives a deterministic canonical form from a raw identifier.
 */

export interface NormalizeOptions {
  readonly separator?: "-" | "_" | "";
  readonly stripDiacritics?: boolean;
  readonly lowercase?: boolean;
  readonly collapseWhitespace?: boolean;
}

export interface NormalizeResult {
  readonly canonical: string;
  readonly original: string;
  readonly strippedDiacritics: boolean;
  readonly collapsedSeparators: boolean;
}

// Runs of whitespace, hyphens, or underscores — the three "separator" axes.
const SEPARATOR_RUN = /[\s\-_]+/g;
// Combining marks left over after NFD decomposition.
const COMBINING_MARKS = /\p{M}/gu;

export function normalizeDomain(
  input: string,
  options: NormalizeOptions = {},
): NormalizeResult {
  const {
    separator = "-",
    stripDiacritics = true,
    lowercase = true,
    collapseWhitespace = true,
  } = options;

  const original = input;
  let out = input;

  let strippedDiacritics = false;
  if (stripDiacritics) {
    const decomposed = out.normalize("NFD");
    const folded = decomposed.replace(COMBINING_MARKS, "");
    if (folded !== out) strippedDiacritics = true;
    out = folded;
  }

  if (lowercase) {
    out = out.toLowerCase();
  }

  out = out.trim();

  let collapsedSeparators = false;
  if (collapseWhitespace) {
    const replaced = out.replace(SEPARATOR_RUN, separator);
    if (replaced !== out) collapsedSeparators = true;
    out = replaced;
  }

  // Trim leading/trailing separator that may remain after collapse
  // (e.g. "---" → "-" → "").
  if (separator.length > 0) {
    const boundary = new RegExp(
      `^${escapeRegex(separator)}+|${escapeRegex(separator)}+$`,
      "g",
    );
    out = out.replace(boundary, "");
  }

  return {
    canonical: out,
    original,
    strippedDiacritics,
    collapsedSeparators,
  };
}

export function canonical(input: string, options?: NormalizeOptions): string {
  return normalizeDomain(input, options).canonical;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
