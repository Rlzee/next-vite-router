import { permanentRedirect } from "next-vite-router/routes";

export default function Archived() {
  permanentRedirect("/redirect/login", { replace: true });
}
