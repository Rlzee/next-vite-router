import { useParams } from "react-router-dom";

export default function DynamicRouteExample() {
  const { id } = useParams();
  return (
    <section>
      <h2>Dynamic routes</h2>
      <p>The current id is: {id}</p>
    </section>
  );
}
