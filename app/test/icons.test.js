import { describe, it, expect } from 'vitest';
import {
  composeIconBody,
  composeIconUri,
  iconDataUri,
  resolveIconName,
  withScopedIds,
} from '../src/viz/icons.js';

// Mirrors ioggstream/d3fend-icons' icons.json: its key set as of 2026-08-03,
// with stub bodies. Held locally rather than fetched, so the tests neither hit
// the network nor fail when the set upstream grows — the names are what the
// resolution logic turns on, and the bodies only have to carry `currentColor`.
const ICON_NAMES = [
  'User',
  'UserAccount',
  'PrivilegedUserAccount',
  'DigitalArtifact',
  'DefensiveTechnique',
  'OffensiveTechnique',
  'CodeRepository',
  'StaticAnalysisTool',
  'CredentialScrubbing',
  'AssetVulnerabilityEnumeration',
  'DynamicAnalysisTool',
  'TestRunner',
  'FileFormatVerification',
  'Credential',
  'PrivateKey',
  'PublicKey',
  'Password',
  'MultiFactorAuthentication',
  'ServiceApplication',
  'AccessControlConfiguration',
  'Software',
  'Process',
  'CodeAnalyzer',
];

const ICON_SET = {
  prefix: 'd3f',
  width: 24,
  height: 24,
  icons: Object.fromEntries(
    ICON_NAMES.map((name) => [name, { body: '<path fill="currentColor" d="M6 2h7v5h5z"/>' }]),
  ),
};

describe('resolveIconName', () => {
  it('takes an exact D3FEND local name', () => {
    expect(resolveIconName(ICON_SET, 'CodeRepository')).toBe('CodeRepository');
  });

  it('walks up to the nearest ancestor that has an icon', () => {
    // File → Resource → DigitalInformationBearer → DigitalArtifact
    expect(resolveIconName(ICON_SET, 'File')).toBe('DigitalArtifact');
  });

  it('returns undefined for a class with no icon above it', () => {
    expect(resolveIconName(ICON_SET, 'D3FENDCore')).toBeUndefined();
  });

  it('returns undefined for a name outside the ontology', () => {
    expect(resolveIconName(ICON_SET, 'NotAClass')).toBeUndefined();
  });

  it('is safe without a set, and without a name', () => {
    expect(resolveIconName(null, 'File')).toBeUndefined();
    expect(resolveIconName(ICON_SET, undefined)).toBeUndefined();
  });
});

