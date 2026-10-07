import React, { createContext, useContext } from "react";

export const CatchAllParamContext = createContext<string | undefined>(undefined);

export function CatchAllParamProvider({
  name,
  children,
}: {
  name: string;
  children: React.ReactElement;
}): React.ReactElement {
  return React.createElement(
    CatchAllParamContext.Provider,
    { value: name },
    children,
  );
}

export function useCatchAllParam(): string | undefined {
  return useContext(CatchAllParamContext);
}
