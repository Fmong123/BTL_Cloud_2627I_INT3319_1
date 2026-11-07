import { HashRouter, Link, Navigate, Outlet, Route, Routes } from 'react-router-dom';
import { lazy, Suspense } from 'react';
import { WorkspaceProvider } from './state/Workspace.jsx';
import Theme from './state/Theme.jsx';
import Layout from './components/Layout.jsx';
import Overview from './pages/Overview.jsx';
import Drive from './pages/Drive.jsx';
import Uploads from './pages/Uploads.jsx';
import Settings from './pages/Settings.jsx';
import Help from './pages/Help.jsx';
import Trash from './pages/Trash.jsx';
import { AuthProvider, useAuth } from './auth/Auth.jsx';
const AdminQuarantine = lazy(() => import('./pages/AdminQuarantine.jsx'));
const AdminOverview = lazy(() => import('./pages/AdminOverview.jsx'));
const AdminReports = lazy(() => import('./pages/AdminReports.jsx'));
const AdminAccounts = lazy(() => import('./pages/AdminAccounts.jsx'));
const AdminHistory = lazy(() => import('./pages/AdminHistory.jsx'));

function AdminAccess() {
  const { session } = useAuth();
  return session.user.role === 'admin' ? (
    <Suspense fallback={<p role="status">Đang mở khu vực quản trị…</p>}>
      <Outlet />
    </Suspense>
  ) : (
    <section className="empty-state">
      <h2>Bạn không có quyền quản trị</h2>
      <p>Khu vực này dành cho quản trị viên.</p>
      <Link className="button secondary" to="/files">
        Về Tệp của tôi
      </Link>
    </section>
  );
}

function SignedInApp() {
  const { session } = useAuth();
  return (
    <WorkspaceProvider key={`${session.baseUrl}:${session.user.id}`}>
      <Theme />
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route
              index
              element={
                <Navigate
                  to={session.user.role === 'admin' ? '/admin/overview' : '/files'}
                  replace
                />
              }
            />
            <Route path="overview" element={<Overview />} />
            <Route path="files" element={<Drive />} />
            <Route path="uploads" element={<Uploads />} />
            <Route path="trash" element={<Trash />} />
            <Route element={<AdminAccess />}>
              <Route path="admin/overview" element={<AdminOverview />} />
              <Route path="admin/quarantine" element={<AdminQuarantine />} />
              <Route path="admin/reports" element={<AdminReports />} />
              <Route path="admin/accounts" element={<AdminAccounts />} />
              <Route path="admin/history" element={<AdminHistory />} />
            </Route>
            <Route path="settings" element={<Settings />} />
            <Route path="help" element={<Help />} />
            <Route
              path="*"
              element={
                <section className="empty-state">
                  <h2>Trang này không tồn tại</h2>
                  <p>Đường dẫn này không còn khả dụng.</p>
                  <Link className="button primary" to="/overview">
                    Về Tổng quan
                  </Link>
                </section>
              }
            />
          </Route>
        </Routes>
      </HashRouter>
    </WorkspaceProvider>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <SignedInApp />
    </AuthProvider>
  );
}
