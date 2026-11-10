import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { formatINR, toPaise, toRupees } from '../../money.js';
import { ImageUpload } from '../../components/ImageUpload.jsx';
import {
  Button,
  Input,
  Modal,
  Select,
  Table,
  Textarea,
  Toggle,
  useToast,
} from '../../components/ui.jsx';
import './Menu.css';

const blank = {
  name: '',
  categoryId: '',
  price: '',
  description: '',
  imageUrl: '',
  addOns: [],
  isAvailable: true,
};

const toForm = (item) => ({
  name: item.name,
  categoryId: item.categoryId,
  price: toRupees(item.price),
  description: item.description ?? '',
  imageUrl: item.imageUrl ?? '',
  addOns: item.addOns.map((a) => ({ name: a.name, price: toRupees(a.price) })),
  isAvailable: item.isAvailable,
});

/** Returns [body, errors]; body is null when there are errors. */
function toBody(f) {
  const errors = {};
  if (!f.name.trim()) errors.name = 'Name is required';
  if (!f.categoryId) errors.categoryId = 'Choose a category';
  const price = toPaise(f.price);
  if (Number.isNaN(price)) errors.price = 'Enter a price like 80 or 80.50';
  const addOns = f.addOns.map((a, i) => {
    const p = toPaise(a.price);
    if (!a.name.trim() || Number.isNaN(p)) errors[`addOn${i}`] = 'Name and a valid price required';
    return { name: a.name.trim(), price: p };
  });
  if (Object.keys(errors).length) return [null, errors];
  return [
    {
      name: f.name.trim(),
      categoryId: f.categoryId,
      price,
      description: f.description.trim(),
      imageUrl: f.imageUrl.trim(),
      addOns,
      isAvailable: f.isAvailable,
    },
    {},
  ];
}

