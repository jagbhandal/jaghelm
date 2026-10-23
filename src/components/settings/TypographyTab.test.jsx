import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import TypographyTab from './TypographyTab.jsx';
import { ConfigProvider } from '../../context/ConfigContext.jsx';

// Settings → Appearance's font, Typography's before #317 (#306): the font presets for Settings itself, until
// #321 brings the typeface and one text size. The per-element font sizes
// sized the old board's panels, which are gone, so they go too.
describe('Settings → Appearance, Font Family', () => {
  it('has the presets, the default the app’s own face, and no font-size sliders', () => {
    render(
      <ConfigProvider config={{ fontSizes: { sectionTitle: 20 } }} setConfig={vi.fn()}>
        <TypographyTab />
      </ConfigProvider>
    );
    expect(screen.getByText('Manrope + JetBrains Mono')).toBeInTheDocument();
    expect(screen.queryByText('Font Sizes')).toBeNull();
    expect(screen.queryByRole('slider')).toBeNull();
    expect(screen.queryByRole('button', { name: /Reset All Sizes/ })).toBeNull();
  });
});
