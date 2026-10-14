/**
 * TokenIcon — THE shared token icon for RAINCHECK.
 *
 * Built by GETEURC; INT consumes this in the NewReceiptPage token selector.
 *
 * Self-hosted official Circle-brand marks, verified on disk:
 *   public/assets/tokens/usdc.png (181x181)
 *   public/assets/tokens/eurc.png (250x250)
 * Never hotlink token icons — these are local assets.
 */

export type TokenSymbol = "USDC" | "EURC";

function assetUrl(file: string): string {
  const env = (
    import.meta as unknown as { env?: { BASE_URL?: string } }
  ).env;
  const base = env?.BASE_URL ?? "/";
  const rooted = base.endsWith("/") ? base : `${base}/`;
  return `${rooted}assets/tokens/${file}`;
}

const ICON_SRC: Record<TokenSymbol, string> = {
  USDC: assetUrl("usdc.png"),
  EURC: assetUrl("eurc.png"),
};

export interface TokenIconProps {
  token: TokenSymbol;
  /** Rendered size in px (square). Defaults to 24. */
  size?: number;
  className?: string;
}

/**
 * Crisp token mark: explicit width/height attributes (no layout shift),
 * descriptive alt text, not draggable.
 */
export default function TokenIcon({
  token,
  size = 24,
  className = "",
}: TokenIconProps) {
  return (
    <img
      src={ICON_SRC[token]}
      width={size}
      height={size}
      alt={`${token} token icon`}
      draggable={false}
      className={className}
      style={{ width: size, height: size, flexShrink: 0 }}
    />
  );
}
