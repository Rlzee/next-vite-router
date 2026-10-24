// The ambient module comes from ./virtual.d.ts in this project, and from the
// declaration passed on the command line when the test suite compiles this file
// against a freshly generated one.
import { href, useCatchAll } from "virtual:next-vite-router";
import type {
  LinkProps,
  RouteParams,
  RoutePath,
} from "virtual:next-vite-router";

// The plugin also serves these helpers under `next-vite-router/routes`, so app
// code can import them without the "virtual:" prefix; it is the same module.
import { href as routesHref } from "next-vite-router/routes";
import type { RoutePath as RoutesPath } from "next-vite-router/routes";

const home = "/" satisfies RoutePath;
const user = "/users/:id" satisfies RoutePath;
const post = "/posts/:slug" satisfies RoutePath;
const docs = "/docs" satisfies RoutePath;
const docsCatchAll = "/docs/*" satisfies RoutePath;

// A pattern and an href resolved through the subpath alias type-check the same.
const aliasPath = "/users/:id" satisfies RoutesPath;
const aliasHref: string = routesHref("/blog/*", { slug: "guide/api" });

const userParams: RouteParams<typeof user> = {
  id: "123",
};

const postParams: RouteParams<typeof post> = {
  slug: "hello-world",
};

const docsParams: RouteParams<typeof docs> = {};
const docsCatchAllParams: RouteParams<typeof docsCatchAll> = {};

// `href` turns a pattern into a URL, and its second argument is only optional
// when the pattern carries no parameter.
const userHref: string = href("/users/:id", { id: "123" });
const blogHref: string = href("/blog/*", { slug: "guide/api" });
// A catch-all also takes the segment array `useCatchAll()` returns, so a read and
// a link build share one value.
const blogHrefFromSegments: string = href("/blog/*", { slug: ["guide", "api"] });
const docsBaseFromSegments: string = href("/docs/*", { segments: [] });
const docsHref: string = href("/docs/*", { segments: "guide/api" });
const docsBaseHref: string = href("/docs/*", {});
const usersHref: string = href("/users");
const homeHref: string = href("/");

// `Link` is the Next.js spelling: the pattern goes in `href`.
const profileLinkWithHref: LinkProps = {
  href: "/users/:id",
  params: { id: "123" },
  children: "Profile",
};
const blogLinkWithHref: LinkProps = {
  href: "/blog/*",
  params: { slug: "guide/api" },
  className: "post-link",
};
const usersLinkWithHref: LinkProps = { href: "/users" };

// Checked as a value, not called: a catch-all is a string in `useParams` and an
// array in `useCatchAll`.
const catchAllHook: (name?: string) => string[] = useCatchAll;

void home;
void userParams;
void postParams;
void docsParams;
void docsCatchAllParams;
void userHref;
void blogHref;
void blogHrefFromSegments;
void docsBaseFromSegments;
void docsHref;
void docsBaseHref;
void usersHref;
void homeHref;
void profileLinkWithHref;
void blogLinkWithHref;
void usersLinkWithHref;
void catchAllHook;
void aliasPath;
void aliasHref;