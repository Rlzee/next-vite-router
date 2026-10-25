import { createElement as h } from "react";
import { useParams } from "next-vite-router/routes";

export default function UserDetail() {
  const { id } = useParams<{ id: string }>();
  return h("div", { "data-page": "detail" }, `detail:${id ?? "?"}`);
}
