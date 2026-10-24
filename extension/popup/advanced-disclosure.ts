// Issue #396: pure logic + storage for the "Advanced" disclosure — a
// <details class="advanced-disclosure" data-advanced="<section id>"> that
// tucks away rarely needed options. Collapsed by default; whether a section
// was opened is remembered per section (never globally — there is no
// "advanced mode") in chrome.storage.local, the same device-preference store
// theme.ts and i18n.ts use. See advanced-disclosure-ui.ts for the DOM side.
export const STORAGE_KEY = 'advancedSections';

type Sections = Record<string, boolean>;

export function isSectionOpen(sections: Sections | null | undefined, id: string): boolean {
  return !!(sections && sections[id] === true);
}

// Closed sections are dropped instead of stored as `false`, so the map only
// ever lists what the user actually opened.
export function withSectionOpen(sections: Sections | null | undefined, id: string, open: boolean): Sections {
  const next = { ...(sections || {}) };
  if (open) next[id] = true;
  else delete next[id];
  return next;
}

export async function loadAdvancedSections(): Promise<Sections> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return {};
  try {
    const stored = await chrome.storage.local.get(STORAGE_KEY);
    const value = stored[STORAGE_KEY];
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Sections : {}; // stored by persistAdvancedSections
  } catch {
    return {};
  }
}

export async function persistAdvancedSections(sections: Sections): Promise<void> {
  if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
  try {
    await chrome.storage.local.set({ [STORAGE_KEY]: sections });
  } catch {
    // Best-effort — a failed write only means the section starts collapsed next time.
  }
}
