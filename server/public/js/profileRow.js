// One settings row (Mein Profil, Admin): title and a muted meta line on the
// left, the row's single action in the fixed right column shared by every row
// of the page. Title, meta, action and the optional leading element (an
// avatar) are already escaped HTML.
export function profileRow({ title, meta = '', action = '', number = null, lead = '', className = '', attrs = '' }) {
  return `
    <div class="profile-row${className ? ` ${className}` : ''}"${attrs ? ` ${attrs}` : ''}>
      <div class="profile-row-main">
        ${number == null ? '' : `<span class="profile-row-number">${number}</span>`}${lead}
        <span class="profile-row-text">
          <span class="profile-row-title">${title}</span>
          ${meta ? `<span class="profile-row-meta">${meta}</span>` : ''}
        </span>
      </div>
      <div class="profile-row-action">${action}</div>
    </div>`;
}
