import { useNavigate } from "react-router-dom";
import { useAuth } from "../../auth";

export default function LoginPage() {
  const { isAuthed, login } = useAuth();
  const navigate = useNavigate();

  return (
    <section>
      <h2>Login</h2>
      <p>Status: {isAuthed ? "signed in" : "signed out"}</p>
      <button
        onClick={() => {
          login();
          navigate("/dashboard");
        }}
      >
        Sign in
      </button>
    </section>
  );
}
