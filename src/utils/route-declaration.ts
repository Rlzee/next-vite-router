/**
 * The declaration file the Vite plugin writes beside the pages directory, and the
 * scaffold creates before the first build. One definition, because a generated
 * file that the plugin and the CLI name differently is a file the application
 * either inherits twice or never sees.
 *
 * Named after the module it declares - `next-vite-router/routes` - and not after
 * the `virtual:next-vite-router` specifier that 3.0.0 retired.
 */
export const ROUTE_DECLARATION_FILE_NAME = "routes.d.ts";

/**
 * Names this package wrote that declaration under before. A leftover copy declares
 * the same ambient module a second time and TypeScript merges the bodies, so every
 * type alias inside reports `TS2300: Duplicate identifier` - or, under the
 * `skipLibCheck` most Vite applications turn on, silently keeps the older union in
 * the editor instead of the current one.
 */
export const LEGACY_ROUTE_DECLARATION_FILE_NAMES: readonly string[] = [
  "virtual-next-vite-router.d.ts",
];

/**
 * First line of every declaration this package emits: the proof of authorship
 * required before a file in the application's tree is overwritten or deleted.
 */
export const ROUTE_DECLARATION_MARKER = "declare module 'next-vite-router/routes'";
