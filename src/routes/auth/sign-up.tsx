import { createFileRoute, redirect } from "@tanstack/react-router";

// Single-user instance: no self sign-up or email password reset.
export const Route = createFileRoute("/auth/sign-up")({
  beforeLoad: () => {
    throw redirect({ to: "/auth/login", replace: true });
  },
});
