// Every `<input type="number">` loses the native spinner (see the
// design-token-ok comment beside `input[type='number']` in style.css) because
// it steals width on the narrow fields this app mostly uses it for. That
// leaves mouse-wheel scrolling as the only leftover browser default tied to
// number-field focus: scrolling the page while the pointer happens to rest
// over a focused number field silently changes its value instead of
// scrolling. This module removes that footgun and replaces the lost spinner
// with compact tap/click +/- buttons, for every number field app-wide instead
// of requiring each view to opt in (same approach as icons.js's emoji
// replacement: enhance once here, observe future renders).
import { icon } from './icons.js';

function step(input, direction) {
  const before = input.value;
  if (direction > 0) input.stepUp();
  else input.stepDown();
  if (input.value === before) return;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function makeStepButton(direction, input) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'number-stepper-btn';
  btn.setAttribute('aria-label', direction > 0 ? 'Wert erhöhen' : 'Wert verringern');
  btn.innerHTML = icon(direction > 0 ? 'chevronUp' : 'chevronDown');
  btn.addEventListener('click', () => step(input, direction));
  return btn;
}

function enhance(input) {
  if (input.closest('.number-stepper')) return;
  const wrapper = document.createElement('div');
  wrapper.className = 'number-stepper';
  input.replaceWith(wrapper);
  const steps = document.createElement('div');
  steps.className = 'number-stepper-steps';
  steps.append(makeStepButton(1, input), makeStepButton(-1, input));
  wrapper.append(input, steps);
  // The browser applies its native +/- step while the input has focus, as
  // part of the wheel event's default action. Blurring synchronously inside
  // the same (non-cancelled) event removes focus before that default action
  // runs, so the value stays put — without calling preventDefault(), the
  // page keeps scrolling normally underneath the pointer.
  input.addEventListener('wheel', () => input.blur(), { passive: true });
}

export function installNumberStepper(root = document) {
  root.querySelectorAll('input[type="number"]').forEach(enhance);
}

export function initNumberStepper() {
  installNumberStepper(document);
  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        if (node.matches('input[type="number"]')) enhance(node);
        else if (!node.matches('.number-stepper, .number-stepper *')) installNumberStepper(node);
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
}
