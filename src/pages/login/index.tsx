import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useNavigate } from "@tanstack/react-router";
import type { AuthError } from "@supabase/supabase-js";
import { useDocumentHead } from "@/hooks";
import { useSignIn } from "@/hooks/useAuth";
import { isValidUsername, usernameToEmail } from "@/lib/username-auth";
import { hasMinLength, isNotEmpty } from "@/utils";

import {
  Button,
  Card,
  InputPassword,
  InputText,
  Spinner,
  Text,
} from "@stellar-ui-kit/web";

const PASSWORD_MIN_LENGTH = 6;

const getAuthErrorMessage = (error: AuthError, t: (key: string) => string) => {
  if (error.message.includes("Invalid login credentials")) {
    return t("authErrorInvalidCredentials");
  }
  return t("authErrorGeneric");
};

// Single-user instance: username + password only. No sign-up, password
// reset or third-party providers (see src/lib/username-auth.ts).
export const LoginPage = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  useDocumentHead({ title: t("loginTitle") });

  const signIn = useSignIn();

  const [form, setForm] = useState({ username: "", password: "" });
  const [errors, setErrors] = useState({ username: "", password: "" });
  const [authError, setAuthError] = useState("");

  const validateForm = (): boolean => {
    const next = { username: "", password: "" };

    if (!isNotEmpty(form.username)) {
      next.username = t("loginValidationUsernameRequired");
    } else if (!isValidUsername(form.username)) {
      next.username = t("loginValidationUsernameInvalid");
    }

    if (!isNotEmpty(form.password)) {
      next.password = t("loginValidationPasswordRequired");
    } else if (!hasMinLength(form.password, PASSWORD_MIN_LENGTH)) {
      next.password = t("loginValidationPasswordMinLength", {
        count: PASSWORD_MIN_LENGTH,
      });
    }

    setErrors(next);
    return !next.username && !next.password;
  };

  const handleSubmit = () => {
    if (!validateForm()) return;
    signIn.mutate(
      { email: usernameToEmail(form.username), password: form.password },
      {
        onSuccess: () => navigate({ to: "/dashboard" }),
        onError: (error) =>
          setAuthError(getAuthErrorMessage(error as AuthError, t)),
      },
    );
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6 py-12">
      <Card className="w-full max-w-md p-6 md:p-8">
        <div className="text-center">
          <Text as="h2">{t("loginTitle")}</Text>
        </div>

        <form
          className="space-y-5"
          onSubmit={(event) => {
            event.preventDefault();
            handleSubmit();
          }}
        >
          {authError && (
            <div className="rounded-md bg-error-soft px-4 py-3">
              <Text as="p" className="text-sm text-error-text">
                {authError}
              </Text>
            </div>
          )}

          <InputText
            type="text"
            label={t("loginUsernameLabel")}
            placeholder={t("loginUsernamePlaceholder")}
            value={form.username}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, username: value }));
              setErrors((prev) => ({ ...prev, username: "" }));
              setAuthError("");
            }}
            error={errors.username || undefined}
            containerClassName="w-full max-w-full"
          />

          <InputPassword
            label={t("loginPasswordLabel")}
            placeholder={t("loginPasswordPlaceholder")}
            value={form.password}
            onChange={(value) => {
              setForm((prev) => ({ ...prev, password: value }));
              setErrors((prev) => ({ ...prev, password: "" }));
              setAuthError("");
            }}
            error={errors.password || undefined}
            containerClassName="w-full max-w-full"
          />

          <Button type="submit" disabled={signIn.isPending} className="w-full">
            {signIn.isPending && <Spinner className="size-4 text-white" />}
            {t("loginSubmitButton")}
          </Button>
        </form>
      </Card>
    </div>
  );
};
