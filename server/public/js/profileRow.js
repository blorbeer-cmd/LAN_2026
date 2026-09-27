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

// Row classes for a .profile-rows-columns list filled column by column: the
// first and last row of each column drop their outer hairline and padding.
export function columnRowClass(index, count) {
  const columnRows = Math.ceil(count / 2);
  return [
    index === 0 || index === columnRows ? 'is-column-top' : '',
    index === columnRows - 1 || index === 2 * columnRows - 1 ? 'is-column-bottom' : '',
  ].filter(Boolean).join(' ');
}
