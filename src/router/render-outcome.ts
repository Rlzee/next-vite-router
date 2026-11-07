import React from "react";

export type PreparedRequest = Readonly<{
  pathname: string;
  search: string;
  hash: string;
}>;

export type RenderSignal =
  | Readonly<{ kind: "not-found"; owner: string; reentrant: boolean }>
  | Readonly<{ kind: "redirect"; to: string; permanent: boolean; replace: boolean }>;

export interface RenderOutcome {
  readonly request: PreparedRequest;
  readonly signal: RenderSignal | null;
  readonly reentrantSignal: RenderSignal | null;
  readonly failure: Readonly<{ error: unknown; pass: 1 | 2 | 3 }> | null;
  readonly committed: boolean;
  readonly degraded: boolean;
  recordSignal(signal: RenderSignal, phase: "page" | "fallback"): void;
  recordFailure(error: unknown, pass: 1 | 2 | 3): void;
  markCommitted(): void;
}

export type RenderPhase = "page" | "fallback";

export type RenderContextValue = Readonly<{
  outcome?: RenderOutcome;
  owner?: string;
  phase: RenderPhase;
}>;

export const RenderContext = React.createContext<RenderContextValue | undefined>(undefined);

export function createRenderOutcome(request: PreparedRequest): RenderOutcome {
  let signal: RenderSignal | null = null;
  let reentrantSignal: RenderSignal | null = null;
  let failure: RenderOutcome["failure"] = null;
  let committed = false;
  let degraded = false;

  return {
    request,
    get signal() {
      return signal;
    },
    get reentrantSignal() {
      return reentrantSignal;
    },
    get failure() {
      return failure;
    },
    get committed() {
      return committed;
    },
    get degraded() {
      return degraded;
    },
    recordSignal(nextSignal, phase) {
      if (phase === "fallback") {
        if (reentrantSignal === null) {
          reentrantSignal = nextSignal;
          if (committed) degraded = true;
        }
        return;
      }
      if (signal === null) {
        signal = nextSignal;
        if (committed) degraded = true;
      }
    },
    recordFailure(error, pass) {
      if (failure === null) {
        failure = { error, pass };
        if (committed) degraded = true;
      }
    },
    markCommitted() {
      committed = true;
    },
  };
}

export function useRenderContext(): RenderContextValue | undefined {
  return React.useContext(RenderContext);
}

export function readRenderContext(): RenderContextValue | undefined {
  return React.useContext(RenderContext);
}

export function useRenderOutcome(): RenderOutcome | undefined {
  return useRenderContext()?.outcome;
}

export function useNotFoundOwner(): string | undefined {
  return useRenderContext()?.owner;
}

export function useRenderPhase(): RenderPhase | undefined {
  return useRenderContext()?.phase;
}
