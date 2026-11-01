import { ROUTE_DECLARATION_FILE_NAME } from "./route-declaration";

/**
 * A tsconfig read off disk, described only by the keys this package writes. The
 * rest of the document is the project's, is never read here, and is carried through
 * to the written file unchanged.
 */
export type TsConfigDocument = {
  compilerOptions?: Record<string, unknown>;
  include?: unknown;
  [key: string]: unknown;
};

/**
 * Where the `@/*` alias has to point for the layout being configured. The pages,
 * the entry script, and the generated declaration all hang off that one rule, so
 * it is stated once instead of being re-derived by every writer.
 */
export function aliasTarget(src: boolean): string {
  return src ? "./src/*" : "./*";
}

/**
 * The include entries this package is allowed to rewrite: what either layout
 * writes, plus the spellings that mean the same folder. Everything else in the list
 * was put there by the project.
 *
 * Dropping the other layout's entries is not a loss. The root-level layout compiles
 * through recursive globs, which already reach a `src` folder, and the `src` layout
 * has no use for a list that spans the whole tree - it would start compiling the
 * Vite config and whatever the build emitted.
 */
const MANAGED_INCLUDE_ENTRIES = new Set<string>([
  "src",
  "./src",
  "./**/*.ts",
  "./**/*.tsx",
  ROUTE_DECLARATION_FILE_NAME,
  `src/${ROUTE_DECLARATION_FILE_NAME}`,
]);

/** What one layout needs from `include`, and nothing more. */
function routerIncludeEntries(src: boolean): string[] {
  return src
    ? ["src"]
    : ["./**/*.ts", "./**/*.tsx", ROUTE_DECLARATION_FILE_NAME];
}

/**
 * Add the router's alias without touching the project's own.
 *
 * A path map is the application's business: a scaffold that assigns its own
 * single entry to it deletes the aliases the code is still importing, and the
 * breakage shows up in the editor and at build time rather than in the CLI's
 * output. So this is a merge, with ours last - the alias the router needs wins if
 * the project happened to define it differently, because nothing else here can
 * resolve the generated pages.
 */
export function withRouterAlias(tsConfig: TsConfigDocument, src: boolean): void {
  const compilerOptions: Record<string, unknown> = tsConfig.compilerOptions ?? {};
  const existing = compilerOptions.paths;

  // Anything that is not a map (an array, a string) is a document TypeScript
  // itself rejects, so there is no project intent to preserve in it.
  const aliases =
    existing !== undefined &&
    existing !== null &&
    typeof existing === "object" &&
    !Array.isArray(existing)
      ? (existing as Record<string, unknown>)
      : {};

  compilerOptions.paths = { ...aliases, "@/*": [aliasTarget(src)] };
  tsConfig.compilerOptions = compilerOptions;
}

/**
 * Make `include` hold what the layout needs, keeping what the project added.
 *
 * Replacing the whole list is how a project loses the folders it was already
 * compiling. Leaving everything the router wrote is equally wrong, in the other
 * direction: switching between the `src` and the root-level layout would otherwise
 * keep both vocabularies in the list forever. So the router's entries lead, the
 * other layout's are dropped, and the rest of the list is the project's to keep -
 * which is also what a repeated run leaves exactly as it was.
 */
export function withRouterInclude(tsConfig: TsConfigDocument, src: boolean): void {
  const wanted = routerIncludeEntries(src);
  const existing = tsConfig.include;

  // Nothing to keep when the key is absent, and a list TypeScript itself would
  // reject is not a list to merge.
  if (existing === undefined || !Array.isArray(existing)) {
    tsConfig.include = wanted;
    return;
  }

  const kept: unknown[] = [];
  for (const entry of existing) {
    const managed = typeof entry === "string" && MANAGED_INCLUDE_ENTRIES.has(entry);
    if (!managed && !kept.includes(entry)) kept.push(entry);
  }

  tsConfig.include = [...wanted, ...kept];
}
