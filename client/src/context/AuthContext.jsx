import { createContext, useContext, useEffect, useState } from 'react';
import { api, refreshSession, setAccessToken, setSessionLostHandler } from '../api/client.js';

const AuthContext = createContext(null);

// Idle auto-logout (web-flow §12): default 8 h for shift use, override with VITE_IDLE_LOGOUT_MINUTES.
const IDLE_MS = (Number(import.meta.env.VITE_IDLE_LOGOUT_MINUTES) || 480) * 60 * 1000;
const LAST_ACTIVE = 'pamaa.lastActive'; // survives reloads so a refresh can't revive an idle session
const readLastActive = () => {
  try {
    return Number(localStorage.getItem(LAST_ACTIVE)) || 0;
  } catch {
    return 0;
  }
};
const markActive = () => {
  try {
    localStorage.setItem(LAST_ACTIVE, String(Date.now()));
  } catch {
    /* storage blocked: idle timer still works in memory */
  }
};

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setSessionLostHandler(() => setUser(null));
    const last = readLastActive();
    const expired = last && Date.now() - last > IDLE_MS;
    (expired
      ? api('/auth/logout', { method: 'POST' }).then(
          () => null,
          () => null,
        )
      : refreshSession()
    ).then((data) => {
      setUser(data?.user ?? null);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    if (!user) return;
    let lastActive = Date.now();
    markActive();
    let lastWrite = lastActive;
    const onActivity = () => {
      lastActive = Date.now();
      if (lastActive - lastWrite > 60_000) {
        lastWrite = lastActive; // throttle storage writes to once a minute
        markActive();
      }
    };
    const events = ['pointerdown', 'keydown', 'touchstart'];
    events.forEach((e) => window.addEventListener(e, onActivity, { passive: true }));
    const timer = setInterval(() => {
      if (Date.now() - lastActive > IDLE_MS) {
        api('/auth/logout', { method: 'POST' }).catch(() => {});
        setAccessToken(null);
        setUser(null);
      }
    }, 60_000);
    return () => {
      events.forEach((e) => window.removeEventListener(e, onActivity));
      clearInterval(timer);
    };
  }, [user]);

  const login = async (username, password) => {
    const data = await api('/auth/login', { method: 'POST', body: { username, password } });
    setAccessToken(data.accessToken);
    setUser(data.user);
    return data.user;
  };

  const logout = async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => {});
    setAccessToken(null);
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, loading, login, logout }}>{children}</AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
