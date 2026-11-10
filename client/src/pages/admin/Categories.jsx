import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Badge, Button, Input, Modal, Table, useToast } from '../../components/ui.jsx';

const KEY = ['categories'];

export function CategoriesPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const {
    data: rows = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: KEY,
    queryFn: () => api('/categories'),
  });

  const [name, setName] = useState('');
  const [editing, setEditing] = useState(null); // { _id, name }
  const [toggling, setToggling] = useState(null); // category row

  const onError = (e) => toast(e.message, 'error');
  const done = (msg) => () => {
    toast(msg);
    qc.invalidateQueries({ queryKey: KEY });
  };

  const create = useMutation({
    mutationFn: (n) => api('/categories', { method: 'POST', body: { name: n } }),
    onSuccess: () => {
      setName('');
      done('Category added')();
    },
    onError,
  });

  const update = useMutation({
    mutationFn: ({ id, ...body }) => api(`/categories/${id}`, { method: 'PATCH', body }),
    onSuccess: (_, vars) => {
      setEditing(null);
      setToggling(null);
      done(vars.isActive === undefined ? 'Category renamed' : 'Category activated')();
    },
    onError,
  });

  const deactivate = useMutation({
    mutationFn: (id) => api(`/categories/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setToggling(null);
      done('Category deactivated')();
    },
    onError,
  });

  const reorder = useMutation({
    mutationFn: (next) =>
      api('/categories/reorder', { method: 'POST', body: { ids: next.map((c) => c._id) } }),
    onMutate: async (next) => {
      await qc.cancelQueries({ queryKey: KEY });
      const prev = qc.getQueryData(KEY);
      qc.setQueryData(
        KEY,
        next.map((c, i) => ({ ...c, sortOrder: i })),
      );
      return { prev };
    },
    onError: (e, _, ctx) => {
      qc.setQueryData(KEY, ctx.prev);
      toast(`Couldn't save order: ${e.message}`, 'error');
    },
    onSettled: () => qc.invalidateQueries({ queryKey: KEY }),
  });

  const move = (i, dir) => {
    const next = [...rows];
    [next[i], next[i + dir]] = [next[i + dir], next[i]];
    reorder.mutate(next);
  };

  const columns = [
    { key: 'pos', label: '#', render: (r) => rows.indexOf(r) + 1 },
    { key: 'name', label: 'Name' },
    { key: 'itemCount', label: 'Items', num: true },
    {
      key: 'isActive',
      label: 'Status',
      render: (r) => (r.isActive ? <Badge tone="ok">Active</Badge> : <Badge>Inactive</Badge>),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (r) => {
        const i = rows.indexOf(r);
        return (
          <div className="actions">
            <Button
              className="icon-btn"
              aria-label={`Move ${r.name} up`}
              disabled={i === 0 || reorder.isPending}
              onClick={() => move(i, -1)}
            >
              ▲
            </Button>
            <Button
              className="icon-btn"
              aria-label={`Move ${r.name} down`}
              disabled={i === rows.length - 1 || reorder.isPending}
              onClick={() => move(i, 1)}
            >
              ▼
            </Button>
            <Button onClick={() => setEditing({ _id: r._id, name: r.name })}>Edit</Button>
            <Button variant={r.isActive ? 'danger' : 'default'} onClick={() => setToggling(r)}>
              {r.isActive ? 'Deactivate' : 'Activate'}
            </Button>
          </div>
        );
      },
    },
  ];

  const trimmed = name.trim();

  return (
    <div className="stack">
      <form
        className="toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          if (trimmed) create.mutate(trimmed);
        }}
      >
        <Input
          className="grow"
          aria-label="New category name"
          placeholder="New category, e.g. Breakfast"
          maxLength={40}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Button type="submit" variant="primary" loading={create.isPending} disabled={!trimmed}>
          Add category
        </Button>
      </form>

      {error ? (
        <div className="panel pad">
          <p className="muted">Couldn't load categories: {error.message}</p>
          <Button onClick={() => refetch()}>Retry</Button>
        </div>
      ) : (
        <Table
          columns={columns}
          rows={rows}
          loading={isLoading}
          empty="No categories yet. Add your first one above."
        />
      )}

      <Modal
        open={!!editing}
        onClose={() => setEditing(null)}
        title="Rename category"
        footer={
          <div className="actions">
            <Button onClick={() => setEditing(null)}>Cancel</Button>
            <Button
              variant="dark"
              type="submit"
              form="rename-category"
              loading={update.isPending}
              disabled={!editing?.name.trim()}
            >
              Save
            </Button>
          </div>
        }
      >
        <form
          id="rename-category"
          onSubmit={(e) => {
            e.preventDefault();
            update.mutate({ id: editing._id, name: editing.name.trim() });
          }}
        >
          <Input
            label="Name"
            maxLength={40}
            value={editing?.name ?? ''}
            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
          />
        </form>
      </Modal>

      <Modal
        open={!!toggling}
        onClose={() => setToggling(null)}
        title={toggling?.isActive ? 'Deactivate category?' : 'Activate category?'}
        footer={
          <div className="actions">
            <Button onClick={() => setToggling(null)}>Cancel</Button>
            {toggling?.isActive ? (
              <Button
                variant="danger"
                loading={deactivate.isPending}
                onClick={() => deactivate.mutate(toggling._id)}
              >
                Deactivate
              </Button>
            ) : (
              <Button
                variant="dark"
                loading={update.isPending}
                onClick={() => update.mutate({ id: toggling._id, isActive: true })}
              >
                Activate
              </Button>
            )}
          </div>
        }
      >
        {toggling &&
          (toggling.isActive ? (
            <p>
              <strong>{toggling.name}</strong> will be hidden from POS.
              {toggling.itemCount > 0 &&
                ` ${toggling.itemCount} item${toggling.itemCount === 1 ? '' : 's'} in this category will be hidden from POS.`}
            </p>
          ) : (
            <p>
              <strong>{toggling.name}</strong> and its items will show on POS again.
            </p>
          ))}
      </Modal>
    </div>
  );
}
