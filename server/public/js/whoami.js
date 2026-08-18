// Session-backed identity adapter shared by the existing views.

let sessionPlayerId = '';

export function getMyId() {
  return sessionPlayerId;
}

export function lockMyIdToSession(id) {
  sessionPlayerId = id;
  signalIdentityChanged(id);
}

function signalIdentityChanged(id) {
  // Clears/sets the "you still need to set yourself up" dot on the "Mehr"
  // nav button (which leads to "Mein Profil") right away, without waiting
  // for the next view switch to notice.
  document.querySelector('.nav-btn[data-view="more"]')?.classList.toggle('needs-setup', !id);
  // Global signal for modules outside the per-view render cycle (the header
  // notification center) that need to refetch "for the current identity"
  // data right away instead of only picking up the change whenever some
  // view next happens to render.
  window.dispatchEvent(new CustomEvent('respawn:identity-changed'));
}
