# Hosted Supabase email templates

The hosted Supabase project does not read these files automatically. They are
the reviewed source of truth for the HTML pasted into **Authentication →
Emails → Templates** in the Supabase dashboard.

## Magic Link

- Subject: `Sign in to Ezkart`
- Body: [`magic-link.html`](magic-link.html)

The template deliberately keeps Supabase's `{{ .ConfirmationURL }}` variable
on both sign-in links. Replacing it would break the existing passwordless auth
callback.

The template also displays `{{ .Token }}` for Wallet verification. Accounts with
verified two-step authentication use their existing authenticator code; accounts
without it request an email code. Publish the updated Magic Link body to the
**test Supabase project** before checking the Wallet email flow. A Git deployment
does not update hosted Supabase email templates. Keep the sign-in link intact;
clicking that link signs in but does not unlock Wallet.

The Wallet request uses `create_user: false` and verifies the numeric code with
`type: email`. It checks that the verified account and factors match the current
merchant session. The application allows ten minutes to enter the code and then
unlocks Wallet in that browser for ten minutes. Set the provider email OTP expiry
to at least ten minutes. Supabase's existing resend limits still apply.

The email logo is a PNG because it has broader email-client support than the
website's SVG logo. The current template uses the workbench asset at
`https://test.ezkart.id/assets/ezkart-logo-email.png`. Change that URL to
`https://ezkart.id/assets/ezkart-logo-email.png` when the template and asset are
promoted to production.
