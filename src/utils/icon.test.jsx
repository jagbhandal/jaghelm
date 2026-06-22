import { describe, it, expect } from 'vitest';
import { iconImageSrc, isEmoji } from './icon.jsx';

describe('iconImageSrc', () => {
  it('returns null for emoji and empty values (render as text)', () => {
    expect(iconImageSrc('⚡')).toBeNull();
    expect(iconImageSrc('')).toBeNull();
    expect(iconImageSrc(null)).toBeNull();
    expect(iconImageSrc(undefined)).toBeNull();
  });

  it('resolves a bare slug to a CDN image (not text)', () => {
    const src = iconImageSrc('gitea');
    expect(src).toBeTruthy();
    const decoded = decodeURIComponent(src);
    expect(decoded).toContain('homarr-labs/dashboard-icons');
    expect(decoded).toContain('/gitea.svg');
  });

  it('strips an image extension so a filename does not double-extension', () => {
    const decoded = decodeURIComponent(iconImageSrc('gitea.svg'));
    expect(decoded).toContain('/gitea.svg');
    expect(decoded).not.toContain('gitea.svg.svg');
  });

  it('lower-cases a slug for the CDN', () => {
    expect(decodeURIComponent(iconImageSrc('Gitea'))).toContain('/gitea.svg');
  });

  it('routes a full CDN url through the cache proxy', () => {
    const src = iconImageSrc(
      'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons@latest/svg/plex.svg'
    );
    expect(src).toContain('/api/icons/cached');
  });
});

describe('isEmoji', () => {
  it('detects emoji and rejects urls/slugs', () => {
    expect(isEmoji('🚀')).toBeTruthy();
    expect(isEmoji('gitea')).toBeFalsy();
    expect(isEmoji('https://x/y.svg')).toBeFalsy();
    expect(isEmoji('/local/path.svg')).toBeFalsy();
  });
});
