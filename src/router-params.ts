import { useMatches, useParams as useReactRouterParams } from "react-router-dom";

export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T {
  const params = useReactRouterParams();
  const matches = useMatches();
  const catchAllMatch = [...matches]
    .reverse()
    .find((match) => typeof (match.handle as { catchAllParam?: unknown } | undefined)?.catchAllParam === "string");
  const catchAllParam = (catchAllMatch?.handle as { catchAllParam?: unknown } | undefined)?.catchAllParam;

  if (typeof catchAllParam === "string" && params["*"] !== undefined) {
    return { ...params, [catchAllParam]: params["*"] } as T;
  }

  return params as T;
}