describe('iconDataUri', () => {
  it('tints through the root colour and percent-encodes the svg', () => {
    const uri = iconDataUri(ICON_SET, 'DigitalArtifact', '#4c6ef5');
    expect(uri.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    const svg = decodeURIComponent(uri.slice('data:image/svg+xml;utf8,'.length));
    expect(svg).toContain('viewBox="0 0 24 24"');
    // Without an intrinsic size the browser sizes the SVG against the viewport,
    // so the rasterized icon drifts as the graph is zoomed.
    expect(svg).toContain('width="24" height="24"');
    // The tint is an inherited property on the root, and the body keeps saying
    // `currentColor` — which is what lets a compound icon's mask override it with
    // its own black. Substituting the string instead left the mask nothing to
    // shadow and turned the cut-out into a ghost.
    expect(svg).toContain('color="#4c6ef5"');
    expect(svg).toContain('fill="currentColor"');
    // A raw '#' would end the URL at the colour.
    expect(uri).not.toContain('#');
  });

  it('is undefined for an unknown icon', () => {
    expect(iconDataUri(ICON_SET, 'Nope', '#000')).toBeUndefined();
    expect(iconDataUri(null, 'DigitalArtifact', '#000')).toBeUndefined();
  });
});

/** The same set with some icons replaced, for the cases the flat stub cannot say. */
const setWith = (overrides) => ({
  ...ICON_SET,
  icons: { ...ICON_SET.icons, ...overrides },
});

/**
 * An icon the upstream builder already shipped compound: it brings its own
 * `<mask>`, and so its own id, into whatever we compose it into.
 */
const COMPOUND_BODY =
  '<defs><mask id="compound-mask-x"><rect fill="white"/>' +
  '<path fill="currentColor" d="M1 1h2z"/></mask></defs>' +
  '<g mask="url(#compound-mask-x)"><path fill="currentColor" d="M3 3h4z"/></g>';

const decode = (uri) => decodeURIComponent(uri.slice('data:image/svg+xml;utf8,'.length));

describe('withScopedIds', () => {
  it('renames every id and the references to it', () => {
    const scoped = withScopedIds(COMPOUND_BODY, 'c');
    expect(scoped).toContain('id="compound-mask-x__c"');
    expect(scoped).toContain('url(#compound-mask-x__c)');
    expect(scoped).not.toContain('url(#compound-mask-x)');
  });

  it('leaves a body with no ids alone', () => {
    const plain = '<path fill="currentColor" d="M6 2h7v5h5z"/>';
    expect(withScopedIds(plain, 'b')).toBe(plain);
  });
});

describe('composeIconBody', () => {
  // ServiceApplication is in BADGE_CLASSES, CodeRepository is not: the pair the
  // feature exists for, standing in for a class D3FEND does not define. It draws
  // as a code repository badged as an application.
  const PAIR = ['ServiceApplication', 'CodeRepository'];

  it('badges the thing a node is with what it is served as', () => {
    const { body, width, height } = composeIconBody(ICON_SET, PAIR);
    expect(width).toBe(24);
    expect(height).toBe(24);
    expect(body).toContain('<mask id="d3sign-badge"');
    // Upstream's geometry to the last float, so a compound this composes and one
    // the icon set ships ready-made are the same picture.
    expect(body).toContain('translate(9.600000000000001 9.600000000000001) scale(0.6)');
    expect(body).toContain('stroke-width="5"');
  });

  it('does not depend on the order the classes arrive in', () => {
    // They arrive in the N3 store's order, which interns terms across the whole
    // document — so it reflects the other nodes in the diagram, not this one.
    expect(composeIconBody(ICON_SET, PAIR)).toEqual(composeIconBody(ICON_SET, [...PAIR].reverse()));
  });

  it('keeps the cut-out black while the icon is tinted', () => {
    const svg = decode(composeIconUri(ICON_SET, PAIR, '#4c6ef5'));
    // The whole reason the tint is a root property. Were `currentColor`
    // substituted, these paths would carry the tint, `color="black"` would have
    // nothing to resolve, and the mask would render at the tint's luminance —
    // a ghost of the badge instead of a hole for it.
    expect(svg).toContain('color="black"');
    expect(svg).toContain('color="#4c6ef5"');
    const mask = svg.slice(svg.indexOf('<mask'), svg.indexOf('</mask>'));
    expect(mask).toContain('fill="currentColor"');
  });

  it('draws one icon when both classes resolve to the same one', () => {
    // File and Directory both walk up to DigitalArtifact. A glyph must never be
    // stamped on itself as its own badge.
    const both = composeIconBody(ICON_SET, ['File', 'Directory']);
    expect(both.body).not.toContain('<mask');
    expect(both).toEqual(composeIconBody(ICON_SET, ['File']));
  });

  it('compounds whether or not BADGE_CLASSES tells the two apart', () => {
    // BADGE_CLASSES ranks; it does not gate. Its entries are high in their
    // subtrees, so most of D3FEND inherits from one — requiring exactly one class
    // to match would have refused most real pairs and drawn a single icon.
    // Both inside the list: the earlier entry badges.
    expect(composeIconBody(ICON_SET, ['Process', 'ServiceApplication']).body).toContain('<mask');
    // Neither in it: the general class badges the specific one.
    expect(composeIconBody(ICON_SET, ['CodeRepository', 'Password']).body).toContain('<mask');
  });

  it('draws the specific class and badges it with the listed one', () => {
    const set = setWith({
      ServiceApplication: { body: '<path fill="currentColor" d="M1 1h2z"/>' },
      CodeRepository: { body: '<path fill="currentColor" d="M3 3h4z"/>' },
    });
    const { body } = composeIconBody(set, PAIR);
    // The repository is the picture; being served as an application is the note
    // in the corner. Same way round as the combinations the icon set itself
    // names — DatabaseServiceApplication is database_{application-outline}.
    expect(body).toMatch(/mask="url\(#d3sign-badge\)"><path fill="currentColor" d="M3 3h4z"/);
    expect(body.lastIndexOf('d="M1 1h2z"')).toBeGreaterThan(body.lastIndexOf('d="M3 3h4z"'));
  });

  it('ignores a class the icon set cannot resolve, rather than failing', () => {
    expect(composeIconBody(ICON_SET, ['ServiceApplication', 'D3FENDCore'])).toEqual(
      composeIconBody(ICON_SET, ['ServiceApplication']),
    );
    expect(composeIconBody(ICON_SET, ['D3FENDCore'])).toBeUndefined();
    expect(composeIconBody(null, PAIR)).toBeUndefined();
    expect(composeIconBody(ICON_SET, [])).toBeUndefined();
  });

  it('ignores the third class and beyond', () => {
    expect(composeIconBody(ICON_SET, [...PAIR, 'User'])).toEqual(composeIconBody(ICON_SET, PAIR));
  });

  it('keeps every id unique when both icons are themselves compound', () => {
    const set = setWith({
      ServiceApplication: { body: COMPOUND_BODY },
      CodeRepository: { body: COMPOUND_BODY },
    });
    const { body } = composeIconBody(set, PAIR);
    const ids = [...body.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]);
    // Three copies of a compound body in one document — the cut-out, the drawn
    // badge and the base. Duplicate ids are not an error in SVG: the browser
    // silently resolves url(#x) to the first, which is the one inside the mask.
    expect(ids.length).toBe(4);
    expect(new Set(ids).size).toBe(ids.length);
    for (const ref of body.matchAll(/url\(#([^)]+)\)/g)) expect(ids).toContain(ref[1]);
  });

  it('scales the badge and its halo onto a base of another size', () => {
    // CodeRepository is the one that draws the glyph, so it carries the base box.
    const set = setWith({
      CodeRepository: { body: '<path fill="currentColor" d="M0 0h1z"/>', width: 48, height: 48 },
      ServiceApplication: { body: '<path fill="currentColor" d="M0 0h2z"/>', width: 16, height: 16 },
    });
    const { body, width, height } = composeIconBody(set, PAIR);
    // Composed onto the base's box, so the base needs no transform of its own and
    // the result still declares an intrinsic size.
    expect(width).toBe(48);
    expect(height).toBe(48);
    const [, tx, ty, k] = body.match(/translate\(([\d.]+) ([\d.]+)\) scale\(([\d.]+)\)/);
    expect(Number(k)).toBeCloseTo(1.8);
    expect(Number(tx)).toBeCloseTo(19.2);
    expect(Number(ty)).toBeCloseTo(19.2);
    // stroke-width sits on the group that also carries scale(k), so the halo the
    // user sees is stroke-width * k — held at 3 units of a 24-box either way.
    const stroke = Number(body.match(/stroke-width="([\d.]+)"/)[1]);
    expect(stroke * Number(k)).toBeCloseTo(3 * (48 / 24));
  });
});
