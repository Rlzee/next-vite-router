import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { Router } from "next-vite-router/routes";

// The client entry mirrors what the CLI scaffolds: the generated `Router` inside
// `BrowserRouter`. It is only ever compiled here (`vite build`), to prove the
// generated module and `react-dom/client` bundle on every matrix combination;
// The generated module and `react-dom/client` bundle are compiled on every
// compatibility matrix combination.
createRoot(document.getElementById("root")!).render(
  <BrowserRouter>
    <Router />
  </BrowserRouter>,
);
