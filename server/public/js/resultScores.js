// Result dialogs (Match draws, tournament scores) show a muted "0"
// placeholder in every empty value field, so an empty field counts as 0.
// Only a dialog where nothing at all was entered returns null, so an
// accidental "Speichern" cannot record an all-zero result. A value the
// browser could not parse is passed in as 'invalid' and comes back as NaN
// for the caller's own validation.
export function parseResultScores(rawValues) {
  const values = rawValues.map((raw) => String(raw ?? '').trim());
  if (values.every((value) => value === '')) return null;
  return values.map((value) => (value === '' ? 0 : Number(value)));
}

// Raw value of a number input for parseResultScores(): text the browser
// rejected reads as '' in `value`, which must not silently become 0.
export function resultScoreInputValue(input) {
  return input.validity?.badInput ? 'invalid' : input.value;
}
