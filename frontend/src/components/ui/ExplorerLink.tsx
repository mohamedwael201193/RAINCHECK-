export const EXPLORER = "https://explorer.arc.io";

export function txUrl(hash: string): string {
  return `${EXPLORER}/tx/${hash}`;
}

export function addressUrl(address: string): string {
  return `${EXPLORER}/address/${address}`;
}

function shortHex(value: string): string {
  if (!value || value.length <= 14) return value;
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

type Props = {
  full?: boolean;
  className?: string;
};

/**
 * TxLink — a transaction hash that ALWAYS links to the Arc explorer.
 * Bible §8.1 S3: every state transition shows its tx hash with an explorer
 * link. Never render a bare hash — a hash without a link is a dead end.
 */
export function TxLink({
  hash,
  full = false,
  className = "",
}: Props & { hash: string }) {
  return (
    <a
      href={txUrl(hash)}
      target="_blank"
      rel="noopener noreferrer"
      title={hash}
      className={`rc-hash underline decoration-rain/60 underline-offset-4 hover:decoration-rain ${className}`}
    >
      {full ? hash : shortHex(hash)}
      <span aria-hidden="true" className="text-rain no-underline">
        ↗
      </span>
    </a>
  );
}

/** AddressLink — same rule for contract/EOA addresses. */
export function AddressLink({
  address,
  full = false,
  className = "",
}: Props & { address: string }) {
  return (
    <a
      href={addressUrl(address)}
      target="_blank"
      rel="noopener noreferrer"
      title={address}
      className={`rc-hash underline decoration-rain/60 underline-offset-4 hover:decoration-rain ${className}`}
    >
      {full ? address : shortHex(address)}
      <span aria-hidden="true" className="text-rain no-underline">
        ↗
      </span>
    </a>
  );
}
