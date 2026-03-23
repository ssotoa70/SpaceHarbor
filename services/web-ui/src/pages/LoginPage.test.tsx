import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";

/* ── Mock auth context ── */

const mockLogin = vi.fn();
const mockLogout = vi.fn();
const mockInitiateOidcLogin = vi.fn();
const mockHandleOidcCallback = vi.fn();

let mockAuthMode: "oidc" | "local" = "local";

vi.mock("../contexts/AuthContext", () => ({
  useAuth: () => ({
    state: "unauthenticated",
    user: null,
    permissions: [],
    authMode: mockAuthMode,
    isAuthenticated: false,
    login: mockLogin,
    logout: mockLogout,
    initiateOidcLogin: mockInitiateOidcLogin,
    handleOidcCallback: mockHandleOidcCallback,
  }),
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

import { LoginPage } from "./LoginPage";

function renderWithRouter(ui: ReactNode) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthMode = "local";
  });

  it("renders email/password form in local mode", () => {
    mockAuthMode = "local";
    renderWithRouter(<LoginPage />);

    expect(screen.getByTestId("email-input")).toBeInTheDocument();
    expect(screen.getByTestId("password-input")).toBeInTheDocument();
    expect(screen.getByTestId("login-button")).toBeInTheDocument();
    // SSO button should not be present
    expect(screen.queryByTestId("sso-button")).not.toBeInTheDocument();
  });

  it("renders SSO button in OIDC mode", () => {
    mockAuthMode = "oidc";
    renderWithRouter(<LoginPage />);

    expect(screen.getByTestId("sso-button")).toBeInTheDocument();
    expect(screen.getByText("Sign in with SSO")).toBeInTheDocument();
    // Email/password form should not be present
    expect(screen.queryByTestId("email-input")).not.toBeInTheDocument();
    expect(screen.queryByTestId("password-input")).not.toBeInTheDocument();
  });

  it("does not show registration link when env var is not set to true", () => {
    // VITE_ALLOW_REGISTRATION is not set in the test environment,
    // so the registration link should be absent.
    mockAuthMode = "local";
    renderWithRouter(<LoginPage />);

    expect(screen.queryByTestId("register-link")).not.toBeInTheDocument();
  });
});
