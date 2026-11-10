import { useState } from 'react';
import { api } from '../api/client.js';
import { Button, Input } from './ui.jsx';

const MAX_BYTES = 2 * 1024 * 1024;

/** Uploads straight to Cloudinary using a server signature; falls back to a pasted URL when not configured.
 *  <ImageUpload label="Image" value={url} onChange={setUrl} /> */
export function ImageUpload({ label = 'Image', value, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError('Choose an image file');
    if (file.size > MAX_BYTES) return setError('Image must be 2 MB or smaller');
    setBusy(true);
    setError('');
    try {
      const s = await api('/uploads/sign', { method: 'POST' });
      const form = new FormData();
      form.append('file', file);
      form.append('api_key', s.apiKey);
      form.append('timestamp', s.timestamp);
      form.append('signature', s.signature);
      form.append('folder', s.folder);
      const res = await fetch(`https://api.cloudinary.com/v1_1/${s.cloudName}/image/upload`, {
        method: 'POST',
        body: form,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? 'Upload failed');
      onChange(json.secure_url);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="image-upload">
      {value && <img src={value} alt="" className="image-upload-preview" />}
      <Input
        label={label}
        type="url"
        placeholder="https://…"
        value={value ?? ''}
        onChange={(e) => onChange(e.target.value)}
        error={error}
        hint="Upload a file or paste an image URL"
      />
      <div className="row">
        <label className="btn" aria-busy={busy || undefined}>
          {busy ? 'Uploading…' : 'Upload file'}
          <input type="file" accept="image/*" hidden onChange={onFile} disabled={busy} />
        </label>
        {value && (
          <Button variant="danger" onClick={() => onChange('')}>
            Remove
          </Button>
        )}
      </div>
    </div>
  );
}
