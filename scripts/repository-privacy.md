# Private repository operation

HeyThisIsAndrew/BeUnconventionalHQ was changed from public to private on
October 27, 2026 (October 28 UTC), at the owner's request.

## Public website hosting

The website remains public on Cloudflare Worker `beunconventionalhq`.
The source verification workflow confirmed that Cloudflare's custom-hostname
registry binds `beunconventionalhq.com` to this Worker. The obsolete GitHub Pages
custom-domain claim was cleared before changing repository visibility. No DNS
records or Cloudflare website bindings were changed. The homepage and
`/api/live-status.json` continued returning HTTP 200 after the change.

## GitHub Actions and reports

Private repositories use the owner's included Actions minutes and storage,
with overage/budget behavior controlled by GitHub billing settings. The connected
credentials do not expose the account's billing plan; no plan or spending limit
was changed.

CI now runs for main pushes, pull requests and manual workflow dispatches.
A PR update cancels an obsolete run instead of starting duplicate push/PR suites.
The actual unit, type, build, SEO and browser gates remain enforced.

The SEO SARIF upload to GitHub's security dashboard is public-repo-only because
private personal repositories do not have that code-scanning feature. Both SARIF
and HTML reports remain available as private workflow artifacts, and the SEO
baseline still blocks regressions. Cloudflare deployment and content sync use
repository secrets and authenticated APIs, rather than public source downloads.

## Connected apps

The desktop's connected GitHub app returned 404 for this repository after the
visibility change, while the authenticated GitHub CLI retained owner access.
Grant that app access to the private repository through its GitHub connection
settings when using connector-only features. No local personal token was copied
to Cloudflare as a workaround. The existing runtime publication-dispatch token
must continue to have Actions-write access to this repository; verify the real
Substack/YouTube publishing path after the visibility change.

## Side effects

GitHub removes stars/watchers when converting public to private. The repository
had one star, zero watchers and zero public forks at the time of the change.
Previously downloaded copies are not made private by changing repository access.

GitHub references:
- https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features/managing-repository-settings/setting-repository-visibility
- https://docs.github.com/en/billing/concepts/product-billing/github-actions
