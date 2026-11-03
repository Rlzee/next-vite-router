import { Link } from "next-vite-router/routes";

export default function ShopPage() {
  return (
    <div data-testid="shop-page">
      {"SHOP-PAGE "}
      <Link href="/shop/cart" data-testid="nav-shop-cart">cart</Link>
    </div>
  );
}
