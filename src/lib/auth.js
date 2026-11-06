// Turn a Supabase Auth error into something an owner can act on. Same words
// as the Quote & Invoice sign-in (suite rule: one product, one sign-in).
// Never shows raw server text.
export function friendlyAuthError(error, businessName = "the business") {
  if (!error) return null;
  const code = error.code ?? "";
  const msg = String(error.message ?? "");
  const status = error.status;

  if (code === "invalid_credentials" || /invalid login credentials/i.test(msg)) {
    return "Email or password is incorrect.";
  }
  if (code === "signup_disabled" || /signups? (are )?not allowed/i.test(msg)) {
    return `New accounts can't be created here. Ask ${businessName} to set up your login.`;
  }
  if (code === "email_not_confirmed" || /email not confirmed/i.test(msg)) {
    return "This login hasn't been confirmed yet. Ask whoever set up the tool to confirm it.";
  }
  if (code === "user_banned") {
    return "This login has been disabled.";
  }
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || status === 429) {
    return "Too many attempts. Wait a minute and try again.";
  }
  if (error.name === "AuthRetryableFetchError" || status === 0 || /failed to fetch|network/i.test(msg)) {
    return "Couldn't reach the server. Check your connection and try again.";
  }
  return "Sign-in failed. Please try again.";
}
