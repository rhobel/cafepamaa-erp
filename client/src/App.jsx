import { Suspense, lazy } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router';
import { useAuth } from './context/AuthContext.jsx';
import { HOME, ROUTES } from './nav.js';
import { Layout } from './components/Layout.jsx';
import { Login } from './pages/Login.jsx';
import { Message, Placeholder } from './pages/Placeholder.jsx';
import { PosPage } from './pages/pos/Pos.jsx';
import { MyOrdersPage } from './pages/pos/MyOrders.jsx';
import { TablesStatusPage } from './pages/Tables.jsx';
import { RunningBillsPage } from './pages/bills/RunningBills.jsx';
import { BillDetailPage } from './pages/bills/BillDetail.jsx';
import { CheckoutPage } from './pages/bills/Checkout.jsx';

// Waiter/cashier floor pages (above) stay in the main chunk for first paint; the rest load on demand.
const page = (load, name) => lazy(() => load().then((m) => ({ default: m[name] })));
const UsersPage = page(() => import('./pages/admin/Users.jsx'), 'UsersPage');
const SettingsPage = page(() => import('./pages/admin/Settings.jsx'), 'SettingsPage');
const TablesPage = page(() => import('./pages/admin/Tables.jsx'), 'TablesPage');
const CategoriesPage = page(() => import('./pages/admin/Categories.jsx'), 'CategoriesPage');
const MenuPage = page(() => import('./pages/admin/Menu.jsx'), 'MenuPage');
const InvoiceViewPage = page(() => import('./pages/invoices/InvoiceView.jsx'), 'InvoiceViewPage');
const CustomersPage = page(() => import('./pages/customers/Customers.jsx'), 'CustomersPage');
const CustomerProfilePage = page(
  () => import('./pages/customers/CustomerProfile.jsx'),
  'CustomerProfilePage',
);
const DashboardPage = page(() => import('./pages/dashboard/Dashboard.jsx'), 'DashboardPage');
const InvoiceHistoryPage = page(
  () => import('./pages/invoices/InvoiceHistory.jsx'),
  'InvoiceHistoryPage',
);
const ReportsPage = page(() => import('./pages/reports/Reports.jsx'), 'ReportsPage');

const Loading = () => (
  <div aria-busy="true" style={{ display: 'grid', gap: 12, padding: 16 }}>
    <span className="skeleton" style={{ width: '40%', height: 20 }} />
    <span className="skeleton" />
    <span className="skeleton" />
    <span className="skeleton" style={{ width: '70%' }} />
  </div>
);

// Real pages by route; anything not listed renders a "Sprint N" placeholder.
const PAGES = {
  '/admin/users': UsersPage,
  '/admin/settings': SettingsPage,
  '/admin/tables': TablesPage,
  '/admin/categories': CategoriesPage,
  '/admin/menu': MenuPage,
  '/pos': PosPage,
  '/my-orders': MyOrdersPage,
  '/tables': TablesStatusPage,
  '/bills': RunningBillsPage,
  '/customers': CustomersPage,
  '/dashboard': DashboardPage,
  '/invoices': InvoiceHistoryPage,
  '/reports': ReportsPage,
};

// UX only — the API enforces the same rules.
function RequireAuth() {
  const { user, loading } = useAuth();
  if (loading) return <div className="boot" aria-busy="true" />;
  if (!user) return <Navigate to="/login" replace />;
  return <Outlet />;
}

function RequireRole({ roles, children }) {
  const { user } = useAuth();
  if (!roles.includes(user.role)) {
    return <Message title="Not authorised" text="Your role doesn't have access to this page." />;
  }
  return <Suspense fallback={<Loading />}>{children}</Suspense>;
}

function Home() {
  const { user } = useAuth();
  return <Navigate to={HOME[user.role]} replace />;
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route index element={<Home />} />
          {ROUTES.map((r) => {
            const Page = PAGES[r.path];
            return (
              <Route
                key={r.path}
                path={r.path}
                element={
                  <RequireRole roles={r.roles}>
                    {Page ? <Page /> : <Placeholder route={r} />}
                  </RequireRole>
                }
              />
            );
          })}
          <Route
            path="/bills/:id"
            element={
              <RequireRole roles={['admin', 'cashier']}>
                <BillDetailPage />
              </RequireRole>
            }
          />
          <Route
            path="/billing/:billId"
            element={
              <RequireRole roles={['admin', 'cashier']}>
                <CheckoutPage />
              </RequireRole>
            }
          />
          <Route
            path="/invoices/:id"
            element={
              <RequireRole roles={['admin', 'cashier']}>
                <InvoiceViewPage />
              </RequireRole>
            }
          />
          <Route
            path="/customers/:id"
            element={
              <Suspense fallback={<Loading />}>
                <CustomerProfilePage />
              </Suspense>
            }
          />
          <Route path="*" element={<Message title="Page not found" text="Check the address." />} />
        </Route>
      </Route>
    </Routes>
  );
}
