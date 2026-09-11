import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { parseDocument } from '../src/parser/document.js';
import { expandDocument } from '../src/parser/templates.js';

const examplesDir = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../src/data/examples');

describe('005-templates example', () => {
  it('expands without warnings', () => {
    const md = readFileSync(path.join(examplesDir, '005-templates.md'), 'utf-8');
    const { diagrams } = parseDocument(md, { defaultDiagramId: 'current' });
    const { diagrams: expanded, warnings } = expandDocument(diagrams);
    const astWarnings = expanded.flatMap((d) => d.ast?.warnings || []);
    console.log('WARNINGS', warnings, astWarnings);
    console.log('EXPANDED', expanded.map((d) => d.expandedSource).filter(Boolean).join('\n---\n'));
    expect(warnings).toEqual([]);
  });
});
