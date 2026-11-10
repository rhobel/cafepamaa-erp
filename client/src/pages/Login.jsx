import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useAuth } from '../context/AuthContext.jsx';
import { HOME } from '../nav.js';
import { Button, Input } from '../components/ui.jsx';

export function Login() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={HOME[user.role]} replace />;

  const onSubmit = async (e) => {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    setBusy(true);
    setError('');
    try {
      const u = await login(form.get('username'), form.get('password'));
      navigate(HOME[u.role], { replace: true });
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="panel login-card" onSubmit={onSubmit}>
        <div className="logo">
          <div className="logo-mark">
            <i />
          </div>
          <div>
            <b>PAMAA</b>
            <span>Billing &amp; POS</span>
          </div>
        </div>
        <h1>Sign in</h1>
        <Input label="Username" name="username" autoComplete="username" autoFocus required />
        <Input
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        {error && (
          <div className="form-error" role="alert">
            {error}
          </div>
        )}
        <Button type="submit" variant="primary" loading={busy} className="btn-block">
          Sign in
        </Button>
      </form>
    </div>
  );
}
