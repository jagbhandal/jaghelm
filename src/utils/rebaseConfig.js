/**
 * Rebase a device's display config onto a newer server copy (#547).
 *
 * A device saves its whole display config over the version it last read. When
 * another device saved in between, the save is refused (409) and the device
 * reads the server's copy again. Throwing its own edit away would undo what
 * the user just did (a switch flipped saves on its own), and posting its
 * whole copy would undo the other device's. So it keeps only what IT changed
 * since the copy it read, leaf by leaf, on top of the new copy.
 *
 * A leaf is a value that is not a plain object: a scalar, null or an array
 * (a layout, the links, the tabs: an array is replaced whole). Plain objects
 * recurse, so two devices that switch different sections in
 * `overviewSections` both keep their switch. A leaf both changed takes this
 * device's value: its save is the later one. A key this device removed is
 * removed.
 */

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** Whether `a` and `b` hold the same JSON value. */
export function sameConfig(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a)) {
    return (
      Array.isArray(b) && a.length === b.length && a.every((value, i) => sameConfig(value, b[i]))
    );
  }
  if (!isObject(a) || !isObject(b)) return false;
  const keys = Object.keys(a);
  return (
    keys.length === Object.keys(b).length &&
    keys.every((key) => Object.hasOwn(b, key) && sameConfig(a[key], b[key]))
  );
}

/**
 * `fresh` with the leaves `local` changed from `base` laid over it: what the
 * device saves after a refused save. `base` is the server copy the device
 * last read (null or anything but an object: none, so every leaf of `local`
 * is its own), `local` the device's config now, `fresh` the server's copy
 * now. None of them is changed.
 */
export function rebaseConfig(base, local, fresh) {
  const from = isObject(base) ? base : {};
  const out = isObject(fresh) ? { ...fresh } : {};
  for (const key of Object.keys(local)) {
    const had = Object.hasOwn(from, key);
    if (had && sameConfig(local[key], from[key])) continue;
    const mine = local[key];
    out[key] =
      isObject(mine) && (!had || isObject(from[key]))
        ? rebaseConfig(from[key], mine, out[key])
        : mine;
  }
  for (const key of Object.keys(from)) {
    if (!Object.hasOwn(local, key)) delete out[key];
  }
  return out;
}
