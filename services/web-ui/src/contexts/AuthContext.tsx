import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import { fetchAuthMe, authLogin, authRefresh, authRevoke, getAccessToken, setAccessToken } from "../api";

/* ── Types ── */

export type AuthState = "loading" | "authenticated" | "unauthenticated";
export type AuthMode = "oidc" | "local";

export interface AuthUser {
  id: string;
  email: string;
  displayName: string;
  roles: string[];
}

export interface AuthContextValue {
  state: AuthState;
  user: AuthUser | null;
  permissions: string[];
  authMode: AuthMode;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  initiateOidcLogin: () => void;
  handleOidcCallback: (code: string, codeVerifier: string) => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/* ── PKCE helpers ── */

function generateCodeVerifier(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/* ── JWT exp parsing ── */

function parseJwtExp(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

/* ── Provider ── */

const OIDC_AUTHORITY = import.meta.env.VITE_OIDC_AUTHORITY as string | undefined;
const OIDC_CLIENT_ID = import.meta.env.VITE_OIDC_CLIENT_ID as string | undefined;
const OIDC_REDIRECT_URI = import.meta.env.VITE_OIDC_REDIRECT_URI as string | undefined;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>("loading");
  const [user, setUser] = useState<AuthUser | null>(null);
  const [permissions, setPermissions] = useState<string[]>([]);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const refreshTokenRef = useRef<string | null>(null);

  const authMode: AuthMode = OIDC_AUTHORITY ? "oidc" : "local";

  /* ── Schedule token refresh ── */
  const scheduleRefresh = useCallback((token: string) => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    const exp = parseJwtExp(token);
    if (!exp) return;

    const nowSec = Math.floor(Date.now() / 1000);
    const refreshInMs = Math.max((exp - nowSec - 60) * 1000, 5000);

    refreshTimerRef.current = setTimeout(async () => {
      try {
        const rt = refreshTokenRef.current;
        if (!rt) {
          // No refresh token — try to keep using current token if not expired
          const currentToken = getAccessToken();
          const currentExp = currentToken ? parseJwtExp(currentToken) : null;
          if (currentExp && currentExp > Math.floor(Date.now() / 1000)) {
            // Token still valid, retry refresh later
            scheduleRefresh(currentToken!);
            return;
          }
          setState("unauthenticated");
          return;
        }
        const result = await authRefresh(rt);
        setAccessToken(result.accessToken);
        refreshTokenRef.current = result.refreshToken ?? rt;
        scheduleRefresh(result.accessToken);
      } catch {
        // On refresh failure, retry once more before giving up
        const currentToken = getAccessToken();
        const currentExp = currentToken ? parseJwtExp(currentToken) : null;
        if (currentExp && currentExp > Math.floor(Date.now() / 1000) + 10) {
          // Token still has >10s — schedule another retry
          scheduleRefresh(currentToken!);
          return;
        }
        setAccessToken(null);
        refreshTokenRef.current = null;
        setUser(null);
        setPermissions([]);
        setState("unauthenticated");
      }
    }, refreshInMs);
  }, []);

  /* ── Check existing session on mount ── */
  useEffect(() => {
    const token = getAccessToken();
    if (!token) {
      setState("unauthenticated");
      return;
    }

    // Check if token is expired before calling /auth/me
    const exp = parseJwtExp(token);
    if (exp && exp < Math.floor(Date.now() / 1000)) {
      setAccessToken(null);
      setState("unauthenticated");
      return;
    }

    void fetchAuthMe()
      .then((me) => {
        setUser({ id: me.id ?? me.userId ?? "", email: me.email, displayName: me.displayName, roles: me.roles });
        setPermissions(me.permissions);
        setState("authenticated");
        scheduleRefresh(token);
      })
      .catch((err) => {
        // Only logout on definitive auth failures (401), not transient errors
        if (err instanceof Error && "status" in err && (err as any).status === 401) {
          setAccessToken(null);
          setState("unauthenticated");
        } else {
          // Network error or server issue — keep the token, try to use it
          // Parse user info from the JWT itself as fallback
          try {
            const parts = token.split(".");
            if (parts.length === 3) {
              const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
              setUser({
                id: payload.sub ?? "",
                email: payload.email ?? "",
                displayName: payload.display_name ?? payload.email ?? "",
                roles: payload.roles ?? [],
              });
              // No permissions from JWT — set from roles if possible
              setState("authenticated");
              scheduleRefresh(token);
            } else {
              setAccessToken(null);
              setState("unauthenticated");
            }
          } catch {
            setAccessToken(null);
            setState("unauthenticated");
          }
        }
      });
  }, [scheduleRefresh]);

  /* ── Cleanup timer on unmount ── */
  useEffect(() => {
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
    };
  }, []);

