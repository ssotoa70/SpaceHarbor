import React, { Suspense } from "react";
import ReactDOM from "react-dom/client";
import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";

import { AppLayout } from "./AppLayout";
import { AuthProvider, useAuth } from "./contexts/AuthContext";
import { ProjectProvider } from "./contexts/ProjectContext";
import { PageSkeleton } from "./components/PageSkeleton";
import "./design-system/tokens.css";
import "./styles.css";

const AssetBrowser = React.lazy(() =>
  import("./pages/AssetBrowser").then((m) => ({ default: m.AssetBrowser }))
);
const HierarchyBrowser = React.lazy(() =>
  import("./pages/HierarchyBrowser").then((m) => ({ default: m.HierarchyBrowser }))
);
const TimelinePage = React.lazy(() =>
  import("./pages/TimelinePage").then((m) => ({ default: m.TimelinePage }))
);
const ReviewPage = React.lazy(() =>
  import("./pages/ReviewPage").then((m) => ({ default: m.ReviewPage }))
);
const MaterialBrowser = React.lazy(() =>
  import("./pages/MaterialBrowser").then((m) => ({ default: m.MaterialBrowser }))
);
const AssetDetail = React.lazy(() =>
  import("./pages/AssetDetail").then((m) => ({ default: m.AssetDetail }))
);
const DailiesPlaylistPage = React.lazy(() =>
  import("./pages/DailiesPlaylistPage").then((m) => ({ default: m.DailiesPlaylistPage }))
);
const DailiesIndexPage = React.lazy(() =>
  import("./pages/DailiesIndexPage").then((m) => ({ default: m.DailiesIndexPage }))
);
const DependenciesPage = React.lazy(() =>
  import("./pages/DependenciesPage").then((m) => ({ default: m.DependenciesPage }))
);
const Dashboard = React.lazy(() =>
  import("./App").then((m) => ({ default: m.App }))
);
const CapacityPlanningDashboard = React.lazy(() =>
  import("./pages/CapacityPlanningDashboard").then((m) => ({ default: m.CapacityPlanningDashboard }))
);
const LoginPage = React.lazy(() =>
  import("./pages/LoginPage").then((m) => ({ default: m.LoginPage }))
);
const ApiKeysPage = React.lazy(() =>
  import("./pages/ApiKeysPage").then((m) => ({ default: m.ApiKeysPage }))
);
const SettingsPage = React.lazy(() =>
  import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage }))
);
const AnalyticsDashboard = React.lazy(() =>
  import("./pages/AnalyticsDashboard").then((m) => ({ default: m.AnalyticsDashboard }))
);
const QueryConsolePage = React.lazy(() =>
  import("./pages/QueryConsolePage").then((m) => ({ default: m.QueryConsolePage }))
);
const MyQueuePage = React.lazy(() =>
  import("./pages/MyQueuePage").then((m) => ({ default: m.MyQueuePage }))
);
const MyAssignmentsPage = React.lazy(() =>
  import("./pages/MyAssignmentsPage").then((m) => ({ default: m.MyAssignmentsPage }))
);
const ShotBoardPage = React.lazy(() =>
  import("./pages/ShotBoardPage").then((m) => ({ default: m.ShotBoardPage }))
);
const DeliveryTrackerPage = React.lazy(() =>
  import("./pages/DeliveryTrackerPage").then((m) => ({ default: m.DeliveryTrackerPage }))
);
const ApprovalQueuePage = React.lazy(() =>
  import("./pages/ApprovalQueuePage").then((m) => ({ default: m.ApprovalQueuePage }))
);
const FeedbackPage = React.lazy(() =>
  import("./pages/FeedbackPage").then((m) => ({ default: m.FeedbackPage }))
);
const SessionsListPage = React.lazy(() =>
  import("./pages/SessionsListPage").then((m) => ({ default: m.SessionsListPage }))
);
const VersionComparePage = React.lazy(() =>
  import("./pages/VersionComparePage").then((m) => ({ default: m.VersionComparePage }))
);
const PipelineMonitorPage = React.lazy(() =>
  import("./pages/PipelineMonitorPage").then((m) => ({ default: m.PipelineMonitorPage }))
);
const TranscodingPage = React.lazy(() =>
  import("./pages/TranscodingPage").then((m) => ({ default: m.TranscodingPage }))
);
const DataEnginePage = React.lazy(() =>
  import("./pages/DataEnginePage").then((m) => ({ default: m.DataEnginePage }))
);
const ConformancePage = React.lazy(() =>
  import("./pages/ConformancePage").then((m) => ({ default: m.ConformancePage }))
);
const UsersRolesPage = React.lazy(() =>
  import("./pages/UsersRolesPage").then((m) => ({ default: m.UsersRolesPage }))
);
const AuditTrailPage = React.lazy(() =>
  import("./pages/AuditTrailPage").then((m) => ({ default: m.AuditTrailPage }))
);

