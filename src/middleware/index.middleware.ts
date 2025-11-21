import type { ReactElement } from 'react';
import type { RouteMiddleware } from '../index';

type MiddlewareConfig = {
  pattern: RegExp;
  middleware: RouteMiddleware;
}

let middlewareConfigs: MiddlewareConfig[] = [];

export function registerMiddleware(pattern: RegExp, middleware: RouteMiddleware): void {
  middlewareConfigs.push({ pattern, middleware });
}

export function clearMiddlewares(): void {
  middlewareConfigs = [];
}

export function getMiddlewares(): MiddlewareConfig[] {
  return middlewareConfigs;
}

export function applyMiddlewares(path: string, element: ReactElement): ReactElement {
  let result = element;
  
  for (const config of middlewareConfigs) {
    if (config.pattern.test(path)) {
      result = config.middleware(result);
    }
  }
  
  return result;
}