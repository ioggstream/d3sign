import { labelOf, termSections } from './d3fendHierarchy.js';

/**
 * The card describing one term — title, ancestor path, definition, inverse, parents,
 * children — with every section emitted exactly once. There is a single surface that
 * shows it: the hover tooltip in `d3fendHover.js`.
 *
 * Takes a qname ("d3f:Password", "dpv:EncryptionAtRest"), since D3FEND is no longer
 * the only vocabulary the editor knows (vocabularies.js).
 *
 * `onNavigate(qname)` is required, and makes the inverse/parent/child names
 * buttons: it is what replaces the old separate hierarchy popover, since a
 * CodeMirror hover tooltip stays open while the pointer is inside it, which is
 * long enough to walk the tree by clicking.
 *
 * Null for a term no loaded vocabulary knows, so callers can decline to show
 * anything at all.
 */
export function renderD3fendCard(qname, { onNavigate }) {
  const sections = termSections(qname);
  if (!sections) return null;

  const card = document.createElement('div');
  card.className = 'cm-d3fend-card';

  const title = document.createElement('div');
  title.className = 'cm-d3fend-card-title';
  // The hand-authored vocabularies have nowhere to link to, so the title is plain
  // text there rather than an anchor with no destination.
  const heading = document.createElement(sections.url ? 'a' : 'span');
  if (sections.url) {
    heading.href = sections.url;
    heading.target = '_blank';
    heading.rel = 'noopener noreferrer';
  }
  heading.textContent = sections.title;
  title.appendChild(heading);
  card.appendChild(title);

  if (sections.path.length) {
    const path = document.createElement('div');
    path.className = 'cm-d3fend-card-path';
    path.textContent = sections.path.join(' › ');
    card.appendChild(path);
  }

  if (sections.documentation) {
    const body = document.createElement('p');
    body.className = 'cm-d3fend-card-body';
    body.textContent = sections.documentation;
    card.appendChild(body);
  }

  // The article the term comes from — "GDPR Art.4-2" linking to eur-lex. Its own row
  // rather than a parenthetical in the body: it is a link, and there can be several.
  if (sections.sources.length) {
    const row = document.createElement('div');
    row.className = 'cm-d3fend-card-row cm-d3fend-card-sources';
    const tag = document.createElement('span');
    tag.className = 'cm-d3fend-card-label';
    tag.textContent = 'Source:';
    row.appendChild(tag);
    for (const source of sections.sources) {
      // A citation with no url is text: DPV's literal sources ("DGA 12.k") name an
      // article without saying where to read it.
      const item = document.createElement(source.url ? 'a' : 'span');
      if (source.url) {
        item.href = source.url;
        item.target = '_blank';
        item.rel = 'noopener noreferrer';
      }
      item.textContent = source.label;
      row.appendChild(item);
    }
    card.appendChild(row);
  }

  const addRow = (label, names) => {
    if (!names.length) return;
    const row = document.createElement('div');
    row.className = 'cm-d3fend-card-row';
    const tag = document.createElement('span');
    tag.className = 'cm-d3fend-card-label';
    tag.textContent = `${label}:`;
    row.appendChild(tag);
    for (const n of names) row.appendChild(relationButton(n, onNavigate));
    card.appendChild(row);
  };

  if (sections.inverseOf) addRow('Inverse', [sections.inverseOf]);
  addRow('Parents', sections.parents);
  addRow('Children', sections.children);

  return card;
}

// Labelled with the term's human-readable label, titled with the qname — the label
// reads better in a row of relations, the qname is what you would type.
function relationButton(qname, onNavigate) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = labelOf(qname);
  btn.title = qname;
  btn.onclick = () => onNavigate(qname);
  return btn;
}
