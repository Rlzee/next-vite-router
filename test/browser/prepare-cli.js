import { prepareWorkspace } from "./prepare.js";

/**
 * Force the browser suite's workspace - rebuild the fixture app's bundle and
 * refresh the HMR copy - exactly once, before Playwright starts.
 *
 * `pnpm run test:browser` runs this first. A bare `playwright test` skips the work
 * when the outputs already exist, because the config loads per worker and six
 * workers rebuilding under live servers is how the suite ends up testing the
 * bundle it is replacing.
 */
prepareWorkspace({ force: true });
