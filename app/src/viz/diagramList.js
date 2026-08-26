/** Renders a clickable list of diagram titles; onSelect(hash) fires on click. */
export function renderDiagramList(host, diagrams, selectedHash, onSelect) {
  host.innerHTML = '';
  const list = document.createElement('ul');
  list.className = 'diagram-list';
  for (const d of diagrams) {
    const item = document.createElement('li');
    item.dataset.hash = d.hash;
    if (d.hash === selectedHash) item.classList.add('selected');
    item.textContent = d.title || '(untitled)';
    item.addEventListener('click', () => onSelect(d.hash));
    list.appendChild(item);
  }
  host.appendChild(list);
}
