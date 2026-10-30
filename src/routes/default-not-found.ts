import React from "react";

/**
 * The package's built-in 404 page: the answer for a URL the route tree owns no
 * content at, in an app that declares no `not-found.tsx` anywhere. Next.js
 * paints its own default page for that shape; until now this package painted
 * the layouts above an empty content area, which reads as a broken page rather
 * than as a 404.
 *
 * Deliberately minimal: no stylesheet, no theme, no link, nothing to load. The
 * text is the one Next.js uses, in an `h1`/`p` pair so a reader and a crawler
 * both get the status before the styling question comes up, and the sizes are
 * left to the browser defaults so a layout's own typography already applies. The
 * container is `minHeight: "100vh"`, not `height`, because the page renders
 * *inside* the app's layouts: a fixed height would overflow a viewport already
 * holding a header and a footer.
 *
 * It sits at the bottom of the fallback chain - the folder's own `not-found`,
 * else the nearest ancestor's, else this - so one `not-found.tsx` anywhere
 * replaces it outright; the chain in `converter.ts` is what applies that order.
 *
 * Not exported from the package root on purpose: it is a fallback the converter
 * owns, not an API an application imports.
 */
export function DefaultNotFound(): React.ReactNode {
  return React.createElement(
    "div",
    { style: { minHeight: "100vh", display: "flex", alignItems: "center" } },
    React.createElement(
      "h1",
      { style: { margin: 0, padding: "0 16px 0 0", borderRight: "1px solid currentColor" } },
      "404",
    ),
    React.createElement(
      "p",
      { style: { margin: 0, padding: "0 0 0 16px" } },
      "This page could not be found.",
    ),
  );
}
