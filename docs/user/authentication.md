# Accounts and access keys

By default the companion has no login: it is meant for one person on one
machine. If several people share a companion (typically on a server, with a
shared database), the operator can turn on authentication so everyone sees only
their own saved configurations, outputs, blueprints and presets.

You don't need anything here if you run Scraping Factory for yourself.

## Using a shared companion

Open **Settings** (the gear icon). Depending on how the operator set things up,
you will see one or both of:

- **Account**: **Sign in**, or **Register** if the operator allows it. Your password
  goes only to your companion — this browser keeps just a revocable token for the
  device, so use an `https://` companion or one on this computer. Passwords
  must be at least 10 characters. Signing in gives this browser its own token,
  so **Sign out** only affects this device; **Sign out everywhere** ends every
  device's session.
- **Access key (shared companion)**: paste a key the operator gave you
  (`sf_…`) and click **Save and test**. It answers *Connected as <name>*. The key is
  only needed if your companion requires one, and it is stored in this browser.

If the operator requires a verified email address, enter the address when you
register and type the 8-digit code that is mailed to you. **Forgot password?**
sends a code to your *verified* address.

## For operators

The installer and the companion's command line set this up — see the bundle's
`INSTALL.md` (`--enable-auth`, `--registration open`, `--tls-cert`, `--smtp-host`,
and the `user add|list|rotate|remove|disable|enable|set-password|adopt` commands).
Passwords and access keys are stored only as hashes; a companion reachable from
other machines must use HTTPS.
