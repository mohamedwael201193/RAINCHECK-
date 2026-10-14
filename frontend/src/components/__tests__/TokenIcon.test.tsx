import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import TokenIcon from "../TokenIcon";

/**
 * TokenIcon render tests (react-dom/server, no DOM needed).
 *
 * The icon must be crisp and layout-shift-free: explicit width/height
 * attributes, self-hosted asset src, descriptive alt text, not draggable.
 */
describe("TokenIcon", () => {
  it("renders the USDC self-hosted asset with explicit width/height", () => {
    const html = renderToStaticMarkup(<TokenIcon token="USDC" size={22} />);
    expect(html).toContain("assets/tokens/usdc.png");
    expect(html).toContain('width="22"');
    expect(html).toContain('height="22"');
    expect(html).toContain('alt="USDC token icon"');
    expect(html).not.toContain("hotlink");
  });

  it("renders the EURC self-hosted asset, never a hotlinked URL", () => {
    const html = renderToStaticMarkup(<TokenIcon token="EURC" size={28} />);
    expect(html).toContain("assets/tokens/eurc.png");
    expect(html).toContain('width="28"');
    expect(html).toContain('alt="EURC token icon"');
    expect(html).toContain('draggable="false"');
    // Local asset only — no http(s) hotlink in the src.
    expect(html).not.toMatch(/src="https?:/);
  });

  it("defaults to a 24px square when no size is given", () => {
    const html = renderToStaticMarkup(<TokenIcon token="USDC" />);
    expect(html).toContain('width="24"');
    expect(html).toContain('height="24"');
  });
});
