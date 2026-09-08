import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { Navigate, Outlet } from "react-router-dom";
import { api, getAuthToken, setAuthToken, type AuthUser, type SetupStatus } from "./api";

type AuthContextValue = {
  status: SetupStatus | null;
  user: AuthUser | null;
  loading: boolean;
  refresh: () => Promise<SetupStatus | null>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function workspaceHref(status: SetupStatus | null) {
  if (!status) return "/setup";
  if (status.skip || (status.complete && status.authenticated)) return "/app";
  if (status.complete) return "/login";
  return "/setup";
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<SetupStatus | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      const next = await api.setupStatus();
      setStatus(next);
      if (next.skip) {
        setUser({ id: "demo", name: "You", email: "demo@localhost", role: "owner", seatId: "you" });
      } else if (next.authenticated && getAuthToken()) {
        try {
          setUser(await api.me());
        } catch {
          setUser(null);
        }
      } else {
        setUser(null);
      }
      return next;
    } catch {
      setStatus(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const login = useCallback(
    async (email: string, password: string) => {
      const out = await api.login(email, password);
      setAuthToken(out.token);
      setUser(out.user);
      await refresh();
    },
    [refresh],
  );

  const logout = useCallback(async () => {
    try {
      await api.logout();
    } catch {
      /* token may already be gone */
    }
    setAuthToken("");
    setUser(null);
    await refresh();
  }, [refresh]);

  const value = useMemo(
    () => ({ status, user, loading, refresh, login, logout }),
    [status, user, loading, refresh, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth requires AuthProvider");
  return ctx;
}

function GateSplash() {
  return (
    <div className="setup-shell">
      <p className="micro">Loading…</p>
    </div>
  );
}

export function RequireWorkspace() {
  const { status, loading } = useAuth();
  if (loading) return <GateSplash />;
  if (!status) return <Outlet />;
  if (status.skip || (status.complete && status.authenticated)) return <Outlet />;
  if (!status.complete) return <Navigate to="/setup" replace />;
  return <Navigate to="/login" replace />;
}
