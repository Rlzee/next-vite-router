import { readRenderContext } from "./render-context";

const signalBrand: unique symbol = Symbol("next-vite-router.flow-signal");

export class NotFoundSignal extends Error {
  readonly [signalBrand] = "not-found" as const;

  constructor(readonly owner: string) {
    super("NEXT_VITE_ROUTER_NOT_FOUND");
    this.name = "NotFoundSignal";
  }
}

export class RedirectSignal extends Error {
  readonly [signalBrand] = "redirect" as const;

  constructor(
    readonly to: string,
    readonly permanent: boolean,
    readonly replace: boolean,
  ) {
    super("NEXT_VITE_ROUTER_REDIRECT");
    this.name = "RedirectSignal";
  }
}

export function notFound(): never {
  const context = readRenderContext();
  if (!context?.owner) {
    throw new Error("next-vite-router notFound() can only be used during route rendering");
  }
  if (context.phase === "fallback" && context.owner === "/"
    && (context.fallbackOwner === undefined || context.fallbackOwner === "/")) {
    throw new Error("next-vite-router notFound() cannot re-enter the root fallback");
  }
  throw new NotFoundSignal(context.owner);
}

export type RedirectOptions = { replace?: boolean };

function redirectTo(to: string | URL, permanent: boolean, options?: RedirectOptions): never {
  if (!readRenderContext()) {
    throw new Error("next-vite-router flow control can only be used during route rendering");
  }
  throw new RedirectSignal(String(to), permanent, options?.replace === true);
}

export function redirect(to: string | URL, options?: RedirectOptions): never {
  return redirectTo(to, false, options);
}

export function permanentRedirect(to: string | URL, options?: RedirectOptions): never {
  return redirectTo(to, true, options);
}

export function isNotFoundSignal(value: unknown): value is NotFoundSignal {
  return typeof value === "object" && value !== null
    && (value as { [signalBrand]?: unknown })[signalBrand] === "not-found";
}

export function isRedirectSignal(value: unknown): value is RedirectSignal {
  return typeof value === "object" && value !== null
    && (value as { [signalBrand]?: unknown })[signalBrand] === "redirect";
}

export function isRenderSignal(value: unknown): value is NotFoundSignal | RedirectSignal {
  return isNotFoundSignal(value) || isRedirectSignal(value);
}
