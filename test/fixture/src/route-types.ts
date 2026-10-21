// The ambient module comes from ./virtual.d.ts in this project, and from the
// declaration passed on the command line when the test suite compiles this file
// against a freshly generated one.
import { href, useCatchAll } from "virtual:next-vite-router";
import type {
  RouteLinkProps,
  RouteParams,
  RoutePath,
} from "virtual:next-vite-router";

const home = "/" satisfies RoutePath;
const user = "/users/:id" satisfies RoutePath;
const post = "/posts/:slug" satisfies RoutePath;
const docs = "/docs" satisfies RoutePath;
const docsCatchAll = "/docs/*" satisfies RoutePath;

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
const docsHref: string = href("/docs/*", { segments: "guide/api" });
const docsBaseHref: string = href("/docs/*", {});
const usersHref: string = href("/users");
const homeHref: string = href("/");

const profileLink: RouteLinkProps = {
  to: "/users/:id",
  params: { id: "123" },
  children: "Profile",
};
const blogLink: RouteLinkProps = {
  to: "/blog/*",
  params: { slug: "guide/api" },
  className: "post-link",
};
const usersLink: RouteLinkProps = { to: "/users" };

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
void docsHref;
void docsBaseHref;
void usersHref;
void homeHref;
void profileLink;
void blogLink;
void usersLink;
void catchAllHook;