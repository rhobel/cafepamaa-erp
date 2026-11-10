import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client.js';
import { ImageUpload } from '../../components/ImageUpload.jsx';
import { Button, Input, Select, Textarea, Toggle, useToast } from '../../components/ui.jsx';
import './Settings.css';

const FIELDS = [
  'name',
  'address',
  'phone',
  'gstin',
  'logoUrl',
  'gstRate',
  'pricesIncludeTax',
  'invoicePrefix',
  'invoiceStartNumber',
  'invoiceFooter',
  'printFormat',
];

const pick = (s) => Object.fromEntries(FIELDS.map((k) => [k, s[k] ?? '']));

// Mirrors financialYear() in server/src/services/counters.js (IST, April start).
function financialYear(date = new Date()) {
  const ist = new Date(date.getTime() + 330 * 60 * 1000);
  const y = ist.getUTCFullYear();
  const start = ist.getUTCMonth() >= 3 ? y : y - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

export function SettingsPage() {
  const query = useQuery({ queryKey: ['settings'], queryFn: () => api('/settings') });

  if (query.isPending) return <div className="panel pad muted">Loading settings…</div>;
  if (query.isError)
    return (
      <div className="panel pad stack">
        <p>Could not load settings: {query.error.message}</p>
        <div>
          <Button onClick={() => query.refetch()}>Retry</Button>
        </div>
      </div>
    );
  // Remount with fresh values whenever the saved doc changes.
  return <SettingsForm key={query.data.updatedAt} saved={pick(query.data)} />;
}

function SettingsForm({ saved }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [form, setForm] = useState(saved);
  const [errors, setErrors] = useState({});

  const save = useMutation({
    mutationFn: (body) => api('/settings', { method: 'PUT', body }),
    onSuccess: (data) => {
      qc.setQueryData(['settings'], data);
      qc.invalidateQueries({ queryKey: ['settings'] });
      toast('Settings saved');
    },
    onError: (err) => {
      setErrors(
        Object.fromEntries(
          (Array.isArray(err.data) ? err.data : []).map((e) => [e.path, e.message]),
        ),
      );
      toast(err.message, 'error');
    },
  });

  const dirty = JSON.stringify(form) !== JSON.stringify(saved);
  const set = (k) => (e) => {
    const v = e?.target ? (e.target.type === 'checkbox' ? e.target.checked : e.target.value) : e;
    setForm((f) => ({ ...f, [k]: v }));
  };

  const rate = Number(form.gstRate);
  const half = Number.isFinite(rate) ? +(rate / 2).toFixed(3) : 0;
  const prefix = (form.invoicePrefix || 'INV').toUpperCase();
  const startNo = String(Math.max(1, parseInt(form.invoiceStartNumber, 10) || 1)).padStart(5, '0');

  const onSubmit = (e) => {
    e.preventDefault();
    save.mutate({
      ...form,
      gstRate: form.gstRate === '' ? NaN : Number(form.gstRate),
      invoiceStartNumber: form.invoiceStartNumber === '' ? NaN : Number(form.invoiceStartNumber),
    });
  };

  return (
    <form className="stack settings-page" onSubmit={onSubmit} noValidate>
      <section className="panel pad stack">
        <h2>Restaurant</h2>
        <div className="form-grid">
          <Input
            label="Name"
            required
            maxLength={80}
            value={form.name}
            onChange={set('name')}
            error={errors.name}
          />
          <Input
            label="Phone"
            type="tel"
            value={form.phone}
            onChange={set('phone')}
            error={errors.phone}
          />
          <Textarea
            className="span-all"
            label="Address"
            rows={3}
            maxLength={300}
            value={form.address}
            onChange={set('address')}
            error={errors.address}
          />
          <Input
            label="GSTIN"
            maxLength={15}
            value={form.gstin}
            onChange={(e) => set('gstin')(e.target.value.toUpperCase())}
            error={errors.gstin}
            hint="15 characters, e.g. 29ABCDE1234F1Z5"
          />
          <div className="span-all">
            <ImageUpload label="Logo" value={form.logoUrl} onChange={set('logoUrl')} />
            {errors.logoUrl && <div className="field-error">{errors.logoUrl}</div>}
          </div>
        </div>
      </section>

      <section className="panel pad stack">
        <h2>Tax</h2>
        <div className="form-grid">
          <Input
            label="GST rate (%)"
            type="number"
            min={0}
            max={28}
            step={0.01}
            value={form.gstRate}
            onChange={set('gstRate')}
            error={errors.gstRate}
            hint={`CGST ${half}% + SGST ${half}%`}
          />
          <div className="settings-toggle">
            <Toggle
              label="Prices include tax"
              checked={!!form.pricesIncludeTax}
              onChange={set('pricesIncludeTax')}
            />
          </div>
        </div>
      </section>

      <section className="panel pad stack">
        <h2>Invoice</h2>
        <div className="form-grid">
          <Input
            label="Invoice prefix"
            maxLength={10}
            value={form.invoicePrefix}
            onChange={(e) => set('invoicePrefix')(e.target.value.toUpperCase())}
            error={errors.invoicePrefix}
          />
          <Input
            label="Starting number"
            type="number"
            min={1}
            step={1}
            value={form.invoiceStartNumber}
            onChange={set('invoiceStartNumber')}
            error={errors.invoiceStartNumber}
          />
          <p className="span-all muted">
            Preview: <strong>{`${prefix}/${financialYear()}/${startNo}`}</strong>
          </p>
          <Input
            className="span-all"
            label="Invoice footer"
            maxLength={200}
            value={form.invoiceFooter}
            onChange={set('invoiceFooter')}
            error={errors.invoiceFooter}
          />
          <Select
            label="Print format"
            value={form.printFormat}
            onChange={set('printFormat')}
            error={errors.printFormat}
          >
            <option value="80mm">80mm thermal</option>
            <option value="A4">A4</option>
          </Select>
        </div>
      </section>

      <div className="actions">
        <Button type="submit" variant="primary" disabled={!dirty} loading={save.isPending}>
          Save settings
        </Button>
      </div>
    </form>
  );
}
