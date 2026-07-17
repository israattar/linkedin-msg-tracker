// Helpers for working with LinkedIn profile URLs. The app never fetches
// LinkedIn pages; the only data source is the URL text itself.

const PROFILE_PATTERN = /linkedin\.com\/in\/([^/?#]+)/i;

export function isLinkedinProfileUrl(url: string): boolean {
  return PROFILE_PATTERN.test(url);
}

// Canonical form used to detect duplicates: "linkedin.com/in/<slug>".
export function normaliseLinkedinUrl(url: string): string {
  const match = url.match(PROFILE_PATTERN);
  if (!match) return url.trim().toLowerCase();
  return `linkedin.com/in/${match[1].toLowerCase()}`;
}

// Best-effort name guess from the URL slug. LinkedIn slugs look like
// "raj-verma-17582861" or "maya-rodriguez-8a2b": name words, then often a
// random id chunk which we drop. The user confirms or edits the result.
export function guessNameFromUrl(url: string): string {
  const match = url.match(PROFILE_PATTERN);
  if (!match) return '';

  let slug: string;
  try {
    slug = decodeURIComponent(match[1]);
  } catch {
    slug = match[1];
  }

  const parts = slug.split('-').filter(Boolean);

  // Drop trailing id chunks: pure digits, or hex-looking strings with a digit.
  while (parts.length > 1) {
    const last = parts[parts.length - 1];
    const isNumeric = /^\d+$/.test(last);
    const isHexId = /^[0-9a-f]+$/i.test(last) && /\d/.test(last);
    if (isNumeric || isHexId) parts.pop();
    else break;
  }

  return parts
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(' ');
}
