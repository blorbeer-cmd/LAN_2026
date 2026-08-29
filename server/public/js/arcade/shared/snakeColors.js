const SNAKE_COLORS = [
  { token: '--accent', label: 'Blau' },
  { token: '--accent-3', label: 'Pink' },
  { token: '--state-playing', label: 'Grün' },
  { token: '--state-paused', label: 'Orange' },
  { token: '--accent-2', label: 'Violett' },
  { token: '--danger', label: 'Rot' },
  { token: '--rank-1-gold', label: 'Gold' },
  { token: '--text', label: 'Weiß' },
];

export function snakeColor(index) {
  return SNAKE_COLORS[index % SNAKE_COLORS.length];
}
