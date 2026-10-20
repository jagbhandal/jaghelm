/**
 * What a Field (field.jsx) and the controls inside it tell each other, however
 * deeply a control is wrapped. A Field labels its control with a <label>,
 * except around a control a <label> doesn't fit:
 *
 *  - a Select, whose list a click on its <label> would open;
 *  - a SegmentedControl, a group of radios that a <label> can't point at. Its
 *    label names the group, as a fieldset's legend does (the mock's own is a
 *    <span>).
 *
 * Such a control calls `useNoLabelElement()`, and the Field renders its label
 * as a <div>. Base UI still names the control with it, and a click on it
 * focuses a Select's trigger.
 */
import { createContext, useContext, useLayoutEffect } from 'react';

/** Set by a Field around its control; null outside one. */
export const FieldContext = createContext(null);

/** True inside a Field. */
export const useInsideField = () => useContext(FieldContext) !== null;

/** Asks the Field around this control, if any, to label it with a <div>, not a <label>. */
export function useNoLabelElement() {
  const field = useContext(FieldContext);
  useLayoutEffect(() => {
    if (!field) return undefined;
    field.reportNoLabelElement(1);
    return () => field.reportNoLabelElement(-1);
  }, [field]);
}
