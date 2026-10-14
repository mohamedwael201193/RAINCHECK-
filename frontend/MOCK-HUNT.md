# MOCK-HUNT — frontend/src/ (F10, 2026-10-14)

Scope: `frontend/src/` (excludes `node_modules`, `dist`), patterns
`mock|Mock|fake|Fake|demo|Demo|placeholder|Placeholder|lorem|Lorem|TODO|FIXME`.
Bible §12: the grep must return only test fixtures clearly labeled as such —
production code must contain **zero mock paths**.

Dispositions: RESOLVED = wired to real data (or a non-data usage);
FLAGGED = file:line + what is needed.

## Result: 21 hits, 0 FLAGGED, 21 RESOLVED

Every hit is one of three benign categories. None is mock data, a stubbed
response, or a dead-end control.

### A. Code comments asserting the no-mock discipline (7) — RESOLVED
| File:line | Text | Disposition |
|---|---|---|
| `src/components/landing/Hero.tsx:11` | "API is unreachable — never faked" | RESOLVED — states the failure contract (honest error, no fake stats) |
| `src/components/landing/LiveStats.tsx:84` | "itself instead of showing fake data" | RESOLVED — documents real-data-only behavior |
| `src/pages/LandingPage.tsx:17` | "is unreachable — never faked (§3, §10)" | RESOLVED — same discipline note |
| `src/pages/dashboard/ActivityPage.tsx:14` | "the feed never shows fake data" | RESOLVED — discipline note |
| `src/pages/dashboard/ActivityPage.tsx:15` | "No mock data, no invented rows…" | RESOLVED — empty-state honesty note |
| `src/pages/VerifyPage.tsx:22` | "No fake data — while the RPC read is in flight" | RESOLVED — loading-state honesty note |
| `src/App.tsx:11` | "import.meta.env.VITE_API_URL — never mock data" | RESOLVED — env/data contract note |

### B. HTML input `placeholder=` hints (10) — RESOLVED
Input hints are UX copy, not mock data: they never populate a value, never
render as content, and every one of these fields submits to a real on-chain /
API call.

| File:line | Hint | Disposition |
|---|---|---|
| `src/pages/dashboard/NewReceiptPage.tsx:430` | `placeholder="0x…"` (seller address) | RESOLVED — format hint; validated by `isValidAddress`, submitted via real EIP-3009/escrow tx |
| `src/pages/dashboard/NewReceiptPage.tsx:452` | `placeholder="0.5"` (amount) | RESOLVED — format hint; parsed by `parseUsdcToBaseUnits`, real dust amounts |
| `src/pages/dashboard/NewReceiptPage.tsx:472` | `placeholder="e.g. https://api.example.com/…"` (endpoint) | RESOLVED — example format hint only; stored in the real terms bundle |
| `src/pages/dashboard/ReceiptDetailPage.tsx:826` | "Paste the delivered bytes here…" | RESOLVED — hint; bytes are sha256-hashed into the real `attestDelivery` call |
| `src/pages/dashboard/ReceiptDetailPage.tsx:971` | "e.g. Paid call returned HTTP 400; …" | RESOLVED — hint; reason is keccak256-hashed into the real `flagNonDelivery` call |
| `src/pages/dashboard/ReceiptDetailPage.tsx:1296` | "Paste the exact delivered bytes…" | RESOLVED — hint; real attestation path |
| `src/pages/dashboard/ReceiptDetailPage.tsx:1318` | `placeholder="0x… (64 hex chars)"` | RESOLVED — format hint for a 32-byte hash input |
| `src/pages/VerifyPage.tsx:206` | receipt-JSON shape hint | RESOLVED — hint; pasted JSON is really hashed and compared to the Memo anchor |
| `src/pages/VerifyPage.tsx:226` | `placeholder="0x…"` (tx hash) | RESOLVED — format hint; tx is really fetched from the RPC |

### C. CSS `::placeholder` styling + honest copy (4) — RESOLVED
| File:line | Text | Disposition |
|---|---|---|
| `src/pages/dashboard/NewReceiptPage.tsx:172` | `placeholder:text-[#F4FEFF]/30` (Tailwind variant) | RESOLVED — styling hook for the hints in B, not content |
| `src/pages/dashboard/ReceiptDetailPage.css:219` | `.rc-textarea::placeholder, .rc-input::placeholder { … }` | RESOLVED — styling hook for the hints in B |
| `src/pages/dashboard/DashboardPage.tsx:54` | "no placeholder rows" (comment) | RESOLVED — asserts the list never renders fake rows |
| `src/pages/dashboard/ActivityPage.tsx:160` | "the feed shows live indexer data only, never placeholders" (user-facing error copy) | RESOLVED — honest failure copy, shown only when the API is unreachable |
| `src/pages/dashboard/ActivityPage.css:261` | "Skeleton regions while loading — never blank space, never fake rows" | RESOLVED — loading-state discipline note |

## Not hits (verified absent)
`TODO`, `FIXME`, `lorem` (any case), `demo` (any case): **zero occurrences** in
`src/`. No dead-end controls found by this sweep (button/link targets were not
re-verified here — that is a runtime check, not a grep check).

## Test fixtures (labeled, allowed by the bible)
- `src/lib/__fixtures__/receiptHash.golden.json` — labeled
  "SHARED GOLDEN TEST VECTOR (fixture)"; provenance documented in its `_meta`
  block (real R9-W1C mainnet values where the chain produced them, keccak256
  of documented preimages otherwise).
- Unit tests under `src/lib/__tests__/` use inline constants only where the
  value is arbitrary (e.g. `OTHER = 0x3600…0000` as a "stranger" address in the
  capability truth table) — clearly test-local, never shipped.
