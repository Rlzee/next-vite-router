import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { registerMiddleware } from "next-vite-router";
import { Router } from "virtual:next-vite-router";

registerMiddleware(/^\/middleware/, (element) => (
  <div style={{ border: "2px solid #059669", padding: "1rem" }}>
    <strong>Middleware wrapper active</strong>
    {element}
  </div>
));

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Router />
    </BrowserRouter>
  </StrictMode>,
);
