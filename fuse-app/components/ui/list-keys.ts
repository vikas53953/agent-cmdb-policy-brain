// Stable React keys for lists that get reordered.
//
// THE BUG THIS KILLS: the queue and the home rails keyed their rows on
// `${identity}:${arrayIndex}`. The index is POSITION, not identity, so one drag or one
// tap of Move up changed the key of every row from the move onward. React then threw
// those rows away and built new ones instead of moving the existing ones: artwork
// flickered back to empty, and focus was lost on the button the user had just pressed —
// which is why tapping Move up repeatedly did not work.
//
// The naive fix, keying on identity alone, breaks the other way: the same song really can
// sit in a queue twice (or repeat in a "recently played" rail), and duplicate keys are
// their own reconciliation bug. So the key is the track's identity plus WHICH occurrence
// of that identity it is. Distinct tracks keep one stable key for life no matter how the
// list is reordered; identical copies can only ever swap keys with each other, which is
// invisible because their content is identical.

/**
 * Turn a list of identity strings into unique keys that survive reordering.
 * The first occurrence of an identity keeps it unchanged, so the common
 * no-duplicates case reads exactly as the plain identity.
 */
export function occurrenceKeys(identities: readonly string[]): string[] {
  const seen = new Map<string, number>();
  return identities.map((id) => {
    const n = seen.get(id) ?? 0;
    seen.set(id, n + 1);
    return n === 0 ? id : `${id}#${n}`;
  });
}
