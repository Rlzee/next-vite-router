import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Router } from "next-vite-router/routes";
import { exposeUrlParity } from "./parity";

// No `StrictMode`: the suite asserts what a user sees after one interaction, and a
// double-invoked render would put two passes behind every "the page rendered" and
// "the boundary caught it" assertion without either being the behavior under test.
exposeUrlParity();
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Router />
  </BrowserRouter>,
);
