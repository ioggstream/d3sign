import { describe, it, expect } from 'vitest';
import { iconDataUri, resolveIconName } from '../src/viz/icons.js';

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
  it('substitutes the tint and percent-encodes the svg', () => {
    const uri = iconDataUri(ICON_SET, 'DigitalArtifact', '#4c6ef5');
    expect(uri.startsWith('data:image/svg+xml;utf8,')).toBe(true);
    const svg = decodeURIComponent(uri.slice('data:image/svg+xml;utf8,'.length));
    expect(svg).toContain('viewBox="0 0 24 24"');
    // Without an intrinsic size the browser sizes the SVG against the viewport,
    // so the rasterized icon drifts as the graph is zoomed.
    expect(svg).toContain('width="24" height="24"');
    expect(svg).toContain('fill="#4c6ef5"');
    expect(svg).not.toContain('currentColor');
    // A raw '#' would end the URL at the colour.
    expect(uri).not.toContain('#');
  });

  it('is undefined for an unknown icon', () => {
    expect(iconDataUri(ICON_SET, 'Nope', '#000')).toBeUndefined();
    expect(iconDataUri(null, 'DigitalArtifact', '#000')).toBeUndefined();
  });
});
