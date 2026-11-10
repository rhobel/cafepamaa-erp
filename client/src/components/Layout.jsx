import { NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext.jsx';
import { ROLE_LABEL, ROUTES, navFor } from '../nav.js';
import { Icon } from './icons.jsx';
import { Button } from './ui.jsx';

function NavList({ items }) {
  return (
    <nav className="nav">
      {items.map((r) => (
        <NavLink key={r.path} to={r.path} title={r.label}>
          <Icon name={r.icon} />
          <span className="nav-label">{r.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}

export function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const items = navFor(user.role);
  const main = items.filter((r) => r.section !== 'admin');
  const admin = items.filter((r) => r.section === 'admin');
  const title =
    ROUTES.find((r) => pathname.startsWith(r.path))?.label ??
    (pathname.startsWith('/billing') ? 'Checkout' : '');

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="shell">
      <aside className="side">
        <div className="org">
          <div className="logo-mark">
            <i />
          </div>
          <div className="nav-label">
            <b>PAMAA</b>
            <small>Billing &amp; POS</small>
          </div>
        </div>
        <div className="nav-h">MAIN MENU</div>
        <NavList items={main} />
        {admin.length > 0 && (
          <>
            <div className="hr" />
            <div className="nav-h">ADMIN</div>
            <NavList items={admin} />
          </>
        )}
      </aside>

      <main className="main">
        <header className="topbar">
          <h1>{title}</h1>
          <div className="row">
            <div className="who">
              <b>{user.name}</b>
              <small>{ROLE_LABEL[user.role]}</small>
            </div>
            <Button onClick={onLogout}>
              <Icon name="logout" size={16} />
              Logout
            </Button>
          </div>
        </header>
        <div className="content">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
