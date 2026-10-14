/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Base URL of the Receipt API (indexer), e.g. https://api.raincheck.example */
  readonly VITE_API_URL?: string;
  /** Arc mainnet RPC override (default https://rpc.mainnet.arc.io) */
  readonly VITE_RPC_URL?: string;
  /** Deployed RaincheckEscrow address override (default: Sourcify-verified deployment) */
  readonly VITE_ESCROW_ADDRESS?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
