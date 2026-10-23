/**
 * Asks for the phone's detail screens' chunk ahead of the first detail
 * (#309, PhoneDetail.jsx): PhoneView once the browser is idle after the
 * screens draw, App at once beside them when the URL already names an entity
 * (a deep link, a push), so the sheet doesn't wait for two chunks in a row.
 * It loads once; React.lazy then finds it in. A failed load is left to the
 * lazy view, which reports it when a detail is drawn (chunkReload.js).
 */
import { loadPhoneDetail } from '../lazyViews.js';

export function preloadPhoneDetail() {
  Promise.resolve(loadPhoneDetail()).catch(() => {});
}
