import { Outlet } from "react-router-dom";

// A nested layout with `lazyLayouts` on, so Vite emits it as its own chunk. The
// suite proves both halves: the marker is absent from the entry chunk and present
// in another one, and the browser still paints it after that chunk arrives.
export default function ShopLayout() {
  return (
    <div data-testid="shop-layout">
      {"SHOP-LAYOUT["}
      <Outlet />
      {"]SHOP-LAYOUT"}
    </div>
  );
}
