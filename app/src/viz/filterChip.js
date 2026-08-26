/**
 * A header chip that opens its filter checkboxes in a popover over the graph
 * canvas, so showing a filter never steals height from the canvas.
 *
 * Uses the native Popover API: the top layer escapes `.pane { overflow: auto }`
 * clipping, and light-dismiss gives click-outside, Escape, and single-open-at-a-time
 * for free. Only the placement needs JS, since CSS anchor positioning isn't portable yet.
 */
export function createFilterChip(chipHost, { id, label, icon, title, shortcut, search }) {
  const popoverId = `${id}-popover`;

  const chip = document.createElement('button');
  chip.type = 'button';
  chip.className = 'filter-chip';
  chip.setAttribute('popovertarget', popoverId);
  chip.setAttribute('aria-expanded', 'false');

  if (icon) {
    const iconSpan = document.createElement('span');
    iconSpan.className = 'filter-chip-icon';
    iconSpan.setAttribute('aria-hidden', 'true');
    iconSpan.textContent = icon;
    chip.appendChild(iconSpan);
  }
  chip.append(label);

  const count = document.createElement('span');
  count.className = 'filter-chip-count';
  chip.appendChild(count);

  // Printed on the chip, not only in its tooltip: the chip is the one place the
  // popover is reached from, so it is where its shortcut is learnt — the same
  // reason the tabs and the right-click menu carry theirs.
  if (shortcut) {
    const key = document.createElement('span');
    key.className = 'filter-chip-key';
    key.textContent = shortcut;
    chip.appendChild(key);
  }
  chipHost.appendChild(chip);

  const keyHint = shortcut ? ` (${shortcut})` : '';
  chip.title = `${title ?? label}${keyHint}`;

  const popover = document.createElement('div');
  popover.id = popoverId;
  popover.className = 'filter-popover';
  popover.setAttribute('popover', 'auto');

  const header = document.createElement('div');
  header.className = 'filter-popover-header';
  const heading = document.createElement('h3');
  heading.textContent = title ?? label;
  header.appendChild(heading);

  const bulk = document.createElement('div');
  bulk.className = 'filter-popover-bulk';
  header.appendChild(bulk);
  popover.appendChild(header);

  // A `text` input, not `search`: the browser's search field swallows Escape to
  // clear itself, which would break the popover's light-dismiss.
  let searchInput = null;
  if (search) {
    searchInput = document.createElement('input');
    searchInput.type = 'text';
    searchInput.className = 'filter-popover-search';
    searchInput.placeholder = search.placeholder ?? 'Filter…';
    searchInput.setAttribute('aria-label', search.placeholder ?? `Filter ${label}`);
    searchInput.addEventListener('input', () => search.onInput?.(searchInput.value));
    searchInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      search.onSubmit?.(searchInput.value);
    });
    popover.appendChild(searchInput);
  }

  const body = document.createElement('div');
  body.className = 'filter-popover-body';
  popover.appendChild(body);
  document.body.appendChild(popover);

  /**
   * Pins the popover under the chip, flipping above / clamping when it wouldn't fit.
   * Only callable once the popover is open — while closed the UA stylesheet keeps it
   * `display: none`, so it has no measurable size.
   */
  function place() {
    popover.style.top = '0px';
    popover.style.left = '0px';
    const anchor = chip.getBoundingClientRect();
    const own = popover.getBoundingClientRect();
    const left = Math.max(8, Math.min(anchor.left, window.innerWidth - own.width - 8));
    const below = anchor.bottom + 6;
    const fitsBelow = below + own.height <= window.innerHeight - 8;
    popover.style.left = `${left}px`;
    popover.style.top = `${fitsBelow ? below : Math.max(8, anchor.top - own.height - 6)}px`;
    popover.style.visibility = '';
  }

  // Keep it invisible from the moment it is shown until `toggle` has placed it,
  // so it never paints at the wrong position.
  popover.addEventListener('beforetoggle', (event) => {
    if (event.newState === 'open') popover.style.visibility = 'hidden';
  });
  popover.addEventListener('toggle', (event) => {
    const isOpen = event.newState === 'open';
    chip.setAttribute('aria-expanded', String(isOpen));
    if (isOpen) {
      place();
      searchInput?.focus();
    } else if (searchInput?.value) {
      // Closing (Escape or click-outside) leaves no filter behind, so the list is
      // whole again the next time it opens.
      searchInput.value = '';
      search.onInput?.('');
    }
  });
  window.addEventListener('resize', () => {
    if (popover.matches(':popover-open')) place();
  });

  return {
    chip,
    body,
    /** Host for the panel's `all`/`none` buttons, so they sit in the popover header. */
    bulkHost: bulk,
    /** Opens the popover from a keyboard shortcut and puts the caret in the search box. */
    open() {
      if (popover.matches(':popover-open')) searchInput?.focus();
      else popover.showPopover();
    },
    /**
     * Shows `shown/total`, and flags the chip whenever the view is narrowed.
     * The shortcut stays in the tooltip: this replaces the title set at build time.
     */
    setCount(shown, total) {
      count.textContent = `${shown}/${total}`;
      chip.classList.toggle('filter-chip--filtered', shown < total);
      chip.title = `${shown} of ${total} shown${keyHint}`;
    },
  };
}

/** Renders `all` / `none` buttons into a chip's popover header. */
export function renderBulkActions(host, { onAll, onNone }) {
  host.innerHTML = '';
  const addButton = (text, handler) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = text;
    button.addEventListener('click', handler);
    host.appendChild(button);
  };
  addButton('all', onAll);
  const separator = document.createElement('span');
  separator.textContent = '·';
  host.appendChild(separator);
  addButton('none', onNone);
}
