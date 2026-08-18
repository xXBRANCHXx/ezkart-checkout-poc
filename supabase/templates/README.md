# Hosted Supabase email templates

The hosted Supabase project does not read these files automatically. They are
the reviewed source of truth for the HTML pasted into **Authentication →
Emails → Templates** in the Supabase dashboard.

## Magic Link

- Subject: `Your secure Ezkart sign-in link`
- Body: [`magic-link.html`](magic-link.html)

The template deliberately keeps Supabase's `{{ .ConfirmationURL }}` variable
on both sign-in links. Replacing it would break the existing passwordless auth
callback.

The email logo is a PNG because it has broader email-client support than the
website's SVG logo. The current template uses the workbench asset at
`https://test.ezkart.id/assets/ezkart-logo-email.png`. Change that URL to
`https://ezkart.id/assets/ezkart-logo-email.png` when the template and asset are
promoted to production.
