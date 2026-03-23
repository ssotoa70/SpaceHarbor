import { useMemo } from "react";
import type { ReactNode } from "react";
import { useAuth } from "../contexts/AuthContext";

/**
 * Hook: returns true if the current user has the specified permission.
 */
export function useHasPermission(permission: string): boolean {
  const { permissions } = useAuth();
  return useMemo(() => permissions.includes(permission), [permissions, permission]);
}

/**
 * Renders children only when the user holds the required permission.
 * Optionally renders a `fallback` instead of nothing.
 */
export function PermissionGate({
  permission,
  children,
  fallback = null,
}: {
  permission: string;
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const allowed = useHasPermission(permission);
  return <>{allowed ? children : fallback}</>;
}
