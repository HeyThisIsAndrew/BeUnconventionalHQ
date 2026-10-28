# Repository privacy and GitHub Actions billing

HeyThisIsAndrew/BeUnconventionalHQ was briefly switched from public to private on
October 27, 2026 (October 28 UTC), and then restored to public after verifying
the impact on GitHub Actions.

## Why the repository remains public for now

Immediately after switching visibility to private, GitHub Actions blocked every
workflow job (including PR CI run `40625898061`, scheduled YouTube syncs
`40635442555` and `40635567118`, and scheduled Instagram sync `40640067101`) with:

> `The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the 'Billing & plans' section in your settings`

Public repositories receive free GitHub Actions runner minutes, whereas private
repositories require available private-repo minutes and an active GitHub billing
method/spending limit. Returning the repository to public immediately restores
CI, scheduled content syncs (Substack, YouTube, Instagram), and production
deployments. Before making the repository private again in the future, verify
that **Settings → Billing & plans** on the GitHub account has active payment and
sufficient Actions spending limits for hourly syncs and deploys.

## Public website hosting

The website remains public on Cloudflare Worker `beunconventionalhq`.
The source verification workflow confirmed that Cloudflare's custom-hostname
registry binds `beunconventionalhq.com` to this Worker. The obsolete GitHub Pages
custom-domain claim was cleared before changing repository visibility. No DNS
records or Cloudflare website bindings were changed. The homepage and
`/api/live-status.json` continued returning HTTP 200 throughout.

## GitHub Actions and reports

CI now runs for main pushes, pull requests and manual workflow dispatches.
A PR update cancels an obsolete run instead of starting duplicate push/PR suites.
The actual unit, type, build, SEO and browser gates remain enforced.

The SEO SARIF upload to GitHub's security dashboard is guarded with
`if: github.event.repository.private != true` so that if the repository is made
private in the future (once Actions billing is enabled), the public-only code
scanning upload is skipped cleanly while both SARIF and HTML reports remain
available as workflow artifacts and the SEO baseline still blocks regressions.

## Connected apps

When the repository is private, any external GitHub App integrations must be
granted private-repository access in their GitHub connection settings, and the
runtime `GITHUB_DISPATCH_TOKEN` must retain Actions-write access to this
repository.

GitHub references:
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
