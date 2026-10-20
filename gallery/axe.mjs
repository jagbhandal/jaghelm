/*
 * The gallery's axe check (#289, docs/GALLERY.md): every rule axe runs by
 * default, on the whole document, the portal roots at the end of <body>
 * included, with exactly two exceptions, each scoped to Base UI's own markup.
 * Both come from Base UI, not from JagHelm's components; revisit both when
 * Base UI is upgraded, and drop either once axe passes without it.
 * gallery.spec.mjs proves each is narrow: an element of the same kind that
 * isn't Base UI's still fails.
 */
import AxeBuilder from '@axe-core/playwright';

/**
 * `aria-hidden-focus` skips only Base UI's focus guards: the spans its focus
 * manager puts around an open Select's list, `aria-hidden` with `tabindex="0"`
 * by design (floating-ui's pattern). A guard hands focus on the moment it
 * gets it, so nobody rests on it, and Base UI gives it role="button" for
 * VoiceOver, whose virtual cursor would otherwise skip it. A violation is
 * skipped only when the element axe names is itself a guard.
 */
export const FOCUS_GUARD = '[data-base-ui-focus-guard]';

/**
 * `region` counts the Select's list as a region. Base UI portals the list to
 * the end of <body>, outside every landmark, like any of its popups; a
 * dialog's popup (role dialog) and the toasts (a region) already count, the
 * tooltips are hidden from assistive tech, and this is the one left. Only the
 * Select's popup (`data-slot="select-popup"`, src/ui/select.jsx) is added, to
 * axe's own default list (AXE_REGION_DEFAULT), never portals as a whole.
 */
export const SELECT_LIST = '[data-slot="select-popup"]';

/** axe's own `regionMatcher` for the region check (axe-core 4.13), kept as is. */
export const AXE_REGION_DEFAULT = 'dialog, [role=dialog], [role=alertdialog], svg';

/** The axe violations on `page`, one line per element, after the two exceptions. */
export async function axeFindings(page) {
  const { violations } = await new AxeBuilder({ page })
    .options({
      rules: {
        region: {
          checks: {
            region: { options: { regionMatcher: `${AXE_REGION_DEFAULT}, ${SELECT_LIST}` } },
          },
        },
      },
    })
    .analyze();
  const found = [];
  for (const v of violations) {
    for (const n of v.nodes) {
      if (v.id === 'aria-hidden-focus' && (await isOnly(page, n.target, FOCUS_GUARD))) continue;
      found.push(`${v.id} (${v.impact}): ${n.target.join(' ')}: ${n.failureSummary}`);
    }
  }
  return found;
}

/** Whether the one element `target` names (in the page, not a frame) matches `selector`. */
async function isOnly(page, target, selector) {
  if (target.length !== 1 || typeof target[0] !== 'string') return false;
  return page.evaluate(
    ([css, sel]) => {
      const els = document.querySelectorAll(css);
      return els.length === 1 && els[0].matches(sel);
    },
    [target[0], selector]
  );
}
