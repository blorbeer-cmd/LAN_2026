// Shared result entry for Match draws, tournament fixtures and Admin's free match.
// Callers own their distinct API payloads; this module owns only the form.
import { escapeHtml } from './format.js';
import { parseResultScores, resultScoreInputValue } from './resultScores.js';
import { showToast } from './toast.js';

export function resultRanks(scores) {
  return scores.map((score) => 1 + scores.filter((other) => other > score).length);
}

export function resultWinnerIndex(scores) {
  const highest = Math.max(...scores);
  return scores.filter((score) => score === highest).length === 1 ? scores.indexOf(highest) : null;
}

export function resultFormHtml({ teams, prefix, mode = 'winner', fixedMode = false, allowDraw = true, integerScores = false, winnerIndex, scores = [] }) {
  const scoreMode = mode === 'score';
  const choices = teams.map((team, index) => ({ ...team, index }));
  if (allowDraw) choices.push({ name: 'Unentschieden', players: [], index: -1 });
  return `<div class="stack tournament-result-form" data-result-entry>
    ${fixedMode ? '' : `<div class="result-mode-switch" role="group" aria-label="Ergebnismodus">
      <button type="button" class="btn btn-sm${scoreMode ? '' : ' btn-primary'}" data-result-mode="winner" aria-pressed="${!scoreMode}">Sieger</button>
      <button type="button" class="btn btn-sm${scoreMode ? ' btn-primary' : ''}" data-result-mode="score" aria-pressed="${scoreMode}">Punktestand</button>
    </div>`}
    <div class="result-mode-panels">
    <div class="stack result-winner-list" role="radiogroup" aria-label="Sieger" data-result-winners ${scoreMode ? 'inert aria-hidden="true" data-inactive' : ''}>
      ${choices.map((team) => `<label class="tournament-result-pick${team.index === -1 ? ' is-draw' : ''}${winnerIndex === team.index ? ' is-selected' : ''}">
        <input type="radio" class="visually-hidden" name="${escapeHtml(prefix)}-winner" value="${team.index}" ${winnerIndex === team.index ? 'checked' : ''} />
        <span>${escapeHtml(team.name)}</span>
        ${team.players?.length ? `<span class="tournament-result-pick-players">${escapeHtml(team.players.join(', '))}</span>` : ''}
      </label>`).join('')}
    </div>
    <div class="stack result-score-list" data-result-scores ${scoreMode ? '' : 'inert aria-hidden="true" data-inactive'}>
      ${teams.map((team, index) => `<div class="result-score-row">
        <span class="result-rank lb-rank" data-result-rank="${index}"></span>
        <label class="result-team-label" for="${escapeHtml(prefix)}-score-${index}">
          <span>${escapeHtml(team.name)}</span>
          ${team.players?.length ? `<span class="tournament-result-pick-players">${escapeHtml(team.players.join(', '))}</span>` : ''}
        </label>
        <input type="number" id="${escapeHtml(prefix)}-score-${index}" class="tournament-result-score" data-result-score="${index}" aria-label="Punktestand ${escapeHtml(team.name)}" ${integerScores ? 'min="0" step="1" inputmode="numeric"' : 'step="any" inputmode="decimal"'} placeholder="0" value="${scores[index] ?? ''}" />
      </div>`).join('')}
    </div>
    </div>
    <div class="result-save-row"><button type="button" class="btn btn-primary btn-sm" data-result-save>Speichern</button></div>
  </div>`;
}

export function wireResultForm(root, { teams, mode = 'winner', allowDraw = true, integerScores = false, onModeChange, onSave }) {
  const entry = root.querySelector('[data-result-entry]');
  let currentMode = mode;
  const saveButton = entry.querySelector('[data-result-save]');
  const inputs = [...entry.querySelectorAll('[data-result-score]')];

  function updateRanks() {
    const scores = inputs.map((input) => Number(input.value || 0));
    const ranks = resultRanks(scores);
    entry.querySelectorAll('[data-result-rank]').forEach((node, index) => {
      node.textContent = String(ranks[index]);
      node.classList.toggle('is-first', ranks[index] === 1);
    });
  }
  function setMode(nextMode) {
    currentMode = nextMode;
    onModeChange?.(nextMode);
    for (const [selector, inactive] of [['[data-result-winners]', nextMode === 'score'], ['[data-result-scores]', nextMode !== 'score']]) {
      const panel = entry.querySelector(selector);
      panel.inert = inactive;
      panel.toggleAttribute('data-inactive', inactive);
      if (inactive) panel.setAttribute('aria-hidden', 'true');
      else panel.removeAttribute('aria-hidden');
    }
    entry.querySelectorAll('[data-result-mode]').forEach((button) => {
      const active = button.dataset.resultMode === nextMode;
      button.classList.toggle('btn-primary', active);
      button.setAttribute('aria-pressed', String(active));
    });
  }
  entry.querySelectorAll('[data-result-mode]').forEach((button) => button.addEventListener('click', () => setMode(button.dataset.resultMode)));
  entry.querySelectorAll('input[type="radio"]').forEach((input) => input.addEventListener('change', () => {
    entry.querySelectorAll('.tournament-result-pick').forEach((label) => label.classList.toggle('is-selected', label.querySelector('input').checked));
  }));
  inputs.forEach((input) => input.addEventListener('input', updateRanks));
  updateRanks();

  saveButton.addEventListener('click', async () => {
    if (saveButton.disabled) return;
    let result;
    if (currentMode === 'score') {
      const scores = parseResultScores(inputs.map(resultScoreInputValue));
      if (!scores) return showToast('Bitte mindestens einen Punktestand eintragen.', { error: true });
      if (scores.some((score) => !Number.isFinite(score))) return showToast('Bitte nur Zahlen als Punktestand eintragen.', { error: true });
      if (integerScores && scores.some((score) => !Number.isInteger(score) || score < 0)) {
        return showToast('Punktestände müssen ganze Zahlen ab 0 sein.', { error: true });
      }
      const winnerIndex = resultWinnerIndex(scores);
      if (!allowDraw && winnerIndex === null) return showToast('In dieser K.-o.-Runde ist kein Unentschieden möglich.', { error: true });
      result = { mode: currentMode, scores, ranks: resultRanks(scores), winnerIndex };
    } else {
      const selected = entry.querySelector('input[type="radio"]:checked');
      if (!selected) return showToast('Bitte ein Siegerteam oder Unentschieden auswählen.', { error: true });
      result = { mode: currentMode, scores: teams.map(() => null), ranks: teams.map(() => null), winnerIndex: Number(selected.value) === -1 ? null : Number(selected.value) };
    }
    saveButton.disabled = true;
    try {
      await onSave(result);
    } catch (error) {
      showToast(error.message, { error: true });
      saveButton.disabled = false;
    }
  });
  return { setMode };
}
