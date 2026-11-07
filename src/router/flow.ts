import {
  readRenderContext,
  type RenderSignal,
} from "./render-outcome";

const signalBrand: unique symbol = Symbol("next-vite-router.flow-signal");

export class NotFoundSignal extends Error {
  readonly [signalBrand] = "not-found" as const;
  readonly owner: string;
  readonly reentrant: boolean;

  constructor(owner: string, reentrant = false) {
    super("NEXT_VITE_ROUTER_NOT_FOUND");
    this.name = "NotFoundSignal";
    this.owner = owner;
    this.reentrant = reentrant;
  }
}

export class RedirectSignal extends Error {
  readonly [signalBrand] = "redirect" as const;
  readonly to: string;
  readonly permanent: boolean;
  readonly replace: boolean;

  constructor(to: string, permanent: boolean, replace: boolean) {
    super("NEXT_VITE_ROUTER_REDIRECT");
    this.name = "RedirectSignal";
    this.to = to;
    this.permanent = permanent;
    this.replace = replace;
  }
}

function renderSignal(signal: RenderSignal, context: ReturnType<typeof readRenderContext>): never {
  if (!context) {
    throw new Error("next-vite-router flow control can only be used during route rendering");
  }

  if (signal.kind === "not-found") {
    context.outcome?.recordSignal(signal, context.phase);
    throw new NotFoundSignal(signal.owner, signal.reentrant);
  }

  context.outcome?.recordSignal(signal, context.phase);
  throw new RedirectSignal(signal.to, signal.permanent, signal.replace);
}

export function notFound(): never {
  const context = readRenderContext();
  if (!context?.owner) {
    throw new Error("next-vite-router notFound() can only be used during route rendering");
  }

  const reentrant = context.phase === "fallback";
  return renderSignal({
    kind: "not-found",
    owner: context.owner,
    reentrant,
  }, context);
}

export type RedirectOptions = { replace?: boolean };

function redirectTo(
  to: string | URL,
  permanent: boolean,
  options?: RedirectOptions,
): never {
  return renderSignal({
    kind: "redirect",
    to: String(to),
    permanent,
    replace: options?.replace === true,
  }, readRenderContext());
}

export function redirect(to: string | URL, options?: RedirectOptions): never {
  return redirectTo(to, false, options);
}

export function permanentRedirect(to: string | URL, options?: RedirectOptions): never {
  return redirectTo(to, true, options);
}

export function isNotFoundSignal(value: unknown): value is NotFoundSignal {
  return typeof value === "object"
    && value !== null
    && (value as { [signalBrand]?: unknown })[signalBrand] === "not-found";
}

export function isRedirectSignal(value: unknown): value is RedirectSignal {
  return typeof value === "object"
    && value !== null
    && (value as { [signalBrand]?: unknown })[signalBrand] === "redirect";
}

export function isRenderSignal(
  value: unknown,
): value is NotFoundSignal | RedirectSignal {
  return isNotFoundSignal(value) || isRedirectSignal(value);
}
