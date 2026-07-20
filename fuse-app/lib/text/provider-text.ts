// Normalising text that arrives from an external music provider.
//
// THE BUG THIS KILLS (overnight QA P3): the YouTube Data API returns snippet titles
// HTML-ESCAPED — `Don&#39;t Stop Believin&#39;`, `Simon &amp; Garfunkel`, `&quot;Heroes&quot;`.
// Nothing decoded them, so the escaped form rendered RAW on Home and Search ("&amp;" shown
// as literal text), was written through into the database (Like, Play, PlaylistTrack all
// persist the title) and used as the lyrics lookup key — so a song with an apostrophe in its
// name silently never found lyrics.
//
// THE CLASS-LEVEL RULE (not a patch at one call site): text from ANY external provider is
// decoded exactly ONCE, at the adapter boundary, before it enters the app. Every provider
// adapter maps its raw payload through `providerText` / `providerTextOrNull`, so no
// downstream surface — a row, the database, a lyrics query, a search cache entry — ever has
// to wonder whether the string it holds is escaped. Decoding per-component (in each row) was
// the trap: one surface would be fixed and the next would still show raw entities. Adding a
// new provider means mapping it through here too; that is the whole contract.
//
// Deliberately NOT a general-purpose HTML sanitiser and not a DOM-based decoder: this runs on
// the server (no `document`), and provider titles are plain text that was escaped once, not
// markup. We decode the fixed set of entities the JSON APIs actually emit, plus numeric
// escapes, and nothing else.

// The named entities that appear in real provider payloads. `&amp;` MUST be applied last
// (see below) so a double-escaped `&amp;#39;` resolves in the correct order.
const NAMED: ReadonlyArray<readonly [RegExp, string]> = [
  [/&quot;/g, '"'],
  [/&apos;/g, "'"],
  [/&lt;/g, "<"],
  [/&gt;/g, ">"],
  [/&nbsp;/g, " "],
];

// Numeric character references: decimal `&#39;` and hex `&#x27;`.
const DECIMAL = /&#(\d+);/g;
const HEX = /&#x([0-9a-f]+);/gi;

// Code points we refuse to produce even if a provider asks for them: C0/C1 control
// characters (except tab/newline, which titles never legitimately contain anyway) and
// anything outside the Unicode range. Keeps a malformed payload from injecting control
// characters into a title that then lands in the database.
function safeFromCodePoint(code: number): string | null {
  if (!Number.isFinite(code) || code < 0x20 || code > 0x10ffff) return null;
  if (code >= 0x7f && code <= 0x9f) return null;
  try {
    return String.fromCodePoint(code);
  } catch {
    return null;
  }
}

// Decode one pass of entities.
function decodeOnce(input: string): string {
  let out = input;
  for (const [re, char] of NAMED) out = out.replace(re, char);
  out = out.replace(DECIMAL, (whole, digits: string) => safeFromCodePoint(Number(digits)) ?? whole);
  out = out.replace(HEX, (whole, digits: string) => safeFromCodePoint(parseInt(digits, 16)) ?? whole);
  // `&amp;` last: `&amp;#39;` (double-escaped, which YouTube does emit) becomes `&#39;`
  // here and is resolved by the next pass rather than collapsing wrongly in this one.
  return out.replace(/&amp;/g, "&");
}

// How many decode passes we are willing to run. Provider payloads are escaped once, and
// double-escaping ("&amp;#39;") is the known worst case — so two passes settle every real
// input. The bound exists so a hostile string of "&amp;amp;amp;..." cannot spin here.
const MAX_PASSES = 3;

/**
 * Decode provider-supplied text into the plain string a person should read.
 *
 * Idempotent in practice: already-plain text passes through untouched, so it is safe to
 * apply at a boundary without knowing whether that particular provider escapes.
 */
export function providerText(raw: string): string {
  let out = raw;
  for (let i = 0; i < MAX_PASSES; i++) {
    const next = decodeOnce(out);
    if (next === out) break;
    out = next;
  }
  // Providers pad titles with stray whitespace far more often than you would hope.
  return out.trim();
}

/** Nullable variant for optional provider fields (channel name, album, artist). */
export function providerTextOrNull(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  const text = providerText(raw);
  return text.length > 0 ? text : null;
}
