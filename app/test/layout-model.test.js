import { describe, it, expect } from 'vitest';
import {
  COLUMN_COUNT,
  LAYOUT_VERSION,
  columnOfView,
  createDefaultLayout,
  isViewVisible,
  migrate,
  moveView,
  moveViewBy,
  renderedFractions,
  setActiveTab,
  setWeights,
} from '../src/layout/model.js';

// A stand-in for layout/views.js: the model only ever reads `id`,
// `defaultColumn` and `defaultActive`, so the real registry's DOM hooks are
// beside the point here.
const VIEWS = [
  { id: 'editor', defaultColumn: 0 },
  { id: 'trig', defaultColumn: 2 },
  { id: 'preview', defaultColumn: 2 },
  { id: 'graph', defaultColumn: 2, defaultActive: true },
  { id: 'query', defaultColumn: 2 },
];

const ids = (layout) => layout.columns.map((c) => c.views);

describe('createDefaultLayout', () => {
  it('places every view in the column its registry entry asks for', () => {
    const layout = createDefaultLayout(VIEWS);
    expect(layout.columns).toHaveLength(COLUMN_COUNT);
    expect(ids(layout)).toEqual([['editor'], [], ['trig', 'preview', 'graph', 'query']]);
  });

  it('honours defaultActive over tab order', () => {
    const layout = createDefaultLayout(VIEWS);
    expect(layout.columns[2].active).toBe('graph');
    expect(layout.activeView).toBe('graph');
  });

  it('leaves an empty column with no active tab', () => {
    expect(createDefaultLayout(VIEWS).columns[1].active).toBeNull();
  });

  it('reproduces the 25/75 split the app used to boot with', () => {
    expect(renderedFractions(createDefaultLayout(VIEWS))).toEqual([0.25, 0, 0.75]);
  });
});

describe('columnOfView / isViewVisible', () => {
  const layout = createDefaultLayout(VIEWS);

  it('finds a view, and reports -1 for one it does not hold', () => {
    expect(columnOfView(layout, 'editor')).toBe(0);
    expect(columnOfView(layout, 'graph')).toBe(2);
    expect(columnOfView(layout, 'nope')).toBe(-1);
  });

  it('counts only the active tab of each column as visible', () => {
    expect(isViewVisible(layout, 'editor')).toBe(true);
    expect(isViewVisible(layout, 'graph')).toBe(true);
    expect(isViewVisible(layout, 'query')).toBe(false);
  });
});

