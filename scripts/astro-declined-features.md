# Architectural Decision Record: Declined Astro Features

This document records three plausible, well-formed architectural proposals that were evaluated and rejected. Without this record, they are highly likely to be proposed again by AI agents, as each sounds obviously correct until verified against this specific codebase.

## Incremental Static Builds

**Verdict**: Declined.

**The Evidence**:
- **Flag Name**: The correct Astro 7 flag is `experimental.incrementalBuild` (there is no `incrementalStaticBuilds` key in Astro 7.2.9).
- **Time Savings vs. Pipeline Cost**: Measurement #151 verified that `astro build` takes only 8.2s of a 106s CI pipeline. Prerendering all 68 routes costs only **2.60s**. The pipeline bottleneck is outside of Astro's static generation.
- **The Dependency Hash Trap**: The incremental cache skips a page only when its `cacheKey` and dependency hash match. The hash walks the route's transitive module graph and hashes every module. Only modules tagged `kind: "content-data"` (virtual modules from the Content Layer) are skipped. Our `src/data/videos.json` (451 KB) is statically imported and rewritten by the YouTube sync every 6 hours. Because it is an ordinary module, every sync changes the dependency hash of every route touching it, instantly invalidating the cache.
- **Silent Failures**: The cache silently disables itself when `build.concurrency > 1` (emitting only a log warning), and the manifest is invalidated wholesale by any lockfile change, ensuring every dependency bump forces a cold build.

**Revisit Condition**:
This becomes arguable only if the route count grows by roughly an order of magnitude **and** Ticket #201 (Move the JSON store behind a Content Layer loader) has successfully landed, which would tag our data as `kind: "content-data"`.

## LQIP (Low-Quality Image Placeholders)

**Verdict**: Declined.

**The Evidence**:
- **Mobile LCP**: The mobile Largest Contentful Paint (LCP) element is a remote Sanity image that is loaded *outside* of `astro:assets`.
- **Pre-existing Fix**: Epic #191 already owns the correct fix for origin optimization.
- **Regression Risk**: Swapping `image.service` to support LQIP risks reopening the severe regression that `imageService: 'compile'` was specifically adopted to fix (which resulted in a 938 KB mobile payload and 3.4s LCP).

**Revisit Condition**:
This becomes arguable only if the LCP element ever moves back into the `astro:assets` pipeline.

## Sanity Content Loader

**Verdict**: Declined.

**The Evidence**:
- **Breaks Offline Guarantee**: It introduces a build-time GROQ network call, which reverses Epic #34's strict offline-build guarantee.
- **Substack Constraint**: Our articles come from Substack's `/api/v1/posts` API. A Sanity loader could not replace that sync pipeline regardless.

**Revisit Condition**:
None. Our architecture relies on offline JSON stores populated via isolated CRON syncs.


## The General Lesson on Attribution

Five of the six proposals in the originating review that suggested these features were falsely attributed to the "What's New in Astro, August 2026" blog post. That post did not mention any of them as core features (it covers Astro 7.2, the new Project Steward, the Astro Playground, Astro Together Germany, the Community Support repo, and partner news). 

**Rule**: Attribution is checkable, and must always be checked before suggesting architectural overhauls based on perceived documentation updates.