function ItemModal({ item, categories, onClose }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState(() => (item?._id ? toForm(item) : blank));
  const [errors, setErrors] = useState({});
  const set = (patch) => setForm((f) => ({ ...f, ...patch }));
  const setAddOn = (i, patch) =>
    set({ addOns: form.addOns.map((a, j) => (j === i ? { ...a, ...patch } : a)) });

  const save = useMutation({
    mutationFn: (body) =>
      item?._id
        ? api(`/menu-items/${item._id}`, { method: 'PATCH', body })
        : api('/menu-items', { method: 'POST', body }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu-items'] });
      toast(item?._id ? 'Item updated' : 'Item added');
      onClose();
    },
    onError: (err) => setErrors({ form: err.message }),
  });

  const submit = (e) => {
    e.preventDefault();
    const [body, errs] = toBody(form);
    setErrors(errs);
    if (body) save.mutate(body);
  };

  // Keep an inactive current category selectable so editing doesn't silently blank it.
  const options = categories.filter((c) => c.isActive || c._id === form.categoryId);

  return (
    <Modal
      open
      onClose={onClose}
      title={item?._id ? 'Edit item' : 'Add item'}
      footer={
        <div className="actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="dark" type="submit" form="menu-item-form" loading={save.isPending}>
            Save
          </Button>
        </div>
      }
    >
      <form id="menu-item-form" className="stack" onSubmit={submit} noValidate>
        {errors.form && (
          <div className="field-error" role="alert">
            {errors.form}
          </div>
        )}
        <div className="form-grid">
          <Input
            label="Name"
            value={form.name}
            maxLength={80}
            onChange={(e) => set({ name: e.target.value })}
            error={errors.name}
            autoFocus
          />
          <Select
            label="Category"
            value={form.categoryId}
            onChange={(e) => set({ categoryId: e.target.value })}
            error={errors.categoryId}
          >
            <option value="">Choose…</option>
            {options.map((c) => (
              <option key={c._id} value={c._id}>
                {c.name}
              </option>
            ))}
          </Select>
          <Input
            label="Price (₹)"
            inputMode="decimal"
            placeholder="80.00"
            value={form.price}
            onChange={(e) => set({ price: e.target.value })}
            error={errors.price}
          />
          <Toggle
            label="Available"
            checked={form.isAvailable}
            onChange={(e) => set({ isAvailable: e.target.checked })}
          />
          <Textarea
            className="span-all"
            label="Description"
            maxLength={300}
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
          />
          <div className="span-all">
            <ImageUpload value={form.imageUrl} onChange={(imageUrl) => set({ imageUrl })} />
          </div>
        </div>

        <fieldset className="menu-addons">
          <legend className="lbl">Add-ons</legend>
          {form.addOns.map((a, i) => (
            <div key={i}>
              <div className="menu-addon-row">
                <Input
                  aria-label={`Add-on ${i + 1} name`}
                  placeholder="Extra cheese"
                  maxLength={40}
                  value={a.name}
                  onChange={(e) => setAddOn(i, { name: e.target.value })}
                />
                <Input
                  aria-label={`Add-on ${i + 1} price in rupees`}
                  placeholder="20.00"
                  inputMode="decimal"
                  value={a.price}
                  onChange={(e) => setAddOn(i, { price: e.target.value })}
                />
                <Button
                  variant="danger"
                  onClick={() => set({ addOns: form.addOns.filter((_, j) => j !== i) })}
                >
                  Remove
                </Button>
              </div>
              {errors[`addOn${i}`] && <div className="field-error">{errors[`addOn${i}`]}</div>}
            </div>
          ))}
          {form.addOns.length < 20 && (
            <div>
              <Button onClick={() => set({ addOns: [...form.addOns, { name: '', price: '' }] })}>
                + Add-on
              </Button>
            </div>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}

export function MenuPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [category, setCategory] = useState('');
  const [searchText, setSearchText] = useState('');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(null); // {} = new, item = edit
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(searchText.trim()), 250);
    return () => clearTimeout(t);
  }, [searchText]);

  const cats = useQuery({ queryKey: ['categories'], queryFn: () => api('/categories') });
  const categories = Array.isArray(cats.data) ? cats.data : [];
  const catName = Object.fromEntries(categories.map((c) => [c._id, c.name]));

  const params = new URLSearchParams();
  if (category) params.set('category', category);
  if (search) params.set('search', search);
  const items = useQuery({
    queryKey: ['menu-items', { category, search }],
    queryFn: () => api(`/menu-items?${params}`),
  });

  const toggle = useMutation({
    mutationFn: ({ id, isAvailable }) =>
      api(`/menu-items/${id}`, { method: 'PATCH', body: { isAvailable } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['menu-items'] }),
    onError: (err) => toast(err.message, 'error'),
  });

  const remove = useMutation({
    mutationFn: (id) => api(`/menu-items/${id}`, { method: 'DELETE' }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['menu-items'] });
      toast('Item deleted');
      setDeleting(null);
    },
    onError: (err) => toast(err.message, 'error'),
  });

  const columns = [
    {
      key: 'img',
      label: '',
      render: (r) =>
        r.imageUrl ? (
          <img className="menu-thumb" src={r.imageUrl} alt="" loading="lazy" />
        ) : (
          <span className="menu-thumb menu-thumb-empty" aria-hidden="true" />
        ),
    },
    {
      key: 'name',
      label: 'Item',
      render: (r) => (
        <div>
          <b>{r.name}</b>
          {r.description && <div className="muted menu-desc">{r.description}</div>}
        </div>
      ),
    },
    { key: 'cat', label: 'Category', render: (r) => catName[r.categoryId] ?? '—' },
    { key: 'price', label: 'Price', num: true, render: (r) => formatINR(r.price) },
    { key: 'addOns', label: 'Add-ons', num: true, render: (r) => r.addOns.length || '—' },
    {
      key: 'avail',
      label: 'Available',
      render: (r) => (
        <Toggle
          aria-label={`${r.name} available`}
          checked={r.isAvailable}
          disabled={toggle.isPending && toggle.variables?.id === r._id}
          onChange={(e) => toggle.mutate({ id: r._id, isAvailable: e.target.checked })}
        />
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (r) => (
        <div className="actions">
          <Button onClick={() => setEditing(r)}>Edit</Button>
          <Button variant="danger" onClick={() => setDeleting(r)}>
            Delete
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="stack">
      <div className="toolbar">
        <Select
          aria-label="Filter by category"
          value={category}
          onChange={(e) => setCategory(e.target.value)}
        >
          <option value="">All categories</option>
          {categories.map((c) => (
            <option key={c._id} value={c._id}>
              {c.name}
            </option>
          ))}
        </Select>
        <Input
          type="search"
          aria-label="Search items"
          placeholder="Search items…"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
        />
        <span className="grow" />
        <Button variant="primary" onClick={() => setEditing({})}>
          Add item
        </Button>
      </div>

      {items.isError ? (
        <div className="panel pad center-msg">
          <p>{items.error.message}</p>
          <Button onClick={() => items.refetch()}>Retry</Button>
        </div>
      ) : (
        <Table
          columns={columns}
          rows={items.data ?? []}
          loading={items.isPending}
          empty={search || category ? 'No items match' : 'No menu items yet. Add your first item.'}
        />
      )}

      {editing && (
        <ItemModal
          key={editing._id ?? 'new'}
          item={editing}
          categories={categories}
          onClose={() => setEditing(null)}
        />
      )}

      <Modal
        open={!!deleting}
        onClose={() => setDeleting(null)}
        title={`Delete ${deleting?.name ?? 'item'}?`}
        footer={
          <div className="actions">
            <Button onClick={() => setDeleting(null)}>Cancel</Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => remove.mutate(deleting._id)}
            >
              Delete
            </Button>
          </div>
        }
      >
        <p>Past bills keep this item; it will disappear from POS.</p>
      </Modal>
    </div>
  );
}