  /* ── Login (local mode) ── */
  const login = useCallback(async (email: string, password: string) => {
    const result = await authLogin(email, password);
    setAccessToken(result.accessToken);
    refreshTokenRef.current = result.refreshToken ?? null;
    setUser({
      id: result.user.id,
      email: result.user.email,
      displayName: result.user.displayName,
      roles: result.user.roles,
    });
    setPermissions(result.user.permissions ?? []);
    setState("authenticated");
    scheduleRefresh(result.accessToken);
  }, [scheduleRefresh]);

  /* ── Logout ── */
  const logout = useCallback(() => {
    if (refreshTimerRef.current) {
      clearTimeout(refreshTimerRef.current);
      refreshTimerRef.current = null;
    }

    // Fire-and-forget: revoke the refresh token server-side before clearing
    // local state. We do NOT await this — if the server is unreachable the
    // user must still be logged out locally. The token will expire naturally.
    const rt = refreshTokenRef.current;
    if (rt) {
      void authRevoke(rt).catch(() => {
        // Intentionally swallowed — local logout must always succeed even if
        // the revocation request fails (e.g. server down, network error).
      });
    }

    setAccessToken(null);
    refreshTokenRef.current = null;
    setUser(null);
    setPermissions([]);
    setState("unauthenticated");
  }, []);

  /* ── OIDC redirect ── */
  const initiateOidcLogin = useCallback(() => {
    if (!OIDC_AUTHORITY || !OIDC_CLIENT_ID) return;

    const codeVerifier = generateCodeVerifier();
    // Store verifier in sessionStorage for the callback (survives redirect)
    sessionStorage.setItem("ah_pkce_verifier", codeVerifier);

    void generateCodeChallenge(codeVerifier).then((codeChallenge) => {
      const redirectUri = OIDC_REDIRECT_URI ?? `${window.location.origin}/login`;
      const state = crypto.getRandomValues(new Uint8Array(16)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "");
      sessionStorage.setItem("ah_oidc_state", state);

      const params = new URLSearchParams({
        response_type: "code",
        client_id: OIDC_CLIENT_ID,
        redirect_uri: redirectUri,
        scope: "openid email profile",
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        state,
      });

      window.location.href = `${OIDC_AUTHORITY}/authorize?${params.toString()}`;
    });
  }, []);

  /* ── OIDC callback: exchange code for token ── */
  const handleOidcCallback = useCallback(async (code: string, codeVerifier: string) => {
    if (!OIDC_AUTHORITY || !OIDC_CLIENT_ID) {
      throw new Error("OIDC not configured");
    }

    const redirectUri = OIDC_REDIRECT_URI ?? `${window.location.origin}/login`;
    const tokenUrl = `${OIDC_AUTHORITY}/token`;

    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: OIDC_CLIENT_ID,
      code_verifier: codeVerifier,
    });

    const response = await fetch(tokenUrl, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!response.ok) {
      throw new Error("Token exchange failed");
    }

    const data = (await response.json()) as {
      access_token: string;
      refresh_token?: string;
      id_token?: string;
    };

    setAccessToken(data.access_token);
    refreshTokenRef.current = data.refresh_token ?? null;

    // Fetch user info from our backend
    const me = await fetchAuthMe();
    setUser({ id: me.id ?? me.userId ?? "", email: me.email, displayName: me.displayName, roles: me.roles });
    setPermissions(me.permissions);
    setState("authenticated");
    scheduleRefresh(data.access_token);
  }, [scheduleRefresh]);

  const value = useMemo<AuthContextValue>(() => ({
    state,
    user,
    permissions,
    authMode,
    isAuthenticated: state === "authenticated",
    login,
    logout,
    initiateOidcLogin,
    handleOidcCallback,
  }), [state, user, permissions, authMode, login, logout, initiateOidcLogin, handleOidcCallback]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
