// Guidance for the first decisions of a scrape (mode, container type, field type, engine). The "which fits?" texts are help
// popovers declared in the HTML; what lives here reacts to what actually happened: after the click that picks a container's
// element, does the match count contradict the type chosen beforehand (type and element are asked in that order, so the count
// cannot be shown next to the choice). The "try the Browser engine" hint after an empty Static trial run is in error-messages.

export type ContainerCountAdvice = 'unknown' | 'zero' | 'singleMany' | 'repeatingOne' | 'ok';

/** `matchCount` is null when it was not computed; `repeating` is the type chosen in the "new container" modal. */
export function containerCountAdvice(matchCount: number | null | undefined, repeating: boolean | null | undefined): ContainerCountAdvice {
  if (typeof matchCount !== 'number') return 'unknown';
  if (matchCount === 0) return 'zero';
  if (repeating === false && matchCount > 1) return 'singleMany';
  if (repeating === true && matchCount === 1) return 'repeatingOne';
  return 'ok';
}
