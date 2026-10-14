/**
 * RAINCHECK identity tokens — design-standard.md §9, source of truth.
 *
 * Usage ratio per page: ~90% background / ~8% paper-text / ~2% accent.
 * Accent is EARNED: CTAs, one hero word, the ticker, receipt/attestation
 * status markers. Never body text, never section washes.
 *
 * Forbidden: the pre-standard palette (see design-standard.md §9 for the
 * retired values) — a design-compliance test fails the build if those
 * appear anywhere in src/.
 * Never swap accents between products; never introduce a third accent.
 */
export const TOKENS = {
  /** Page background, hero sections. */
  bgInkNavy: "#0B1220",
  /** Primary CTA, ticker text, one hero word, receipt/attestation status markers. */
  accentRainCyan: "#35E0FF",
  /** Alternate bands, footer, "proof" sections. */
  paperWarm: "#F4EFE6",
  /** Text on dark surfaces. */
  textOnDark: "#F4FEFF",
  /** Text on paper surfaces (ink navy). */
  textOnPaper: "#0B1220",
} as const;

export type TokenName = keyof typeof TOKENS;
