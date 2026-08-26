import YAML from 'yaml';

/**
 * Splits a mermaid source string into { frontmatter, body }.
 * Frontmatter is the optional `---\n...\n---` block at the top.
 */
export function splitFrontmatter(source) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source);
  if (!match) {
    return { frontmatter: {}, body: source };
  }
  let frontmatter = {};
  try {
    frontmatter = YAML.parse(match[1]) ?? {};
  } catch {
    frontmatter = {};
  }
  return { frontmatter, body: source.slice(match[0].length) };
}
