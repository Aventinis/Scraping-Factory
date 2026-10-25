// The optional "text contains" input of the field modals (Issue #227) — flat
// mode's modal-field-name and container mode's modal-field-extended share it
// (see selector-text-filter.ts for the pure helpers). Picking a button by its
// label is the one thing a clicked CSS selector can't express, so the modals
// offer one extra input: the text the element must contain. Left empty, the
// pick's selector is used exactly as before; filled in, `:contains("…")` is
// appended to it on confirm.
//
// The text lives in the DOM only (like the modals' name input), not in
// _state — but the "N elements found" hint beside it must follow what is
// typed, so this module keeps the latest count per input and
// renderMatchCountHint callers ask effectiveMatchCount() for what to show.
import { suggestFilterText } from './selector-text-filter';
import { byIdOrNull } from './dom';

const liveCounts: Record<string, { text: string; count: number | null; requestId: number }> = {};
let nextRequestId = 0;

// A new pick starts clean: empty input, no live count, and the "use this
// element's text" shortcut only offered when the element has text.
export function resetTextFilter(inputId: string, useButtonId: string, rawText: string | null | undefined): void {
  const input = byIdOrNull<HTMLInputElement>(inputId);
  if (input) input.value = '';
  delete liveCounts[inputId];
  const useButton = byIdOrNull(useButtonId);
  if (useButton) useButton.classList.toggle('hidden', !suggestFilterText(rawText));
}

// What the match-count hint should show: the plain click-time count while
// the text input is empty, the live count for the typed text once known,
// nothing (null → hidden) while that count is still being fetched.
export function effectiveMatchCount(inputId: string, pendingMatchCount: number | null): number | null {
  const input = byIdOrNull<HTMLInputElement>(inputId);
  if (!input || !input.value.trim()) return pendingMatchCount;
  const live = liveCounts[inputId];
  return live && live.text === input.value && live.count !== null ? live.count : null;
}

async function requestCount(text: string): Promise<number | null> {
  try {
    const response: { count?: unknown } | undefined = await chrome.runtime.sendMessage({ type: 'COUNT_PICK_WITH_TEXT', text }); // the content script's answer
    return typeof response?.count === 'number' ? response.count : null;
  } catch {
    return null; // no content script / extension reloaded — just no live count
  }
}

// `rerender` re-renders the modal (so the hint picks up the new count);
// `getRawText` reads the clicked element's text for the shortcut button.
export function wireTextFilter(
  { inputId, useButtonId, rerender, getRawText }: { inputId: string; useButtonId: string; rerender: () => void; getRawText: () => string | null | undefined },
): void {
  const input = byIdOrNull<HTMLInputElement>(inputId);
  input?.addEventListener('input', async () => {
    const text = input.value;
    if (!text.trim()) {
      delete liveCounts[inputId];
      rerender();
      return;
    }
    const requestId = ++nextRequestId;
    liveCounts[inputId] = { text, count: null, requestId };
    rerender(); // hide the stale count right away
    const count = await requestCount(text);
    // a newer keystroke (or a new pick) superseded this request meanwhile
    if (liveCounts[inputId]?.requestId !== requestId) return;
    liveCounts[inputId] = { text, count, requestId };
    rerender();
  });
  byIdOrNull(useButtonId)?.addEventListener('click', () => {
    if (!input) return;
    input.value = suggestFilterText(getRawText());
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.focus();
  });
}
