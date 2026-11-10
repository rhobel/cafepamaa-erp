// Single source for routes, role access and sidebar (web-flow.md §1, §3).
// `nav` overrides which roles see the link in the sidebar when it differs from route access.
// `sprint` = when the real page lands; until then the route renders a placeholder.

export const ROUTES = [
  {
    path: '/dashboard',
    label: 'Dashboard',
    icon: 'dashboard',
    roles: ['admin', 'cashier'],
  },
  { path: '/pos', label: 'New Order', icon: 'pos', roles: ['admin', 'waiter'] },
  {
    path: '/my-orders',
    label: 'My Orders',
    icon: 'orders',
    roles: ['admin', 'waiter'],
    nav: ['waiter'],
  },
  { path: '/bills', label: 'Running Bills', icon: 'bills', roles: ['admin', 'cashier'], sprint: 3 },
  {
    path: '/tables',
    label: 'Tables',
    icon: 'tables',
    roles: ['admin', 'waiter', 'cashier'],
  },
  {
    path: '/invoices',
    label: 'Invoice History',
    icon: 'invoices',
    roles: ['admin', 'cashier'],
  },
  {
    path: '/customers',
    label: 'Customers',
    icon: 'customers',
    roles: ['admin', 'waiter', 'cashier'],
    sprint: 4,
  },
  { path: '/reports', label: 'Reports', icon: 'reports', roles: ['admin', 'cashier'] },
  {
    path: '/admin/menu',
    label: 'Menu',
    icon: 'menu',
    roles: ['admin'],
    section: 'admin',
    sprint: 1,
  },
  {
    path: '/admin/categories',
    label: 'Categories',
    icon: 'categories',
    roles: ['admin'],
    section: 'admin',
    sprint: 1,
  },
  {
    path: '/admin/tables',
    label: 'Table Setup',
    icon: 'tableSetup',
    roles: ['admin'],
    section: 'admin',
    sprint: 1,
  },
  {
    path: '/admin/users',
    label: 'Users',
    icon: 'users',
    roles: ['admin'],
    section: 'admin',
    sprint: 1,
  },
  {
    path: '/admin/settings',
    label: 'Settings',
    icon: 'settings',
    roles: ['admin'],
    section: 'admin',
    sprint: 1,
  },
];

export const HOME = { admin: '/dashboard', cashier: '/bills', waiter: '/pos' };

export const ROLE_LABEL = { admin: 'Admin', cashier: 'Cashier', waiter: 'Waiter' };

export const navFor = (role) => ROUTES.filter((r) => (r.nav ?? r.roles).includes(role));
