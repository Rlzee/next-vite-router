import { useNavigate } from "react-router-dom";
import { useAuth } from "../../../auth";

export default function DashboardPage() {
  const { logout } = useAuth();
  const navigate = useNavigate();

  return (
    <section>
      <h2>Protected dashboard</h2>
      <p>
        The (protected) layout renders this page only while you are signed in.
      </p>
      <button
        onClick={() => {
          logout();
          navigate("/login");
        }}
      >
        Sign out
      </button>
    </section>
  );
}
