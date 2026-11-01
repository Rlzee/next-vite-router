/**
 * Remove comments and trailing commas from a JSON document so `JSON.parse` can
 * read it. tsconfig files are JSON with comments, and TypeScript also accepts a
 * comma before a closing bracket, so both have to go before parsing.
 *
 * The document is scanned character by character instead of rewritten with
 * regular expressions, because a marker is not a comment while it sits inside a
 * string: it is data, and a text-only rule corrupts the document around it. The
 * two tsconfig shapes that were destroyed this way - an alias beside a glob, and
 * a URL - are named at the branch that now keeps them, and only as line comments:
 * a block comment cannot hold either marker.
 *
 * Strings are therefore copied verbatim, escape by escape, and only the text seen
 * outside a string is allowed to start a comment.
 */
export function stripJsonComments(jsonString: string): string {
  let stripped = "";
  let index = 0;
  // Only `"` opens a string in JSON; a single quote is an ordinary character.
  let inString = false;
  // Where the last comma written outside a string sits in `stripped`. Whether
  // that comma is a trailing one can only be told from what follows it, so it is
  // remembered until the bracket closes.
  let commaIndex = -1;

  while (index < jsonString.length) {
    const character = jsonString[index];
    const following = jsonString[index + 1];

    if (inString) {
      if (character === "\\") {
        // An escape consumes whatever comes next: `\"` stays inside the string
        // rather than closing it, and the `\\` of `"\\"` is not a marker either.
        stripped += character + (following ?? "");
        index += following === undefined ? 1 : 2;
        continue;
      }
      if (character === '"') inString = false;
      stripped += character;
      index += 1;
      continue;
    }

    if (character === '"') {
      inString = true;
      commaIndex = -1;
      stripped += character;
      index += 1;
      continue;
    }

    if (character === "/" && following === "/") {
      // A line comment ends at the line break, and the break itself is kept: it
      // is what separates the removed comment from the next property. The same
      // two slashes inside a string are data, so a "$schema" URL such as
      // "https://json.schemastore.org/tsconfig" keeps its whole value - under a
      // rule that only reads text, everything after the protocol would go.
      index += 2;
      while (index < jsonString.length && jsonString[index] !== "\n") index += 1;
      continue;
    }

    if (character === "/" && following === "*") {
      // A block comment is only a block comment when the pair is visible outside
      // a string. An alias "@/*" and a glob "src/**/*.ts" in one document are not
      // one: read as a pair they delete everything between them, which is the
      // alias, the settings, and most of the file.
      //
      // An unterminated block comment swallows the rest of the document, which is
      // what TypeScript itself makes of it too.
      index += 2;
      while (
        index < jsonString.length &&
        !(jsonString[index] === "*" && jsonString[index + 1] === "/")
      ) {
        index += 1;
      }
      // Step over the closing "*/", or past the end when there is none.
      index += 2;
      continue;
    }

    if (character === ",") {
      commaIndex = stripped.length;
      stripped += character;
      index += 1;
      continue;
    }

    if (character === "}" || character === "]") {
      // A comma is trailing only now that its bracket is in sight, and only when
      // the gap between them held nothing but whitespace - including a comment
      // removed above, whose text is gone but whose surrounding blanks stay.
      const gap = commaIndex === -1 ? null : stripped.slice(commaIndex + 1);
      if (gap !== null && gap.trim() === "") {
        stripped = stripped.slice(0, commaIndex) + gap;
      }
      commaIndex = -1;
    } else if (character.trim() !== "") {
      // Any other token is a value that follows the comma, so it was not trailing.
      commaIndex = -1;
    }

    stripped += character;
    index += 1;
  }

  return stripped;
}
