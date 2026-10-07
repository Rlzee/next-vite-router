import { useParams as useReactRouterParams } from "react-router-dom";
import { useCatchAllParam } from "./router-params-context";

export function useParams<T extends Record<string, string | undefined> = Record<string, string | undefined>>(): T {
  const params = useReactRouterParams();
  const catchAllParam = useCatchAllParam();

  if (typeof catchAllParam === "string" && params["*"] !== undefined) {
    return { ...params, [catchAllParam]: params["*"] } as T;
  }

  return params as T;
}
