import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { Badge, Button, Input, Modal, Select, Toggle, useToast } from '../../components/ui.jsx';
import './Tables.css';

export const STATUS = {
  available: ['ok', 'Available'],
  occupied: ['busy', 'Occupied'],
  billing: ['bill', 'Billing'],
};

export function TablesPage() {
  const [section, setSection] = useState('');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState(null); // null = closed, {} = new, table = edit

  const {
    data: tables = [],
    isLoading,
    error,
    refetch,
  } = useQuery({
    queryKey: ['tables'],
    queryFn: () => api('/tables'),
  });

  const sections = [...new Set(tables.map((t) => t.section).filter(Boolean))].sort();
  const shown = tables.filter(
    (t) => (showInactive || t.isActive) && (!section || t.section === section),
  );

  let body;
  if (isLoading) {
    body = (
      <div className="tgrid" aria-busy="true">
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="tcard">
            <span className="skeleton" />
          </div>
        ))}
      </div>
    );
  } else if (error) {
    body = (
      <div className="panel pad tempty">
        <p>Couldn't load tables: {error.message}</p>
        <Button onClick={() => refetch()}>Retry</Button>
      </div>
    );
  } else if (tables.length === 0) {
    body = (
      <div className="panel pad tempty">
        <p>No tables yet — add your first table</p>
        <Button variant="primary" onClick={() => setEditing({})}>
          Add table
        </Button>
      </div>
    );
  } else if (shown.length === 0) {
    body = <div className="panel pad tempty muted">No tables match this filter.</div>;
  } else {
    body = (
      <div className="tgrid">
        {shown.map((t) => {
          const [tone, label] = STATUS[t.status] ?? STATUS.available;
          return (
            <button
              key={t._id}
              type="button"
              className={`tcard ${t.isActive ? (t.status === 'available' ? '' : tone) : 'off'}`}
              onClick={() => setEditing(t)}
              aria-label={`Edit table ${t.tableNumber}`}
            >
              <b>{t.tableNumber}</b>
              {t.isActive ? <Badge tone={tone}>{label}</Badge> : <Badge>Inactive</Badge>}
              <small>
                {t.capacity} {t.capacity === 1 ? 'seat' : 'seats'}
                {t.section && ` · ${t.section}`}
              </small>
            </button>
          );
        })}
      </div>
    );
  }

  return (
    <>
      <div className="toolbar">
        <Select
          aria-label="Section"
          value={section}
          onChange={(e) => setSection(e.target.value)}
          disabled={!sections.length}
        >
          <option value="">All sections</option>
          {sections.map((s) => (
            <option key={s}>{s}</option>
          ))}
        </Select>
        <Toggle
          label="Show inactive"
          checked={showInactive}
          onChange={(e) => setShowInactive(e.target.checked)}
        />
        <div className="grow" />
        <Button variant="primary" onClick={() => setEditing({})}>
          Add table
        </Button>
      </div>
      {body}
      {editing && (
        <TableModal table={editing} sections={sections} onClose={() => setEditing(null)} />
      )}
    </>
  );
}

function TableModal({ table, sections, onClose }) {
  const isNew = !table._id;
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState({
    tableNumber: table.tableNumber ?? '',
    capacity: table.capacity ?? 4,
    section: table.section ?? '',
  });
  const [confirming, setConfirming] = useState(false);

  const save = useMutation({
    mutationFn: (body) =>
      api(isNew ? '/tables' : `/tables/${table._id}`, { method: isNew ? 'POST' : 'PATCH', body }),
    onSuccess: (_, body) => {
      qc.invalidateQueries({ queryKey: ['tables'] });
      const verb = 'isActive' in body ? (body.isActive ? 'activated' : 'deactivated') : 'saved';
      toast(`Table ${verb}`);
      onClose();
    },
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const submit = (e) => {
    e.preventDefault();
    save.mutate({ ...form, capacity: Number(form.capacity) });
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={isNew ? 'Add table' : `Edit table ${table.tableNumber}`}
      footer={
        confirming ? (
          <>
            <span className="grow muted">
              {table.isActive
                ? 'Deactivate this table? It will be hidden from POS.'
                : 'Activate this table?'}
            </span>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button
              variant={table.isActive ? 'danger' : 'primary'}
              loading={save.isPending}
              onClick={() => save.mutate({ isActive: !table.isActive })}
            >
              Yes, {table.isActive ? 'deactivate' : 'activate'}
            </Button>
          </>
        ) : (
          <>
            {!isNew && (
              <Button
                variant={table.isActive ? 'danger' : 'default'}
                onClick={() => {
                  save.reset();
                  setConfirming(true);
                }}
              >
                {table.isActive ? 'Deactivate' : 'Activate'}
              </Button>
            )}
            <span className="grow" />
            <Button onClick={onClose}>Cancel</Button>
            <Button variant="primary" type="submit" form="table-form" loading={save.isPending}>
              {isNew ? 'Add table' : 'Save'}
            </Button>
          </>
        )
      }
    >
      <form id="table-form" className="form-grid" onSubmit={submit}>
        <Input
          label="Table number"
          value={form.tableNumber}
          onChange={set('tableNumber')}
          required
          maxLength={10}
          placeholder="T5"
          autoFocus
          style={{ textTransform: 'uppercase' }}
        />
        <Input
          label="Capacity"
          type="number"
          inputMode="numeric"
          min={1}
          max={50}
          step={1}
          required
          value={form.capacity}
          onChange={set('capacity')}
        />
        <Input
          className="span-all"
          label="Section"
          hint="Optional, e.g. Patio, AC Hall"
          list="table-sections"
          maxLength={40}
          value={form.section}
          onChange={set('section')}
        />
        <datalist id="table-sections">
          {sections.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        {save.error && (
          <div className="span-all field-error" role="alert">
            {save.error.message}
          </div>
        )}
      </form>
    </Modal>
  );
}
