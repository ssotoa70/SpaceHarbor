import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { AuthProvider, useAuth } from "./AuthContext";
import type { AuthContextValue } from "./AuthContext";

/* ── Mock api module ── */

vi.mock("../api", () => ({
  getAccessToken: vi.fn(() => null),
  setAccessToken: vi.fn(),
  fetchAuthMe: vi.fn(() => Promise.reject(new Error("no token"))),
  authLogin: vi.fn(),
  authRefresh: vi.fn(),
}));

/* ── Helper: render a consumer that exposes auth context ── */

function AuthConsumer({ onAuth }: { onAuth: (ctx: AuthContextValue) => void }) {
  const ctx = useAuth();
  onAuth(ctx);
  return <div data-testid="auth-state">{ctx.state}</div>;
}

describe("AuthContext", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("initial state is loading then transitions to unauthenticated when no token", async () => {
    let captured: AuthContextValue | null = null;

    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer onAuth={(ctx) => { captured = ctx; }} />
        </AuthProvider>,
      );
    });

    // After mount + async check, state should be unauthenticated (no token)
    expect(captured).not.toBeNull();
    expect(captured!.state).toBe("unauthenticated");
    expect(captured!.user).toBeNull();
    expect(captured!.isAuthenticated).toBe(false);
  });

  it("provides useAuth hook with expected shape", async () => {
    let captured: AuthContextValue | null = null;

    await act(async () => {
      render(
        <AuthProvider>
          <AuthConsumer onAuth={(ctx) => { captured = ctx; }} />
        </AuthProvider>,
      );
    });

    expect(captured).not.toBeNull();
    expect(typeof captured!.login).toBe("function");
    expect(typeof captured!.logout).toBe("function");
    expect(typeof captured!.initiateOidcLogin).toBe("function");
    expect(typeof captured!.handleOidcCallback).toBe("function");
    expect(captured!.authMode).toBe("local"); // No VITE_OIDC_AUTHORITY in test env
    expect(Array.isArray(captured!.permissions)).toBe(true);
  });

  it("throws when useAuth is used outside AuthProvider", () => {
    function BadConsumer() {
      useAuth();
      return null;
    }

    // Suppress React error boundary console output
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      render(<BadConsumer />);
    }).toThrow("useAuth must be used within AuthProvider");

    spy.mockRestore();
  });
});
