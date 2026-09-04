// In-app feedback (docs/KONZEPT-FEATURE-NUTZUNGSANALYSE.md, Baustein B): a
// short message anyone can send from wherever they currently are. The view
// it was sent from is captured automatically rather than asked for, so
// admins see what prompted it without the sender having to say so.

import { api } from './api.js';
import { openModal } from './modal.js';
import { showToast } from './toast.js';

const MAX_MESSAGE_LENGTH = 500;

// Mirrors the CSS breakpoints in style.css (--bp-md 640px, --bp-lg 860px) —
// kept as a plain width bucket rather than a raw user agent string, see the
// concept's data-minimization section.
function deviceBucket() {
  const width = window.innerWidth;
  if (width < 640) return 'mobile';
  if (width < 860) return 'tablet';
  return 'desktop';
}

const SENTIMENTS = [
  { value: 'positive', label: 'Positiv' },
  { value: 'negative', label: 'Negativ' },
  { value: 'problem', label: 'Problem' },
  { value: 'idea', label: 'Idee' },
];

export function openFeedbackModal(view) {
  let selectedSentiment = null;
  let modalEl;

  const sentimentButtonsHtml = () =>
    SENTIMENTS.map(
      (s) => `<button type="button" class="btn btn-sm${selectedSentiment === s.value ? ' btn-primary' : ''}"
        data-feedback-sentiment="${s.value}" aria-pressed="${selectedSentiment === s.value}">${s.label}</button>`,
    ).join('');

  const { close } = openModal(
    'Feedback',
    `<form id="feedback-form" class="stack">
      <div>
        <span class="field-label" id="feedback-sentiment-label">Art</span>
        <div class="selection-toolbar" role="group" aria-labelledby="feedback-sentiment-label" id="feedback-sentiment-toggle">
          ${sentimentButtonsHtml()}
        </div>
      </div>
      <div>
        <label for="feedback-message" class="field-label is-required">Nachricht</label>
        <textarea id="feedback-message" rows="4" maxlength="${MAX_MESSAGE_LENGTH}" required
          placeholder="Was fällt dir auf?"></textarea>
      </div>
      <button type="submit" class="btn btn-primary btn-block">Senden</button>
    </form>`,
    {
      onMount: (el) => {
        modalEl = el;
        const toggle = el.querySelector('#feedback-sentiment-toggle');
        toggle.addEventListener('click', (e) => {
          const btn = e.target.closest('[data-feedback-sentiment]');
          if (!btn) return;
          const value = btn.dataset.feedbackSentiment;
          selectedSentiment = selectedSentiment === value ? null : value;
          toggle.querySelectorAll('[data-feedback-sentiment]').forEach((b) => {
            const active = b.dataset.feedbackSentiment === selectedSentiment;
            b.classList.toggle('btn-primary', active);
            b.setAttribute('aria-pressed', String(active));
          });
        });
        el.querySelector('#feedback-form').addEventListener('submit', async (e) => {
          e.preventDefault();
          const message = el.querySelector('#feedback-message').value.trim();
          if (!message) return;
          try {
            await api.feedback.create({ message, view, device: deviceBucket(), sentiment: selectedSentiment ?? undefined });
            showToast('Danke für dein Feedback!');
            close();
          } catch (error) {
            showToast(error.message, { error: true });
          }
        });
      },
      confirmClose: () => (modalEl?.querySelector('#feedback-message')?.value.trim() ? 'Feedback verwerfen?' : null),
    },
  );
}
