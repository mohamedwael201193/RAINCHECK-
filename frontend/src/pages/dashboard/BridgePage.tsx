import AppShell from "../../components/dashboard/AppShell";
import BridgePanel from "../../components/BridgePanel";
import "../../styles/app.css";
import "./BridgePage.css";

/**
 * /dashboard/bridge — the CCTP "bridge out" screen.
 *
 * Renders BridgePanel inside the standard app shell. All bridge logic
 * (token select, approve -> depositForBurn via the user's wallet, honest
 * EURC gating) lives in the panel; this page is just the route + frame.
 */
export default function BridgePage() {
  return (
    <AppShell title="Bridge">
      <BridgePanel />
    </AppShell>
  );
}
