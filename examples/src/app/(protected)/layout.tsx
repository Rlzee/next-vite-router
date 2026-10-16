import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "../../auth";

export default function ProtectedLayout() {
  const { isAuthed } = useAuth();
  return isAuthed ? <Outlet /> : <Navigate to="/login" replace />;
}
