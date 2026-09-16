/**
 * Plain node runs the TypeScript harnesses, with one resolver hook.
 *
 *     node --import ./tests/node_ts.mjs tests/layout_node.mjs < cases.json
 *
 * Node has stripped types itself since 22.18, so `import "../loader/src/tiles.ts"`
 * needs no loader. What it does not do is what tsc and vite do without being
 * asked: the sources import each other as `../core/errors.js`, the name the
 * compiled file will have, and no such file exists in loader/src/. This hook is that
 * one rewrite - when a `.js` specifier resolves to nothing, try `.ts` - and
 * nothing else. It is the whole of what vite-node was doing for these tests,
 * which is why vite-node is not a dependency any more (2026-09-16).
 *
 * Registered from the file itself: `--import` loads it on the main thread,
 * where it registers itself as the hooks module; node then loads it again on
 * the hooks thread, where it must only export the hook.
 */
import { register } from 'node:module';
import { isMainThread } from 'node:worker_threads';

if (isMainThread) register(import.meta.url);

export async function resolve(specifier, context, next) {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (error?.code === 'ERR_MODULE_NOT_FOUND' && specifier.endsWith('.js')) {
      return next(`${specifier.slice(0, -3)}.ts`, context);
    }
    throw error;
  }
}
