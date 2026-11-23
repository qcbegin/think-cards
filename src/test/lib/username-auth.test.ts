import { describe, expect, it } from "vitest";
import {
  LOGIN_EMAIL_DOMAIN,
  emailToDisplayName,
  isValidUsername,
  usernameToEmail,
  visibleEmail,
} from "@/lib/username-auth";

describe("username-auth", () => {
  it("maps a username to the internal email, normalised", () => {
    expect(usernameToEmail("  Xinyu ")).toBe(`xinyu@${LOGIN_EMAIL_DOMAIN}`);
  });

  it("validates usernames", () => {
    expect(isValidUsername("xinyu")).toBe(true);
    expect(isValidUsername("x.li_2-a")).toBe(true);
    expect(isValidUsername("Xinyu")).toBe(true); // normalised to lowercase
    expect(isValidUsername("x")).toBe(false);
    expect(isValidUsername("a@b")).toBe(false);
    expect(isValidUsername("-abc")).toBe(false);
    expect(isValidUsername("a".repeat(33))).toBe(false);
  });

  it("round-trips internal emails to usernames and hides them", () => {
    const email = usernameToEmail("xinyu");
    expect(emailToDisplayName(email)).toBe("xinyu");
    expect(visibleEmail(email)).toBe("");
  });

  it("leaves real emails visible", () => {
    expect(emailToDisplayName("someone@gmail.com")).toBe("someone@gmail.com");
    expect(visibleEmail("someone@gmail.com")).toBe("someone@gmail.com");
    expect(visibleEmail(undefined)).toBe("");
  });
});