describe('renderedFractions', () => {
  it('gives an empty column exactly zero and shares its width out', () => {
    const layout = createDefaultLayout(VIEWS);
    const fractions = renderedFractions(layout);
    expect(fractions[1]).toBe(0);
    expect(fractions.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });

  it('re-splits when a column stops being empty', () => {
    const layout = moveView(createDefaultLayout(VIEWS), 'trig', 1);
    const fractions = renderedFractions(layout);
    expect(fractions.every((f) => f > 0)).toBe(true);
    expect(fractions.reduce((a, b) => a + b, 0)).toBeCloseTo(1);
  });
});

describe('setActiveTab', () => {
  it('shows the tab and makes it the move target', () => {
    const layout = setActiveTab(createDefaultLayout(VIEWS), 'query');
    expect(layout.columns[2].active).toBe('query');
    expect(layout.activeView).toBe('query');
    expect(isViewVisible(layout, 'graph')).toBe(false);
  });

  it('ignores a view it does not hold', () => {
    const before = createDefaultLayout(VIEWS);
    expect(setActiveTab(before, 'nope')).toBe(before);
  });
});

describe('moveView', () => {
  it('moves the view and shows it in its new column', () => {
    const layout = moveView(createDefaultLayout(VIEWS), 'query', 0);
    expect(ids(layout)[0]).toEqual(['editor', 'query']);
    expect(layout.columns[0].active).toBe('query');
    expect(layout.columns[2].views).not.toContain('query');
  });

  it('does not mutate the layout it was given', () => {
    const before = createDefaultLayout(VIEWS);
    moveView(before, 'query', 0);
    expect(ids(before)).toEqual([['editor'], [], ['trig', 'preview', 'graph', 'query']]);
  });

  it('falls back to the neighbouring tab when the active one leaves', () => {
    // ['trig', 'preview', 'graph', 'query'], 'graph' active at index 2.
    const layout = moveView(createDefaultLayout(VIEWS), 'graph', 0);
    expect(layout.columns[2].active).toBe('query');
  });

  it('falls back to the last tab when the active one was last', () => {
    let layout = setActiveTab(createDefaultLayout(VIEWS), 'query');
    layout = moveView(layout, 'query', 0);
    expect(layout.columns[2].active).toBe('graph');
  });

  it('leaves an emptied column with no active tab', () => {
    const layout = moveView(createDefaultLayout(VIEWS), 'editor', 2);
    expect(layout.columns[0].views).toEqual([]);
    expect(layout.columns[0].active).toBeNull();
    expect(renderedFractions(layout)[0]).toBe(0);
  });

  it('only re-selects when the target is the column it is already in', () => {
    const layout = moveView(createDefaultLayout(VIEWS), 'query', 2);
    expect(ids(layout)[2]).toEqual(['trig', 'preview', 'graph', 'query']);
    expect(layout.columns[2].active).toBe('query');
  });

  it('ignores a view it does not hold', () => {
    const before = createDefaultLayout(VIEWS);
    expect(moveView(before, 'nope', 0)).toBe(before);
  });
});

describe('moveViewBy', () => {
  it('clamps at both ends rather than wrapping', () => {
    const layout = createDefaultLayout(VIEWS);
    expect(columnOfView(moveViewBy(layout, 'editor', -1), 'editor')).toBe(0);
    expect(columnOfView(moveViewBy(layout, 'graph', 1), 'graph')).toBe(2);
  });

  it('steps one column at a time', () => {
    const layout = moveViewBy(createDefaultLayout(VIEWS), 'editor', 1);
    expect(columnOfView(layout, 'editor')).toBe(1);
  });
});

describe('setWeights', () => {
  it('records a drag against the non-empty columns', () => {
    const layout = setWeights(createDefaultLayout(VIEWS), [0.4, 0, 0.6]);
    expect(renderedFractions(layout)).toEqual([0.4, 0, 0.6]);
  });

  it('leaves an empty column its remembered weight, so docking back is predictable', () => {
    const before = createDefaultLayout(VIEWS);
    const after = setWeights(before, [0.4, 0.9, 0.6]);
    expect(after.columns[1].weight).toBe(before.columns[1].weight);
  });

  it('ignores non-finite and non-positive values', () => {
    const before = createDefaultLayout(VIEWS);
    const after = setWeights(before, [NaN, 1, -3]);
    expect(after.columns[0].weight).toBe(before.columns[0].weight);
    expect(after.columns[2].weight).toBe(before.columns[2].weight);
  });
});

describe('migrate', () => {
  const saved = () => JSON.parse(JSON.stringify(createDefaultLayout(VIEWS)));

  it('round-trips a layout this build wrote', () => {
    const before = moveView(createDefaultLayout(VIEWS), 'trig', 1);
    expect(migrate(JSON.parse(JSON.stringify(before)), VIEWS)).toEqual(before);
  });

  it('falls back to the default for nothing stored', () => {
    expect(migrate(null, VIEWS)).toEqual(createDefaultLayout(VIEWS));
  });

  it.each([
    ['a bumped version', { ...saved(), version: LAYOUT_VERSION + 1 }],
    ['a missing columns array', { version: LAYOUT_VERSION }],
    ['the wrong number of columns', { version: LAYOUT_VERSION, columns: [{ views: [] }] }],
    ['a column that is not a group', { version: LAYOUT_VERSION, columns: [null, null, null] }],
    ['a string', 'nonsense'],
  ])('falls back to the default for %s', (_label, value) => {
    expect(migrate(value, VIEWS)).toEqual(createDefaultLayout(VIEWS));
  });

  it('drops a view id this build no longer has', () => {
    const stored = saved();
    stored.columns[0].views.push('gone');
    expect(migrate(stored, VIEWS).columns[0].views).toEqual(['editor']);
  });

  it('places a view added since the layout was saved, and shows it', () => {
    const stored = saved();
    const views = [...VIEWS, { id: 'timeline', defaultColumn: 1 }];
    const layout = migrate(stored, views);
    expect(layout.columns[1].views).toEqual(['timeline']);
    expect(layout.columns[1].active).toBe('timeline');
  });

  it('keeps a duplicated id in one column only', () => {
    const stored = saved();
    stored.columns[0].views.push('graph');
    const layout = migrate(stored, VIEWS);
    expect(layout.columns[0].views).toEqual(['editor', 'graph']);
    expect(layout.columns[2].views).not.toContain('graph');
  });

  it('repairs an active tab that is no longer in its column', () => {
    const stored = saved();
    stored.columns[0].active = 'graph';
    expect(migrate(stored, VIEWS).columns[0].active).toBe('editor');
  });

  it('repairs an unusable weight', () => {
    const stored = saved();
    stored.columns[0].weight = 0;
    stored.columns[2].weight = 'wide';
    const layout = migrate(stored, VIEWS);
    expect(renderedFractions(layout)).toEqual([0.25, 0, 0.75]);
  });

  it('repairs an activeView this build no longer has', () => {
    const stored = saved();
    stored.activeView = 'gone';
    expect(migrate(stored, VIEWS).activeView).toBe('graph');
  });
});
