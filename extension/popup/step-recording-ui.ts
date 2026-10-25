// "Record my steps" (Issue #508): the button, the live list of steps and the "append or replace" choice. See step-recording.ts for the
// conversion and the `bridge` convention in api-config-ui.ts.
import type { PopupBridge } from '../types/popup';
import type { RecordedStep } from '../types/messages';
import { createLogger } from '../shared/logger';
import { t } from '../i18n/i18n';
import { stepsToActions } from './step-recording';
import { byIdOrNull, escapeHtml } from './dom';

const log = createLogger('SF:StepRecordingUI');

export function startStepRecording(bridge: PopupBridge): void {
  log('STEP_RECORDING start');
  chrome.runtime.sendMessage({ type: 'STEP_RECORDING_START' });
  bridge.patchState({ stepRecordingActive: true, recordedSteps: [], recordedActionsPending: null, stepRecordingNote: null });
}

export function addRecordedStep(bridge: PopupBridge, step: RecordedStep): void {
  const state = bridge.getState();
  if (state.stepRecordingActive) bridge.patchState({ recordedSteps: [...state.recordedSteps, step] });
}

// Ends the recording (the user's Stop, or the service worker reporting that it cannot go on) and turns what was recorded so far into
// actions. An empty list takes them directly; a non-empty one asks once whether to add to it or replace it.
export function finishStepRecording(bridge: PopupBridge, note: string | null = null): void {
  const state = bridge.getState();
  if (!state.stepRecordingActive) return;
  log('STEP_RECORDING finish', { steps: state.recordedSteps.length, note });
  const actions = stepsToActions(state.recordedSteps);
  const closed = { stepRecordingActive: false, recordedSteps: [], stepRecordingNote: note };
  if (actions.length === 0) {
    bridge.patchState({ ...closed, stepRecordingNote: note ?? t('browserActions.record.nothingRecorded') });
  } else if (state.browserActions.length === 0) {
    bridge.setState(state.current, { ...closed, browserActions: actions, recordedActionsPending: null });
  } else {
    bridge.patchState({ ...closed, recordedActionsPending: actions });
  }
}

export function stopStepRecording(bridge: PopupBridge): void {
  chrome.runtime.sendMessage({ type: 'STEP_RECORDING_STOP' });
  finishStepRecording(bridge);
}

export function resolveRecordedActions(bridge: PopupBridge, choice: 'append' | 'replace' | 'discard'): void {
  const state = bridge.getState();
  const pending = state.recordedActionsPending;
  if (!pending) return;
  const browserActions = choice === 'append' ? [...state.browserActions, ...pending] : choice === 'replace' ? pending : state.browserActions;
  bridge.setState(state.current, { browserActions, recordedActionsPending: null });
}

function describeStep(step: RecordedStep): string {
  if (step.kind === 'click') return t('browserActions.record.stepClick', { selector: step.selector });
  if (step.kind === 'fill') return t('browserActions.record.stepFill', { selector: step.selector });
  return t('browserActions.record.stepScroll', { container: step.containerSelector ?? t('browserActions.record.stepScrollPage') });
}

export function renderStepRecording(bridge: PopupBridge): void {
  const state = bridge.getState();
  const button = byIdOrNull('btn-record-steps');
  if (button) {
    button.textContent = t(state.stepRecordingActive ? 'browserActions.record.stopBtn' : 'browserActions.record.startBtn');
    button.classList.toggle('active', state.stepRecordingActive);
  }
  const list = byIdOrNull('record-steps-list');
  if (list) {
    list.classList.toggle('hidden', !state.stepRecordingActive);
    list.innerHTML = state.stepRecordingActive
      ? (state.recordedSteps.length === 0
        ? `<li class="record-steps-empty">${escapeHtml(t('browserActions.record.waiting'))}</li>`
        : state.recordedSteps.map(step => `<li>${escapeHtml(describeStep(step))}</li>`).join(''))
      : '';
  }
  byIdOrNull('record-steps-choice')?.classList.toggle('hidden', !state.recordedActionsPending);
  const note = byIdOrNull('record-steps-note');
  if (note) {
    note.textContent = state.stepRecordingNote ?? '';
    note.classList.toggle('hidden', !state.stepRecordingNote);
  }
}

export function wireStepRecordingEvents(bridge: PopupBridge): void {
  byIdOrNull('btn-record-steps')?.addEventListener('click', () => {
    if (bridge.getState().stepRecordingActive) stopStepRecording(bridge); else startStepRecording(bridge);
  });
  byIdOrNull('btn-record-steps-append')?.addEventListener('click', () => resolveRecordedActions(bridge, 'append'));
  byIdOrNull('btn-record-steps-replace')?.addEventListener('click', () => resolveRecordedActions(bridge, 'replace'));
  byIdOrNull('btn-record-steps-discard')?.addEventListener('click', () => resolveRecordedActions(bridge, 'discard'));
}
