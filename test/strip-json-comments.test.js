import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, describe, test } from "node:test";
import { pathToFileURL } from "node:url";

// ---------------------------------------------------------------------------
// `stripJsonComments` is a CLI internal: it parses the tsconfig of the project
// being configured, and is published in no entry point. So the suite compiles the
// one source file it owns and loads the result - reaching the shipped logic
// instead of a copy of it, the way `test-route-types.js` reaches the bundled
// TypeScript compiler.
// ---------------------------------------------------------------------------

const tscEntry = path.resolve("node_modules", "typescript", "bin", "tsc");
const emitDir = fs.mkdtempSync(path.join(os.tmpdir(), "nvr-strip-emit-"));
// An emitted `.js` in a temp directory is CommonJS to Node unless a manifest says
// otherwise, and this suite reads it with `import`.
fs.writeFileSync(path.join(emitDir, "package.json"), '{"type":"module"}\n', "utf8");

const compiled = spawnSync(process.execPath, [
  tscEntry,
  path.resolve("src", "utils", "strip-json-comments.ts"),
  "--outDir", emitDir,
  // Without it the emitted file would land under a copied `src/utils` tree.
  "--rootDir", path.resolve("src", "utils"),
  "--module", "esnext",
  "--target", "ES2020",
  "--strict",
  "--skipLibCheck",
], { encoding: "utf8" });

assert.equal(
  compiled.status,
  0,
  `tsc could not compile src/utils/strip-json-comments.ts:\n${compiled.stdout}${compiled.stderr}`,
);

const { stripJsonComments } = await import(
  pathToFileURL(path.join(emitDir, "strip-json-comments.js")).href
);

after(() => fs.rmSync(emitDir, { recursive: true, force: true }));

/**
 * Strip a document the way the CLI does before it parses a project's tsconfig,
 * and report on the text itself when the result cannot be parsed - the failure is
 * the damage done to the document, not the parse error alone.
 */
function parse(strippedOf) {
  const stripped = stripJsonComments(strippedOf);
  try {
    return JSON.parse(stripped);
  } catch (error) {
    assert.fail(
      `the stripped document is not valid JSON (${error.message}):\n` +
      `${"-".repeat(40)}\n${stripped}\n${"-".repeat(40)}`,
    );
  }
}

describe("stripJsonComments: strings that look like comments", () => {
  // The shape a root-level `app/` layout leaves behind, and the one a
  // hand-written alias carries: the `/*` of an alias and the `*/` of a glob are
  // not a pair.
  test("keeps an alias whose slash-star is followed by a glob's star-slash", () => {
    const document = `{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"],
      "@components/*": ["./src/components/*"]
    }
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"]
}`;

    assert.deepEqual(parse(document), {
      compilerOptions: {
        paths: {
          "@/*": ["./src/*"],
          "@components/*": ["./src/components/*"],
        },
      },
      include: ["src/**/*.ts", "src/**/*.tsx"],
    });
  });

  test("keeps a URL, whose protocol slashes end no line", () => {
    const document = `{
  "$schema": "https://json.schemastore.org/tsconfig",
  "homepage": "https://example.com/docs#/*anchor",
  "compilerOptions": { "strict": true }
}`;

    assert.deepEqual(parse(document), {
      $schema: "https://json.schemastore.org/tsconfig",
      homepage: "https://example.com/docs#/*anchor",
      compilerOptions: { strict: true },
    });
  });

  test("keeps comment markers written as data, escapes and all", () => {
    const document = `{
  "block": "/* not a comment */",
  "line": "// not a comment either",
  "escapedSlash": "a\\/*b",
  "quote": "she said \\"keep the @/* alias\\" and escaped it",
  "backslash": "C:\\\\path\\\\",
  "trailingCommaText": "a, } is punctuation, not JSON"
}`;

    assert.deepEqual(parse(document), {
      block: "/* not a comment */",
      line: "// not a comment either",
      // `\/` is an escape of a slash, so the pair cannot open a comment and the
      // scan must not treat the slash as a marker after consuming it.
      escapedSlash: "a/*b",
      quote: 'she said "keep the @/* alias" and escaped it',
      backslash: "C:\\path\\",
      trailingCommaText: "a, } is punctuation, not JSON",
    });
  });
});

describe("stripJsonComments: real comments and trailing commas", () => {
  test("removes line and block comments and parses what is left", () => {
    const document = `// a leading comment
{
  /* a block comment
     over several lines */
  "compilerOptions": {
    "target": "ES2020", // a comment after a value
    /* a comment on its own line */
    "strict": true,
  },
  "include": ["src",],
  "tailwind": true /* after a value, before the end */,
}`;

    assert.deepEqual(parse(document), {
      compilerOptions: { target: "ES2020", strict: true },
      include: ["src"],
      tailwind: true,
    });
  });

  test("keeps the line break that separates a removed comment from the next value", () => {
    // Two line comments in a row: each ends at its own break, so the second one's
    // text is removed as a comment and never as the start of a property.
    const document = `{
  // first
  // second
  "a": 1
}`;

    assert.deepEqual(parse(document), { a: 1 });
  });

  test("removes a trailing comma that a comment separates from its bracket", () => {
    assert.deepEqual(parse(`{"a": [1, /* done */], "b": 2,}`), {
      a: [1],
      b: 2,
    });
  });

  test("keeps a comma that turns out to be followed by a value", () => {
    assert.deepEqual(parse(`{"a": [1, 2], "b": {"c": 1, "d": 2}}`), {
      a: [1, 2],
      b: { c: 1, d: 2 },
    });
  });

  test("parses the tsconfig of a project that has all of it at once", () => {
    // `$schema`, a real comment, an alias, a glob, and a trailing comma in the
    // same document - the file the CLI setup is expected to read without dying.
    const document = `{
  "$schema": "https://json.schemastore.org/tsconfig",
  // Built by the framework, edited by nobody.
  "compilerOptions": {
    "jsx": "react-jsx",
    "paths": {
      "@/*": ["./src/*"],
    },
    "types": ["vite/client"],
  },
  "include": ["src/**/*.ts", "src/**/*.tsx"],
}
`;

    const config = parse(document);
    assert.equal(config.$schema, "https://json.schemastore.org/tsconfig");
    assert.deepEqual(config.compilerOptions.paths["@/*"], ["./src/*"]);
    assert.deepEqual(config.include, ["src/**/*.ts", "src/**/*.tsx"]);
  });
});

describe("stripJsonComments: what the scan leaves untouched", () => {
  test("returns a plain JSON document unchanged", () => {
    const document = `{
  "compilerOptions": {
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}`;

    assert.equal(stripJsonComments(document), document);
  });

  test("tolerates an unterminated block comment and an empty document", () => {
    // Everything after the marker is comment, and the file has nothing else to
    // say; repairing it is not this helper's job.
    assert.deepEqual(parse('{"a": 1} /* never closed\n'), { a: 1 });
    assert.equal(stripJsonComments(""), "");
  });
});
