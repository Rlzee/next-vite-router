import { permanentRedirect } from "next-vite-router/routes";

// 308 on the server, with `location` and no body.
export default function Old() {
  permanentRedirect("/login");
}