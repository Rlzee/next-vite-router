/// <reference path="./virtual-next-vite-router.d.ts" />

import type {
  RouteParams,
  RoutePath,
} from "virtual:next-vite-router";

const home = "/" satisfies RoutePath;
const user = "/users/:id" satisfies RoutePath;
const post = "/posts/:slug" satisfies RoutePath;

const userParams: RouteParams<typeof user> = {
  id: "123",
};

const postParams: RouteParams<typeof post> = {
  slug: "hello-world",
};

void home;
void userParams;
void postParams;