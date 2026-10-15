import { Suspense, lazy } from "react";
import type { ReactNode } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import ErrorBoundary from "./components/ui/ErrorBoundary";
import NotFound from "./components/ui/NotFound";
import RouteSkeleton from "./components/ui/RouteSkeleton";

// Route ownership stays with the feature agents; each route lazy-loads its
// own chunk (founder perf bar: code-split routes, no hanging, no blank space).
// Data contract for every page: live on-chain/API data only via
// import.meta.env.VITE_API_URL — never mock data.
const LandingPage = lazy(() => import("./pages/LandingPage"));
const DashboardPage = lazy(() => import("./pages/dashboard/DashboardPage"));
const NewReceiptPage = lazy(() => import("./pages/dashboard/NewReceiptPage"));
const ReceiptDetailPage = lazy(
  () => import("./pages/dashboard/ReceiptDetailPage"),
);
const VerifyPage = lazy(() => import("./pages/VerifyPage"));
// F7's dashboard ActivityPage (API-derived feed + dispute counters, "indexer
// is cache" architecture) won the pick; F1's direct-eth_getLogs candidate
// (src/pages/ActivityPage.tsx) was removed.
const ActivityPage = lazy(() => import("./pages/dashboard/ActivityPage"));
const BridgePage = lazy(() => import("./pages/dashboard/BridgePage"));

function withSuspense(element: ReactNode) {
  return <Suspense fallback={<RouteSkeleton />}>{element}</Suspense>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={withSuspense(<LandingPage />)} />
          <Route
            path="/dashboard"
            element={withSuspense(<DashboardPage />)}
          />
          <Route
            path="/dashboard/new"
            element={withSuspense(<NewReceiptPage />)}
          />
          <Route
            path="/dashboard/r/:paymentId"
            element={withSuspense(<ReceiptDetailPage />)}
          />
          <Route path="/verify" element={withSuspense(<VerifyPage />)} />
          <Route
            path="/dashboard/activity"
            element={withSuspense(<ActivityPage />)}
          />
          <Route
            path="/dashboard/bridge"
            element={withSuspense(<BridgePage />)}
          />
          {/* Unknown routes: the 404 below explains honestly instead of
              dead-ending. */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </ErrorBoundary>
  );
}
