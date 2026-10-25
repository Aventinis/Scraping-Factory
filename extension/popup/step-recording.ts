// "Record my steps" (Issue #508), panel side: turns the recorded steps into browser actions. Pure and DOM-free; step-recording-ui.ts
// drives the dialog. A step never carries typed text (see content/step-recorder.ts), so neither does an action.
import type * as SFDraft from '../types/drafts';
import type { RecordedStep } from '../types/messages';
import { addBrowserAction } from './scraping-config-builder';

const sameFrame = (a: string[] | null, b: string[] | null): boolean => JSON.stringify(a) === JSON.stringify(b);

// What counts as "the same thing done again" for collapsing: the repeated click on one button, the many keystrokes into one field,
// the many scroll events on one container.
function repeatsPrevious(step: RecordedStep, previous: RecordedStep | undefined): boolean {
  if (!previous || previous.kind !== step.kind || !sameFrame(previous.framePath, step.framePath)) return false;
  if (step.kind === 'scroll') return step.containerSelector === (previous as typeof step).containerSelector;
  if (step.kind === 'click' && step.target !== (previous as typeof step).target) return false;
  return step.selector === (previous as typeof step).selector;
}

function withFrame(action: SFDraft.BrowserAction, framePath: string[] | null): SFDraft.BrowserAction {
  return framePath ? { ...action, framePath } : action;
}

// The defaults are the editor's own (addBrowserAction), so a recorded action looks like one added by hand.
function baseAction(kind: SFDraft.BrowserAction['kind']): SFDraft.BrowserAction {
  return addBrowserAction([], kind)[0];
}

export function stepsToActions(steps: RecordedStep[]): SFDraft.BrowserAction[] {
  const actions: SFDraft.BrowserAction[] = [];
  steps.forEach((step, i) => {
    if (repeatsPrevious(step, steps[i - 1])) return;

    // A target that was not there right after the page loaded needs a wait first, unless one for it already stands directly before.
    if (step.kind !== 'scroll' && step.late) {
      const last = actions[actions.length - 1];
      if (!(last && last.kind === 'waitFor' && last.selector === step.selector && sameFrame(last.framePath ?? null, step.framePath))) {
        actions.push(withFrame({ ...baseAction('waitFor'), selector: step.selector }, step.framePath));
      }
    }

    if (step.kind === 'click') {
      actions.push(withFrame({ ...baseAction('click'), selector: step.selector, ...(step.target ? { target: step.target } : {}) }, step.framePath));
    } else if (step.kind === 'fill') {
      // The value is not recorded: the editor asks for the name of the environment variable that will hold it.
      actions.push(withFrame({
        ...baseAction('fill'), selector: step.selector, ...(step.inputType === 'password' ? { role: 'password' as const } : {}),
      }, step.framePath));
    } else {
      actions.push(withFrame({ ...baseAction('scroll'), containerSelector: step.containerSelector ?? '' }, step.framePath));
    }
  });
  return actions;
}
