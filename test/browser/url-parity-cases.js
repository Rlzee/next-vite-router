/**
 * The corpus for the server / browser / mounted-app differential
 * (`url-parity.spec.js`).
 *
 * One entry per request target, carrying three hand-written expectations that
 * come from different places on purpose:
 *
 * - `pathname` - what a URL parser must make of the target. The spec collides it
 *   against `normalizeRequestTarget()` in Node *and* against `location.pathname`
 *   in Chromium, so neither the package's hand-resolved branch nor a browser's
 *   parser can drift without one of them disagreeing with this file;
 * - `status` - what an SSR server must commit for that exact target, which the
 *   spec then collides against the same rule read from the browser's own
 *   `location.pathname` and its absolute `location.href`;
 * - `testid` / `text` (or `notFound`) - what the hydrated application paints.
 *
 * `status: 200` beside a page marker is the pair that matters: a target the
 * server calls a page has to paint that page in the browser, and one it calls a
 * 404 has to paint the 404 there too. A drift is a document streamed as one page
 * and rendered as another.
 *
 * Two groups are deliberately absent, both because the tab cannot be sent there:
 *
 * - Not request targets on this origin - `mailto:`, `ftp://`, a foreign
 *   `file://`, a protocol-relative `//host/path`. A tab asked for one leaves the
 *   site, so the browser leg has nothing to measure; they are pinned in Node in
 *   `test/routes.test.js`, together with the 404 they must never talk their way
 *   out of.
 * - Paths whose own escape survives to the request line (`/users/%FF`,
 *   `/docs/ok/%FF/ok`, `/docs/%FF/.`). Vite's dev middleware and its preview
 *   static handler decode the whole URL and answer 500 before the application
 *   boots, so the parity cannot be measured through either server - it belongs to
 *   the server the reader writes, which reads `req.url` raw and is what
 *   `test/routes.test.js` asserts against. A target whose escape the parser has
 *   already *resolved away* (`/users/%FF/..`, below) does reach the app, and is
 *   the case this battery can still judge.
 *
 * `skipIn` marks the same limit where it only closes one pipeline.
 */

/** The heading of the package's built-in 404 page; this fixture declares none. */
export const NOT_FOUND = "This page could not be found";

export const CASES = [
  // The plain readings, with the two parts a server drops before it matches.
  { target: "/", pathname: "/", status: 200, testid: "home-page", text: "HOME" },
  { target: "/users/42", pathname: "/users/42", status: 200, testid: "user-page", text: "USER:42" },
  { target: "/users/42?tag=a", pathname: "/users/42", status: 200, testid: "user-page", text: "USER:42" },
  { target: "/users/42#frag", pathname: "/users/42", status: 200, testid: "user-page", text: "USER:42" },
  // A malformed escape in the *query* is nobody's business but the query's, and
  // the page still answers. Only Vite's dev middleware disagrees, by 500ing on
  // the whole URL before the app exists; the production server ships it fine.
  {
    target: "/users/42?tag=%zz",
    pathname: "/users/42",
    status: 200,
    testid: "user-page",
    text: "USER:42",
    skipIn: { dev: "Vite's dev middleware decodes the request target including its query and answers 500 before the app boots." },
  },
  // A trailing slash is kept by both readings, and the router still answers.
  { target: "/shop/", pathname: "/shop/", status: 200, testid: "shop-page", text: "SHOP-PAGE" },

  // Dot segments. A browser resolves them before it puts anything on the wire, so
  // an SSR server handed the raw string by a proxy has to land on the same leaf -
  // or it streamed a document hydration then paints differently.
  { target: "/users/other/../42", pathname: "/users/42", status: 200, testid: "user-page", text: "USER:42" },
  { target: "/shop/../users/42", pathname: "/users/42", status: 200, testid: "user-page", text: "USER:42" },
  // A dot segment at the end of the path leaves its slash behind - the URL spec's
  // rule, and the one the hand-resolved branch is most likely to lose.
  { target: "/shop/cart/..", pathname: "/shop/", status: 200, testid: "shop-page", text: "SHOP-PAGE" },
  { target: "/a/../../x", pathname: "/x", status: 404, notFound: true },
  // Dot segments cannot pop past the root.
  { target: "/../../x", pathname: "/x", status: 404, notFound: true },

  // Encoded dots are dots: the same pop, and the same 404 when the popped folder
  // was the only thing that could answer. Nothing of the escape survives to the
  // request line, so both servers deliver these.
  { target: "/docs/%2e%2e/users/42", pathname: "/users/42", status: 200, testid: "user-page", text: "USER:42" },
  { target: "/users/%2e%2e/42", pathname: "/42", status: 404, notFound: true },
  { target: "/users/%2e/42", pathname: "/users/42", status: 200, testid: "user-page", text: "USER:42" },
  // The escape survives here only as a dot segment the parser resolves away, so
  // this is the hand branch's trailing-slash rule, measured against a browser.
  { target: "/users/%FF/..", pathname: "/users/", status: 404, notFound: true },

  // A character the browser must encode, and an escape it must not decode: the
  // path that reaches the page is the encoded one on both sides.
  { target: "/users/hello world", pathname: "/users/hello%20world", status: 200, testid: "user-page", text: "USER:hello world" },
  { target: "/users/a%2Fb", pathname: "/users/a%2Fb", status: 200, testid: "user-page", text: "USER:a/b" },

  // Empty segments are content for a catch-all, and `useCatchAll()` drops the one
  // the double slash adds without dropping the segments around it.
  { target: "/docs/a//b", pathname: "/docs/a//b", status: 200, testid: "docs-page", text: "DOCS{a|b}" },
  { target: "/docs/guide/api", pathname: "/docs/guide/api", status: 200, testid: "docs-page", text: "DOCS{guide|api}" },

  // Two URLs a server calls a 404 and a client must too: a folder that holds no
  // page, and a path whose case no folder declares (the converter stamps every
  // route case-sensitive, so it is a 404 both sides and never a borrowed page).
  { target: "/users", pathname: "/users", status: 404, notFound: true },
  { target: "/USERS/42", pathname: "/USERS/42", status: 404, notFound: true },

  // A page that throws is still a page: the status is a routing answer, so the
  // server streams 200 with the folder's `error.tsx` inside it, and hydration has
  // to paint that same screen rather than deciding the URL is a 404.
  { target: "/broken", pathname: "/broken", status: 200, testid: "broken-error", text: "BROKEN-ERROR" },
];
