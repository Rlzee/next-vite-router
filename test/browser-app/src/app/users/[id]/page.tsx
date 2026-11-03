import { useParams } from "next-vite-router/routes";

type Params = { id: string };

// A dynamic segment read through the package hook, so the value the URL carries
// has survived mounting, lazy loading and a reload of the deep URL.
export default function UserPage() {
  const { id } = useParams<Params>();
  return <div data-testid="user-page">{`USER:${id}`}</div>;
}
