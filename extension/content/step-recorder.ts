// "Record my steps" (Issue #508), content-script side: watches what the user does on the page and reports it as RecordedStep
// messages. It never reads what is typed: a fill names the field only, so no credential can reach a message, a log or storage.
// The helpers that live in content-script.ts arrive through StepRecorderDeps. See docs/design-notes/extension.md.
import type { RecordedStep } from '../types/messages';

export interface StepRecorderDeps {
  // The selector a replay should use for this element (unique where possible).
  selectorFor(element: Element): string;
  // Which of several matches of `selector` this element is, when the selector cannot tell them apart: only the first and the last can be
  // addressed by a click action.
  targetFor?(element: Element, selector: string): 'first' | 'last';
  resolveFramePath(): Promise<string[] | null>;
  send(step: RecordedStep): void;
  log(...args: unknown[]): void;
  // Scripted events (isTrusted false) are not the user's: only tests widen this.
  isUserEvent?(event: Event): boolean;
}

export interface StepRecorder {
  start(): void;
  stop(): void;
  isActive(): boolean;
}

// How long the page gets to load more content after a scroll before the step counts as a plain reading scroll.
export const SCROLL_SETTLE_MS = 1000;

const CLICK_TARGET_SELECTOR = 'a, button, input, select, summary, label, [role="button"], [role="tab"], [role="link"]';
const NON_TEXT_INPUT_TYPES = new Set(['checkbox', 'radio', 'button', 'submit', 'reset', 'file', 'image', 'hidden', 'range', 'color']);

function scrollHeightOf(target: EventTarget, doc: Document): number {
  return target === doc ? doc.documentElement.scrollHeight : (target as Element).scrollHeight;
}

function fillTypeOf(element: Element): string | null {
  const tag = element.tagName.toLowerCase();
  if (tag === 'textarea') return 'textarea';
  if (tag !== 'input') return null;
  const type = ((element as HTMLInputElement).type || 'text').toLowerCase();
  return NON_TEXT_INPUT_TYPES.has(type) ? null : type;
}

export function createStepRecorder(deps: StepRecorderDeps, doc: Document = document): StepRecorder {
  let active = false;
  let observer: MutationObserver | null = null;
  let framePathPromise: Promise<string[] | null> | null = null;
  let lateRoots = new WeakSet<Node>();
  let lastFillTarget: Element | null = null;
  const scrollWatch = new Map<EventTarget, { before: number; timer: ReturnType<typeof setTimeout> }>();

  // An element counts as late when it, or an ancestor, was added to the page after the recording began (the page had not shown
  // it right after loading): replaying needs to wait for it.
  function isLate(element: Element): boolean {
    for (let node: Node | null = element; node; node = node.parentNode) {
      if (lateRoots.has(node)) return true;
    }
    return false;
  }

  function emit(build: (framePath: string[] | null) => RecordedStep): void {
    const pending = framePathPromise ?? deps.resolveFramePath();
    framePathPromise = pending;
    pending.then((framePath) => {
      if (active) deps.send(build(framePath && framePath.length > 0 ? framePath : null));
    });
  }

  const fromUser = (event: Event): boolean => (deps.isUserEvent ? deps.isUserEvent(event) : event.isTrusted);

  function onClick(event: MouseEvent): void {
    if (!fromUser(event) || !(event.target instanceof Element)) return;
    const target = event.target.closest(CLICK_TARGET_SELECTOR) ?? event.target;
    // Clicking into a text field only focuses it: the typing that follows is the step.
    if (fillTypeOf(target) !== null) return;
    lastFillTarget = null;
    const selector = deps.selectorFor(target);
    const late = isLate(target);
    const position = deps.targetFor?.(target, selector);
    deps.log('STEP click', selector);
    emit((framePath) => ({ kind: 'click', selector, framePath, late, ...(position === 'last' ? { target: position } : {}) }));
  }

  // Only the field is noted, once per run of typing: the value is deliberately never touched.
  function onInput(event: Event): void {
    if (!fromUser(event) || !(event.target instanceof Element)) return;
    const inputType = fillTypeOf(event.target);
    if (inputType === null || event.target === lastFillTarget) return;
    lastFillTarget = event.target;
    const selector = deps.selectorFor(event.target);
    const late = isLate(event.target);
    deps.log('STEP fill', selector);
    emit((framePath) => ({ kind: 'fill', selector, framePath, late, inputType }));
  }

  function onScroll(event: Event): void {
    const target = event.target;
    if (!target) return;
    const watched = scrollWatch.get(target);
    if (watched) clearTimeout(watched.timer);
    const before = watched ? watched.before : scrollHeightOf(target, doc);
    const timer = setTimeout(() => {
      scrollWatch.delete(target);
      if (!active || scrollHeightOf(target, doc) <= before) return; // nothing new appeared: a reading scroll
      lastFillTarget = null;
      const containerSelector = target === doc ? null : deps.selectorFor(target as Element);
      deps.log('STEP scroll', containerSelector);
      emit((framePath) => ({ kind: 'scroll', containerSelector, framePath }));
    }, SCROLL_SETTLE_MS);
    scrollWatch.set(target, { before, timer });
  }

  function start(): void {
    if (active) return;
    active = true;
    framePathPromise = null;
    lateRoots = new WeakSet<Node>();
    lastFillTarget = null;
    observer = new MutationObserver((records) => {
      for (const record of records) record.addedNodes.forEach((node) => { if (node.nodeType === 1) lateRoots.add(node); });
    });
    observer.observe(doc.documentElement, { childList: true, subtree: true });
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('input', onInput, true);
    doc.addEventListener('scroll', onScroll, true);
    deps.log('STEP_RECORDING start');
  }

  function stop(): void {
    if (!active) return;
    active = false;
    observer?.disconnect();
    observer = null;
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('input', onInput, true);
    doc.removeEventListener('scroll', onScroll, true);
    scrollWatch.forEach(({ timer }) => clearTimeout(timer));
    scrollWatch.clear();
    deps.log('STEP_RECORDING stop');
  }

  return { start, stop, isActive: () => active };
}
