import { Outlet } from "react-router-dom";

/**
 * A layout declared *inside* the optional catch-all folder.
 *
 * This is the combination the converter treats separately: the catch-all node
 * itself has a layout, so it converts through the layout branch rather than
 * through the optional-catch-all case of a page folder. It also travels through
 * `lazyLayouts`, because the fixture app turns every nested layout into its own
 * chunk - so the layout arrives before the page below it, as it does for a real
 * reader navigating into the folder.
 */
export default function DocsSegmentLayout() {
  return (
    <div data-testid="docs-seg-layout">
      {"DOCS-SEG-LAYOUT["}
      <Outlet />
      {"]DOCS-SEG-LAYOUT"}
    </div>
  );
}
