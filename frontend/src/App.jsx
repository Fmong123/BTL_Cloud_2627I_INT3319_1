import { HashRouter, Link, Navigate, Route, Routes } from 'react-router-dom';
import { WorkspaceProvider } from './state/Workspace.jsx';
import Theme from './state/Theme.jsx';
import Layout from './components/Layout.jsx';
import Overview from './pages/Overview.jsx';
import Drive from './pages/Drive.jsx';
import Uploads from './pages/Uploads.jsx';
import Settings from './pages/Settings.jsx';
import Help from './pages/Help.jsx';

export default function App() {
  return (
    <WorkspaceProvider>
      <Theme />
      <HashRouter>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Navigate to="/files" replace />} />
            <Route path="overview" element={<Overview />} />
            <Route path="files" element={<Drive />} />
            <Route path="uploads" element={<Uploads />} />
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
