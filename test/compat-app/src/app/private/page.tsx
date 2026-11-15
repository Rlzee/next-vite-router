import { redirect } from "next-vite-router/routes";

// 307 on the server, with `location` and no body.
export default function Private() {
  redirect("/login");
}