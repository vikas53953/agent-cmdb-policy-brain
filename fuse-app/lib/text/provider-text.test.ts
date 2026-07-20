import { describe, expect, it } from "vitest";
import { providerText, providerTextOrNull } from "./provider-text";

// The YouTube Data API returns snippet titles HTML-escaped. Nothing decoded them, so the
// escaped form reached the row (rendered RAW on Home and Search — the overnight-QA P3), the
// DATABASE (Like / Play / PlaylistTrack persist the title) and the lyrics lookup key — so
// any song with an apostrophe silently never found lyrics. These pin the boundary decode,
// including the EXACT entity shapes the QA reported seeing as literal text.

describe("providerText — decoding provider-supplied text", () => {
  it("decodes the escapes YouTube actually sends", () => {
    expect(providerText("Don&#39;t Stop Believin&#39;")).toBe("Don't Stop Believin'");
    expect(providerText("Simon &amp; Garfunkel")).toBe("Simon & Garfunkel");
    expect(providerText("&quot;Heroes&quot;")).toBe('"Heroes"');
    expect(providerText("Sigur R&#xf3;s")).toBe("Sigur Rós");
    expect(providerText("Blood &lt;3")).toBe("Blood <3");
  });

  it("decodes the EXACT raw strings the QA saw rendered as literal text", () => {
    // "&amp;" and "&quot;" shown verbatim on Home and Search — the reported symptom.
    expect(providerText("Blinding Lights &amp; More")).toBe("Blinding Lights & More");
    expect(providerText("The Weeknd &quot;Blinding Lights&quot; (Official Video)")).toBe(
      'The Weeknd "Blinding Lights" (Official Video)',
    );
  });

  it("resolves double-escaped text (&amp;#39;) rather than half-decoding it", () => {
    // The order matters: decoding &amp; first would strand a literal "&#39;".
    expect(providerText("Don&amp;#39;t Stop")).toBe("Don't Stop");
    expect(providerText("Rock &amp;amp; Roll")).toBe("Rock & Roll");
  });

  it("leaves already-plain text untouched (safe to apply at any boundary)", () => {
    expect(providerText("Softly")).toBe("Softly");
    expect(providerText("AC/DC — Back in Black")).toBe("AC/DC — Back in Black");
    // Idempotent: decoding twice is the same as decoding once.
    const once = providerText("Simon &amp; Garfunkel");
    expect(providerText(once)).toBe(once);
  });

  it("trims the stray whitespace providers pad titles with", () => {
    expect(providerText("  Softly  ")).toBe("Softly");
  });

  it("cannot be spun by a hostile chain of escapes", () => {
    // Bounded passes: this must return promptly and not hang.
    const hostile = "&amp;".repeat(200) + "#39;";
    expect(typeof providerText(hostile)).toBe("string");
  });

  it("refuses to emit control characters into a title", () => {
    // A malformed numeric escape must not inject a control char that would then be
    // written to the database. The unresolvable escape is left as literal text.
    expect(providerText("Bad&#0;Title")).toBe("Bad&#0;Title");
    expect(providerText("Bad&#7;Title")).toBe("Bad&#7;Title");
  });

  it("keeps an unknown entity as-is rather than mangling it", () => {
    expect(providerText("A &notreal; B")).toBe("A &notreal; B");
  });
});

describe("providerTextOrNull — optional provider fields", () => {
  it("passes null and undefined straight through", () => {
    expect(providerTextOrNull(null)).toBeNull();
    expect(providerTextOrNull(undefined)).toBeNull();
  });

  it("treats a whitespace-only field as absent, not as an empty name", () => {
    expect(providerTextOrNull("   ")).toBeNull();
  });

  it("decodes a present field", () => {
    expect(providerTextOrNull("Karan Aujla &amp; Ikky")).toBe("Karan Aujla & Ikky");
  });
});
