import { redirect } from "next-vite-router/routes";

export default function Private() {
  redirect("/redirect/login");
}
