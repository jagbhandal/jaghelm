import { describe, it, expect } from 'vitest';
import { portalRootProps } from './portal.js';

// #688: every overlay (Confirm, Select, Popover, Tooltip...) takes its portal
// root's props from portalRootProps, so where it portals to is decided here once.
// ui/confirm.test.jsx draws a Confirm inside an open native dialog end to end;
// the others share this function and are not each rendered in a sheet.

describe('portalRootProps: where an overlay is drawn', () => {
  const inside = (html, selector = 'button') => {
    document.body.innerHTML = html;
    return document.querySelector(selector);
  };

  it('inside an open native dialog (the phone sheet): into that dialog', () => {
    const anchor = inside('<dialog open><div><button>a</button></div></dialog>');
    expect(portalRootProps(anchor).container).toBe(document.querySelector('dialog'));
  });

  it('with the UiRoot switches given too', () => {
    const anchor = inside('<dialog open><button>a</button></dialog>');
    expect(portalRootProps(anchor, { theme: 'light' }).container).toBe(document.querySelector('dialog'));
  });

  it('on the page, or in a dialog that is not open: the default (the end of the body)', () => {
    expect(portalRootProps(inside('<main><button>a</button></main>')).container).toBeUndefined();
    expect(portalRootProps(inside('<dialog><button>a</button></dialog>')).container).toBeUndefined();
    expect(portalRootProps(null).container).toBeUndefined();
  });
});
