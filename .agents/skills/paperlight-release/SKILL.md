---
name: paperlight-release
description: Prepare and finalize a Paperlight release by merging upstream VS Code into a temporary branch, validating the Nix app, and publishing only after human approval.
---

# Paperlight release

## Branch model

- `upstream/main` tracks Microsoft's VS Code repository.
- `main` mirrors that upstream snapshot and contains no Paperlight changes.
- `paperlight-dev` is the default branch and contains Paperlight development and completed releases.
- Prepare releases on `paperlight-dev-temp-YYYYMMDDTHHMMSSZ`, created from `paperlight-dev` using a UTC timestamp.
- Preserve original commits with a merge. Do not rebase, cherry-pick, squash, or force-push the published development history.

## Repository conventions

- Discover the checkout and remotes; do not hardcode a machine path or account.
- Use an approved public Git identity and UTC commit/tag timestamps. Do not derive identity from the operating-system username or publish a personal email.
- Keep personal paths, hostnames, locations, credentials, and private project data out of commits, messages, and shared artifacts.
- Use conventional commit messages under 25 words.
- Use the project Nix flake for dependencies and builds. Keep upstream adaptations small and isolated; do not add inline comments or documentation comments to touched code.
- Keep GitHub Actions disabled. Do not enable CI or Copilot automation to validate a release.
- Commit only necessary changes. Keep temporary fixtures, logs, plans, and helper scripts outside the repository. The release README marker is explicitly required.

## Prepare

1. Inspect the working tree, branch, remotes, and any existing release preparation. Preserve unrelated changes. Resume an existing candidate when appropriate instead of creating a duplicate.
2. Choose the requested release date, or the current date from the user's session, formatted `YY.MM.DD`. Keep an existing candidate's version across day changes. Check remote tags and GitHub releases, including drafts. If occupied, use the next available suffix: `.a` through `.z`, then `.aa`, `.ab`, and so on.
3. Fetch `upstream/main` and the relevant origin branches. Fast-forward local and published `main` to the upstream snapshot. If this is not a fast-forward, stop and explain the divergence; the initial branch migration is not part of routine releases.
4. Create the temporary branch from current `paperlight-dev`. Merge `main` with `--no-ff --no-commit`. Resolve conflicts while preserving Paperlight behavior and minimal upstream differences.
5. Check Nix patches, dependency hashes, Node/Electron requirements, and build hooks. Adapt them where upstream changed. Record the merge as `fix: address merge conflicts, for upcoming release <version>`, or `chore: merge upstream for upcoming release <version>` when no conflicts occurred.

## Validate and obtain approval

1. Run `nix build .` and relevant checks. Verify the packaged app's signature and embedded commit. Use disposable profiles and fixtures without copying user credentials or modifying real projects.
2. Check the affected behavior and the core Paperlight flows: project switching, terminal tabs, language tools and memory reporting, PDF viewing, Markdown editing/saving, branding, editor defaults, and startup without restoring projects or sessions. Preserve the disabled AI features and memory-only secret storage.
3. Push the candidate branch when ready. Provide the version, commit, validation results, and `result/Applications/Paperlight.app` for the human to try. Explicitly request validation, then stop before the release commit, tag, or advancement of `paperlight-dev`.
4. If the human reports issues, fix them on the temporary branch and commit as `fix: address residual issues from merge, for upcoming release <version>`. Run relevant checks and obtain approval of the corrected candidate. Do not silently change the upstream snapshot or application code after approval.

## Finalize after approval

1. Check that the candidate, remote development branch, and release-name availability have not changed. If development advanced beyond the candidate, reconcile on the temporary branch and validate the changed candidate before publishing.
2. Add or update the final README line to `Development since <version>.` Commit only that marker change as `feat: release <version>`.
3. Build the exact release commit with Nix and verify its signature and embedded revision. Reuse the approved functional validation for this README-only change; do not request another human validation unless application changes become necessary.
4. Fast-forward `paperlight-dev` to the temporary branch with `--ff-only`, and create an annotated tag named `<version>` on the release commit.
5. Push the development branch and tag atomically where supported. Verify both remote refs before deleting the temporary branch locally and remotely; deletion may be included in the same atomic push. Leave the checkout on `paperlight-dev`, with `main` unchanged.
6. Preserve the final app. Close only disposable test processes and remove their artifacts and superseded Nix outputs that are no longer in use. Do not run broad garbage collection or delete unrelated data.
7. Report the release tag, commit, app location, branch cleanup, and any limitations. Publishing a GitHub Release page or uploading app binaries is separate scope unless explicitly requested.
