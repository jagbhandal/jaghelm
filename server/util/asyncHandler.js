/**
 * Wrap an async Express route handler so rejections forward to `next(err)`.
 *
 * Express 4 does NOT auto-forward promise rejections. Without this wrapper,
 * an unhandled `await` rejection inside a route silently kills the request
 * lifecycle and the client hangs until its own timeout.
 *
 *   router.get('/x', asyncHandler(async (req, res) => { ... }));
 *
 * The wrapper preserves arity so Express still treats it as a regular
 * (req, res, next) handler. The returned value of `fn` is discarded — handlers
 * are expected to call `res.json` / `res.send` themselves; the resolved value
 * is only used to detect successful completion.
 */

export function asyncHandler(fn) {
  return function asyncHandlerWrapped(req, res, next) {
    // try/catch around the call covers the case where someone hands us a
    // non-async function that throws synchronously — without it, that throw
    // would escape before Promise.resolve gets a chance to catch it. Express
    // already catches sync throws in handlers itself, so this is defence in
    // depth, not strictly required.
    let p;
    try {
      p = fn(req, res, next);
    } catch (err) {
      return next(err);
    }
    Promise.resolve(p).catch(next);
  };
}
