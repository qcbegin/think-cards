import { createFileRoute, redirect } from "@tanstack/react-router";

// Single-user instance: no self sign-up or email password reset.
export const Route = createFileRoute("/auth/forgot-password")({
  beforeLoad: () => {
    throw redirect({ to: "/auth/login", replace: true });
  },
});
