# Examples

This is one runnable Vite app with five route examples:

- `src/app/basic` — the smallest file-based route;
- `src/app/layouts` — a nested `layout.tsx` and `Outlet`;
- `src/app/dynamic-routes` — a `[id]` segment and `useParams`;
- `src/app/middleware` — the route intended for middleware experiments;
- `src/app/typed-routes` — the generated `RoutePath` type.

Run it from this directory:

```bash
pnpm install
pnpm dev
```

The `predev` script builds the package first, so the example works directly
from a checkout.
