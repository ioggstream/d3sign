/**
 * The session, as one markdown file (docs/adr/0021-sparql-query-pane.md).
 *
 * "Dump session" and "Destroy session" are two halves of the same promise: what
 * the browser is holding can be taken away, and taken away *first*, so that
 * destroying it loses nothing. The dump therefore mirrors what Destroy wipes —
 * the saved queries and the document library — and not the view state, which
 * Destroy keeps because layout and filters are settings, not historicized work.
 *
 * Markdown, not JSON, because the point is to be readable and pasteable: a
 * query in a ```sparql fence is a query you can hand to someone. The cost is
 * that content containing a fence would end the block early, which `fenceFor`
 * is here to prevent.
 *
 * Pure: no DOM, no storage. query/sessionDump.test.js drives it in node.
 */

/**
 * A fence long enough to wrap `text`: three backticks, or one more than the
 * longest run already inside it. CommonMark closes a fenced block only on a run
 * at least as long as the one that opened it, so this is the whole rule.
 */
export function fenceFor(text, lang = '') {
  let longest = 0;
  for (const run of String(text ?? '').matchAll(/`+/g)) {
    longest = Math.max(longest, run[0].length);
  }
  const ticks = '`'.repeat(Math.max(3, longest + 1));
  return { open: `${ticks}${lang}`, close: ticks };
}

/** One `### name` section with its content fenced. */
function block(name, savedAt, text, lang) {
  const { open, close } = fenceFor(text, lang);
  const lines = [`### ${name}`, ''];
  if (savedAt) lines.push(`Saved ${new Date(savedAt).toISOString()}`, '');
  // The trailing newline is the content's own; a block that already ends in one
  // must not gain a blank line before the closing fence.
  lines.push(open, String(text ?? '').replace(/\n$/, ''), close, '');
  return lines;
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * `queries` and `files` come straight from the two stores, newest first. Empty
 * sections are omitted rather than left as bare headings, and a dump with
 * nothing in it says so — a file that looks like a template is worse than one
 * that admits it is empty.
 */
export function buildSessionDump({ queries = [], files = [], now = Date.now() } = {}) {
  const lines = [
    '# d3sign session dump',
    '',
    `Generated ${new Date(now).toISOString()} — ` +
      `${count(queries.length, 'query', 'queries')}, ${count(files.length, 'document', 'documents')}.`,
    '',
  ];

  if (!queries.length && !files.length) {
    lines.push('Nothing was saved in this browser.', '');
    return lines.join('\n');
  }

  if (queries.length) {
    lines.push('## SPARQL queries', '');
    for (const query of queries) {
      lines.push(...block(query.name, query.updatedAt, query.sparql, 'sparql'));
    }
  }

  if (files.length) {
    lines.push('## Documents', '');
    for (const file of files) {
      lines.push(...block(file.name, file.updatedAt, file.content, 'markdown'));
    }
  }

  return lines.join('\n');
}

/** `d3sign-session-2026-08-28.md` — a date is enough to tell two dumps apart. */
export function dumpFileName(now = Date.now()) {
  return `d3sign-session-${new Date(now).toISOString().slice(0, 10)}.md`;
}
