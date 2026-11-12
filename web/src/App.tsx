import { Navigate, Route, Routes } from 'react-router-dom';
import Shell from './components/Shell';
import { useAuth } from './lib/auth';
import type { Role } from './lib/types';
import { Loading } from './components/ui';
import AccountDetailPage from './pages/AccountDetail';
import Accounts from './pages/Accounts';
import Dashboard from './pages/Dashboard';
import Imports from './pages/Imports';
import Login from './pages/Login';
import MyWork from './pages/MyWork';
import People from './pages/People';
import PortfolioPage from './pages/Portfolio';
import ProductivityPage from './pages/Productivity';
import ProjectDetailPage from './pages/ProjectDetail';
import Projects from './pages/Projects';
import Register from './pages/Register';
import Reports from './pages/Reports';
import TeamDetailPage from './pages/TeamDetail';
import Teams from './pages/Teams';

function Guard({ roles, children }: { roles: Role[]; children: JSX.Element }) {
  const { user } = useAuth();
  if (!user) return <Navigate to="/login" replace />;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  return children;
}

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <Loading label="Restoring your session…" />;
  if (!user) {
    return (
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    );
  }

  return (
    <Shell>
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/accounts" element={<Accounts />} />
        <Route path="/accounts/:id" element={<AccountDetailPage />} />
        <Route path="/projects" element={<Projects />} />
        <Route path="/projects/:id" element={<ProjectDetailPage />} />
        <Route path="/teams" element={<Teams />} />
        <Route path="/teams/:id" element={<TeamDetailPage />} />
        <Route path="/register" element={<Register />} />
        <Route path="/productivity" element={<ProductivityPage />} />
        <Route path="/imports" element={<Imports />} />
        <Route
          path="/my-work"
          element={
            <Guard roles={['ENGINEER', 'PM']}>
              <MyWork />
            </Guard>
          }
        />
        <Route
          path="/reports"
          element={
            <Guard roles={['ADMIN', 'PM', 'DIRECTOR', 'VP']}>
              <Reports />
            </Guard>
          }
        />
        <Route
          path="/people"
          element={
            <Guard roles={['ADMIN', 'VP', 'DIRECTOR']}>
              <People />
            </Guard>
          }
        />
        <Route
          path="/portfolio"
          element={
            <Guard roles={['ADMIN', 'VP', 'DIRECTOR']}>
              <PortfolioPage />
            </Guard>
          }
        />
        <Route path="/login" element={<Navigate to="/" replace />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Shell>
  );
}
