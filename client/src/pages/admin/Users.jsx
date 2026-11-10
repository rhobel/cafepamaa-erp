import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { Badge, Button, Input, Modal, Select, Table, useToast } from '../../components/ui.jsx';

const ROLES = ['admin', 'waiter', 'cashier'];
const label = (r) => r[0].toUpperCase() + r.slice(1);
const EMPTY = { name: '', username: '', role: 'waiter', maxDiscountPercent: 0, password: '' };

export function UsersPage() {
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [editing, setEditing] = useState(null); // null | 'new' | user
  const [confirming, setConfirming] = useState(null);

  const params = new URLSearchParams({ ...(q.trim() && { q: q.trim() }), ...(role && { role }) });
  const query = useQuery({
    queryKey: ['users', q.trim(), role],
    queryFn: () => api(`/users?${params}`),
    placeholderData: (prev) => prev,
  });

  const columns = [
    { key: 'name', label: 'Name' },
    {
      key: 'username',
      label: 'Username',
      render: (u) => <span className="mono">{u.username}</span>,
    },
    { key: 'role', label: 'Role', render: (u) => <Badge>{label(u.role)}</Badge> },
    {
      key: 'maxDiscountPercent',
      label: 'Max discount',
      num: true,
      render: (u) => (u.role === 'cashier' ? `${u.maxDiscountPercent}%` : '—'),
    },
    {
      key: 'isActive',
      label: 'Status',
      render: (u) =>
        u.isActive ? (
          <Badge tone="ok">Active</Badge>
        ) : (
          <Badge tone="gray" dot>
            Inactive
          </Badge>
        ),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (u) => (
        <div className="actions">
          <Button onClick={() => setEditing(u)}>Edit</Button>
          <Button
            variant={u.isActive ? 'danger' : 'default'}
            disabled={u._id === me?._id}
            title={u._id === me?._id ? 'You cannot deactivate your own account' : undefined}
            onClick={() => setConfirming(u)}
          >
            {u.isActive ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div>
      <div className="toolbar">
        <input
          className="input"
          type="search"
          placeholder="Search name or username"
          aria-label="Search users"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select
          className="input"
          aria-label="Filter by role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
        >
          <option value="">All roles</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {label(r)}
            </option>
          ))}
        </select>
        <div className="grow" />
        <Button variant="primary" onClick={() => setEditing('new')}>
          Add user
        </Button>
      </div>

      {query.isError ? (
        <div className="panel pad">
          <p>Could not load users: {query.error.message}</p>
          <Button onClick={() => query.refetch()}>Retry</Button>
        </div>
      ) : (
        <Table
          columns={columns}
          rows={query.data ?? []}
          loading={query.isPending}
          empty={q || role ? 'No users match your filters' : 'No users yet'}
        />
      )}

      {editing && (
        <UserForm user={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />
      )}
      {confirming && <ConfirmStatus user={confirming} onClose={() => setConfirming(null)} />}
    </div>
  );
}

function useSaveUser(onDone) {
  const qc = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: ({ id, body }) =>
      api(id ? `/users/${id}` : '/users', { method: id ? 'PATCH' : 'POST', body }),
    onSuccess: (_, { message }) => {
      qc.invalidateQueries({ queryKey: ['users'] });
      toast(message);
      onDone();
    },
  });
}

function UserForm({ user, onClose }) {
  const isNew = !user;
  const [form, setForm] = useState(user ? { ...EMPTY, ...user, password: '' } : EMPTY);
  const save = useSaveUser(onClose);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  // Zod issues come back as data: [{ path, message }]; show them next to the field.
  const fieldErr = {};
  for (const i of Array.isArray(save.error?.data) ? save.error.data : [])
    fieldErr[i.path] ??= i.message;
  const formErr = save.error && !Object.keys(fieldErr).length ? save.error.message : null;

  const onSubmit = (e) => {
    e.preventDefault();
    const body = {
      name: form.name,
      role: form.role,
      ...(form.role === 'cashier' && { maxDiscountPercent: Number(form.maxDiscountPercent) }),
      ...(isNew && { username: form.username }),
      ...(form.password && { password: form.password }),
    };
    save.mutate({
      id: user?._id,
      body,
      message: isNew
        ? 'User created'
        : form.password
          ? 'User updated, password reset'
          : 'User updated',
    });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'Add user' : `Edit ${user.name}`}
      footer={
        <div className="actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="dark" type="submit" form="user-form" loading={save.isPending}>
            {isNew ? 'Create user' : 'Save changes'}
          </Button>
        </div>
      }
    >
      <form id="user-form" className="form-grid" onSubmit={onSubmit}>
        <Input
          label="Name"
          required
          value={form.name}
          onChange={set('name')}
          error={fieldErr.name}
        />
        {isNew ? (
          <Input
            label="Username"
            required
            autoCapitalize="none"
            value={form.username}
            onChange={set('username')}
            error={fieldErr.username}
          />
        ) : (
          <Input label="Username" value={user.username} disabled hint="Cannot be changed" />
        )}
        <Select label="Role" value={form.role} onChange={set('role')} error={fieldErr.role}>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {label(r)}
            </option>
          ))}
        </Select>
        {form.role === 'cashier' && (
          <Input
            label="Max discount %"
            type="number"
            min={0}
            max={100}
            step="any"
            required
            value={form.maxDiscountPercent}
            onChange={set('maxDiscountPercent')}
            error={fieldErr.maxDiscountPercent}
          />
        )}
        <Input
          className="span-all"
          label={isNew ? 'Password' : 'Reset password'}
          type="password"
          autoComplete="new-password"
          minLength={8}
          required={isNew}
          value={form.password}
          onChange={set('password')}
          error={fieldErr.password}
          hint={isNew ? 'At least 8 characters' : 'Leave blank to keep the current password'}
        />
        {formErr && (
          <div className="span-all field-error" role="alert">
            {formErr}
          </div>
        )}
      </form>
    </Modal>
  );
}

function ConfirmStatus({ user, onClose }) {
  const save = useSaveUser(onClose);
  const deactivating = user.isActive;
  return (
    <Modal
      open
      onClose={onClose}
      title={deactivating ? 'Deactivate user?' : 'Activate user?'}
      footer={
        <div className="actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant={deactivating ? 'danger' : 'dark'}
            loading={save.isPending}
            onClick={() =>
              save.mutate({
                id: user._id,
                body: { isActive: !deactivating },
                message: `${user.name} ${deactivating ? 'deactivated' : 'activated'}`,
              })
            }
          >
            {deactivating ? 'Deactivate' : 'Activate'}
          </Button>
        </div>
      }
    >
      <p>
        {deactivating
          ? `${user.name} (${user.username}) will be signed out everywhere and can no longer log in.`
          : `${user.name} (${user.username}) will be able to log in again.`}
      </p>
      {save.error && (
        <p className="field-error" role="alert">
          {save.error.message}
        </p>
      )}
    </Modal>
  );
}
