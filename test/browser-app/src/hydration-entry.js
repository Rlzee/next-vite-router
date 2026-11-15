import { hydrateRoot } from "react-dom/client";
import { buildElement } from "./hydration-fixture.js";

hydrateRoot(document.getElementById("root"), buildElement(undefined));