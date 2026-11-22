import React from "react";

export type RenderContextValue = Readonly<{
  owner?: string;
  phase: "page" | "fallback";
  fallbackOwner?: string;
  parentOwner?: string;
}>;

export const RenderContext = React.createContext<RenderContextValue | undefined>(undefined);

export function useRenderContext(): RenderContextValue | undefined {
  return React.useContext(RenderContext);
}

export function readRenderContext(): RenderContextValue | undefined {
  try {
    return useRenderContext();
  } catch {
    return undefined;
  }
}