/* ── Suspense wrapper ── */

function Lazy({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={<PageSkeleton />}>{children}</Suspense>;
}

/* ── ProtectedRoute: redirects unauthenticated users to /login ── */

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { state } = useAuth();

  if (state === "loading") {
    return <PageSkeleton />;
  }

  if (state === "unauthenticated") {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public route — no auth required */}
          <Route
            path="login"
            element={<Lazy><LoginPage /></Lazy>}
          />

          {/* Protected routes — auth required */}
          <Route
            element={
              <ProtectedRoute>
                <ProjectProvider>
                  <AppLayout />
                </ProjectProvider>
              </ProtectedRoute>
            }
          >
            {/* ── LIBRARY section ── */}
            <Route index element={<Navigate to="/library/assets" replace />} />
            <Route path="library/assets" element={<Lazy><AssetBrowser /></Lazy>} />
            <Route path="library/assets/:id" element={<Lazy><AssetDetail /></Lazy>} />
            <Route path="library/hierarchy" element={<Lazy><HierarchyBrowser /></Lazy>} />
            <Route path="library/materials" element={<Lazy><MaterialBrowser /></Lazy>} />

            {/* ── WORK section ── */}
            <Route path="work/queue" element={<Lazy><MyQueuePage /></Lazy>} />
            <Route path="work/assignments" element={<Lazy><MyAssignmentsPage /></Lazy>} />
            <Route path="work/dailies" element={<Lazy><DailiesIndexPage /></Lazy>} />
            <Route path="work/dailies/:id" element={<Lazy><DailiesPlaylistPage /></Lazy>} />

            {/* ── REVIEW section ── */}
            <Route path="review/approvals" element={<Lazy><ApprovalQueuePage /></Lazy>} />
            <Route path="review/feedback" element={<Lazy><FeedbackPage /></Lazy>} />
            <Route path="review/sessions" element={<Lazy><SessionsListPage /></Lazy>} />
            <Route path="review/compare" element={<Lazy><VersionComparePage /></Lazy>} />

            {/* ── PRODUCTION section ── */}
            <Route path="production/shots" element={<Lazy><ShotBoardPage /></Lazy>} />
            <Route path="production/timeline" element={<Lazy><TimelinePage /></Lazy>} />
            <Route path="production/dependencies" element={<Lazy><DependenciesPage /></Lazy>} />
            <Route path="production/delivery" element={<Lazy><DeliveryTrackerPage /></Lazy>} />

            {/* ── PIPELINE section ── */}
            <Route path="pipeline/monitor" element={<Lazy><PipelineMonitorPage /></Lazy>} />
            <Route path="pipeline/transcoding" element={<Lazy><TranscodingPage /></Lazy>} />
            <Route path="pipeline/functions" element={<Lazy><DataEnginePage /></Lazy>} />
            <Route path="pipeline/conform" element={<Lazy><ConformancePage /></Lazy>} />

            {/* ── ADMIN section ── */}
            <Route path="admin/analytics" element={<Lazy><AnalyticsDashboard /></Lazy>} />
            <Route path="admin/query" element={<Lazy><QueryConsolePage /></Lazy>} />
            {/* Capacity removed — requires VAST cluster (Phase 4 scope) */}
            <Route path="admin/users" element={<Lazy><UsersRolesPage /></Lazy>} />
            <Route path="admin/audit" element={<Lazy><AuditTrailPage /></Lazy>} />
            <Route path="admin/settings" element={<Lazy><SettingsPage /></Lazy>} />

            {/* ── Utility routes (not in nav) ── */}
            <Route path="api-keys" element={<Lazy><ApiKeysPage /></Lazy>} />
            <Route path="playlists/:id" element={<Lazy><DailiesPlaylistPage /></Lazy>} />

            {/* ── Backward-compatible redirects from old URLs ── */}
            <Route path="assets" element={<Navigate to="/library/assets" replace />} />
            <Route path="assets/:id" element={<Lazy><AssetDetail /></Lazy>} />
            <Route path="hierarchy" element={<Navigate to="/library/hierarchy" replace />} />
            <Route path="materials" element={<Navigate to="/library/materials" replace />} />
            <Route path="timeline" element={<Navigate to="/production/timeline" replace />} />
            <Route path="review" element={<Navigate to="/review/approvals" replace />} />
            <Route path="dashboard" element={<Navigate to="/admin/analytics" replace />} />
            <Route path="capacity" element={<Navigate to="/admin/analytics" replace />} />
            <Route path="analytics" element={<Navigate to="/admin/analytics" replace />} />
            <Route path="query" element={<Navigate to="/admin/query" replace />} />
            <Route path="settings" element={<Navigate to="/admin/settings" replace />} />

            {/* Catch-all → library assets */}
            <Route path="*" element={<Navigate to="/library/assets" replace />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>
);
