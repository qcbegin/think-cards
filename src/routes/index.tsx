import { createFileRoute, redirect } from "@tanstack/react-router";

// Single-user instance: skip the marketing page. Logged-in users are sent
// on to /dashboard by useAuthRedirect.
export const Route = createFileRoute("/")({
  beforeLoad: () => {
    throw redirect({ to: "/auth/login", replace: true });
  },
});
