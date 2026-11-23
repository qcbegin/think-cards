// Username-only login for a single-user instance.
// Supabase Auth needs an email, so a username is mapped to an internal
// address `<username>@<VITE_LOGIN_EMAIL_DOMAIN>`. No mail is ever sent to it.

export const LOGIN_EMAIL_DOMAIN = (
  import.meta.env.VITE_LOGIN_EMAIL_DOMAIN || "thinkcards.local"
)
  .trim()
  .toLowerCase();

const USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{1,31}$/;

export const normalizeUsername = (value: string): string =>
  value.trim().toLowerCase();

export const isValidUsername = (value: string): boolean =>
  USERNAME_PATTERN.test(normalizeUsername(value));

export const usernameToEmail = (value: string): string =>
  `${normalizeUsername(value)}@${LOGIN_EMAIL_DOMAIN}`;

export const emailToDisplayName = (email: string | undefined | null): string => {
  if (!email) return "";
  const suffix = `@${LOGIN_EMAIL_DOMAIN}`;
  return email.toLowerCase().endsWith(suffix)
    ? email.slice(0, -suffix.length)
    : email;
};

// Internal addresses are an implementation detail; hide them in the UI.
export const visibleEmail = (email: string | undefined | null): string =>
  email && emailToDisplayName(email) === email ? email : "";
