import { Outlet } from "react-router-dom";

export default function LayoutExampleLayout() {
  return (
    <section style={{ border: "2px solid #7c3aed", padding: "1rem" }}>
      <strong>Layouts example: nested layout active</strong>
      <Outlet />
    </section>
  );
}
