/*
 * Testing Library, with `render` drawing a screen as MobileApp does: inside the
 * Android app's PhonePlatform (src/phone/platform.js, mobile/src/platform.js).
 * A test that mocks ../open.js sees its mock called by the screen's Open.
 */
import { createElement } from 'react';
import { render as draw } from '@testing-library/react';
import { PhonePlatform } from '@shared/phone/platform.js';
import { ANDROID_PLATFORM } from '../platform.js';

export * from '@testing-library/react';

const Android = ({ children }) => createElement(PhonePlatform, { value: ANDROID_PLATFORM }, children);

export function render(ui, options) {
  return draw(ui, { wrapper: Android, ...options });
}
