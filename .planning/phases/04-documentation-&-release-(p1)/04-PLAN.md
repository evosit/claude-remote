---
title: Phase 4: Documentation & Release — v2.0.0 Launch
description: Finalize documentation for Linux support, bump version to 2.0.0, prepare npm publish, and draft release announcements.
wave: 1
depends_on:
  - "03"
files_modified:
  - README.md
  - CHANGELOG.md
  - package.json
  - .github/workflows/publish.yml (if modifications needed)
autonomous: false
requirements: []
---

## Phase 4: Documentation & Release — Detailed Plan

**Total estimated effort:** 3-4 hours (4 tasks)
**Wave structure:** Single wave
**Dependencies:** Phase 3 complete; all code changes committed.

### Task P4.1: Update README.md for Linux (1.5h)

**Goal:** Transform README to cover Linux installation and usage comprehensively.

<read_first>
- README.md (current version)
- .planning/phases/03-testing-and-polish/TESTING.md (test matrix insights)
- .planning/phases/03-testing-and-polish/COMPATIBILITY.md (Alpine notes)
</read_first>

<action>
1. Replace the **Setup** section's first line:
   - From: "You need Windows (macOS/Linux not supported yet)..."
   - To: "You need Windows or Linux (macOS may work but is untested), Node 18+, and a Discord bot."
2. Expand **Installation on Linux** section (new subsection):
   - Prerequisites: Node.js 18+, build tools (`build-essential`/`dnf groupinstall`/`apk add build-base python3 linux-headers`), git, curl.
   - Claude Code CLI install command: `curl -fsSL https://claude.ai/install.sh | bash`
   - Note about Alpine: see COMPATIBILITY.md.
   - Provide distro-specific commands in a code block.
3. Expand **Configuration** section:
   - Mention `.env` file support: can store `DISCORD_BOT_TOKEN`, `DISCORD_GUILD_ID`, `DISCORD_CATEGORY_ID` in `~/.config/claude-remote/.env`.
   - Environment variables still override.
4. Add **Troubleshooting** subsection with common errors:
   - EACCES/EACCES errors during global install → use `--prefix ~/.npm-global` or fix directory permissions.
   - `claude` not found → ensure `~/.local/bin` or npm global bin is in PATH.
   - Discord intents missing → ensure bot has Message Content Intent.
   - Socket permission errors → run as same user, check `/tmp` socket ownership.
5. Ensure **Platform Support** clearly states Linux support (Ubuntu, Fedora, Alpine, WSL2).
6. Keep existing Discord UI screenshots unchanged.
7. Do not remove any Windows-specific info; keep both platforms.
8. Build the docs locally (render markdown) to verify formatting.
</action>

<acceptance_criteria>
- `grep -q "Linux" README.md`
- `grep -q "Ubuntu" README.md || grep -q "Fedora" README.md || grep -q "Alpine" README.md`
- `grep -q "build-essential" README.md`
- `grep -q "~/.config/claude-remote/.env" README.md`
- `grep -q "Troubleshooting" README.md`
- `grep -q "EACCES" README.md`
- README.md contains a clear Linux installation subsection with distro notes
- File is committed to git
</acceptance_criteria>

**Requirements covered:** Documentation for Linux setup.

---

### Task P4.2: Create CHANGELOG.md and Bump Version to 2.0.0 (1h)

<read_first>
- package.json (current version 1.2.0)
- .planning/ROADMAP.md (high-level summary of changes)
- Phase summaries (phase 1-3) for feature list
</read_first>

<action>
1. Create `CHANGELOG.md` following [Keep a Changelog](https://keepachangelog.com/) format.
   - Use headings: `# Changelog`, then `## [Unreleased]`, `## [2.0.0] - YYYY-MM-DD`.
   - Under `[2.0.0]`, include categories:
     - **Added**: Linux support for Ubuntu, Fedora, Alpine, WSL2; platform abstraction; shell integration (bash/zsh/fish); .env file support; debug logging; proactive error handling; WSL2 testing guide.
     - **Changed**: Config directory remains `~/.claude/claude-remote` for consistency.
     - **Known Issues**: WSL2 file watching quirks noted; Alpine requires manual build dependencies.
   - Link to the full release notes in GitHub once published.
2. Update `package.json`:
   - Set `"version": "2.0.0"`.
   - Ensure `"engines": { "node": ">=18" }` present.
   - Check `"files"` includes `["dist", "README.md"]` (dist is already built).
   - Optionally add `"prepublishOnly": "npm run build"` if not present (to ensure dist is fresh before publish).
3. Commit both files.
</action>

<acceptance_criteria>
- `test -f CHANGELOG.md`
- `grep -q "## \[2.0.0\]" CHANGELOG.md`
- `grep -q "Linux support" CHANGELOG.md`
- `grep -q '"version": "2.0.0"' package.json`
- `grep -q '"engines":' package.json`
- `grep -q '"prepublishOnly":' package.json` (if added, else skip)
- Build succeeds: `npm run build`
- Files committed
</acceptance_criteria>

**Requirements covered:** Release versioning and changelog.

---

### Task P4.3: Publish to npm (checkpoint: human-action)

**Goal:** Push v2.0.0 to the npm registry.

<read_first>
- package.json (to confirm name, version, bin)
- CHANGELOG.md (release notes)
- .npmrc (if exists for auth config)
</read_first>

<action>
1. Ensure you are logged into npm (`npm whoami`).
2. Run dry-run first to verify contents:
   ```bash
   npm pack --dry-run
   ```
   Check that `dist/` and `README.md` are included, no unwanted files.
3. Publish:
   ```bash
   npm publish --access public
   ```
   If using 2FA, have OTP ready.
4. After successful publish, verify:
   ```bash
   npm view @hoangvu12/claude-remote version
   ```
   Should return `2.0.0`.
5. Create a git tag for the release (optional but recommended):
   ```bash
   git tag -a v2.0.0 -m "Release v2.0.0"
   git push origin v2.0.0
   ```
   (Note: GitHub Actions may handle tagging; you can also skip if workflow auto-tags.)
</action>

<acceptance_criteria>
- User confirms they ran `npm publish --access public` and it succeeded
- `npm view @hoangvu12/claude-remote version` outputs 2.0.0 (user verification)
- Git tag `v2.0.0` exists (if created)
- Summary notes publish success or any issues encountered
</acceptance_criteria>

**Note:** This task requires manual authentication and is therefore a checkpoint.

---

### Task P4.4: Create GitHub Release and Announce (checkpoint: human-action)

**Goal:** Publicize the v2.0.0 launch.

<read_first>
- CHANGELOG.md (release notes)
- README.md (project description)
- .github/FUNDING.yml (if exists, for sponsorship links)
</read_first>

<action>
1. Create a GitHub Release:
   - Go to repository Releases page → "Draft a new release".
   - Tag: `v2.0.0` (must match git tag).
   - Title: "v2.0.0 — Linux Support".
   - Copy the `## [2.0.0]` section from CHANGELOG.md into the release notes. Add any additional highlights.
   - Attach the built tarball if desired (optional).
   - Publish release.
2. Announcement posts:
   - **Discord community** (if project has a Discord server): post in #announcements with key features and install command.
   - **Reddit**: r/ClaudeAI (and maybe r/rust, r/node if relevant). Follow subreddit rules, be transparent.
   - **Hacker News**: Submit `show` post with title "Claude Remote 2.0.0: Linux Support for claude-remote", link to GitHub release, and top-level comment summarizing changes.
   - **Twitter/X** (if applicable): tweet with release link and key features.
3. Optionally update project documentation: link to release notes from README.
</action>

<acceptance_criteria>
- User confirms GitHub Release created at https://github.com/hoangvu12/claude-remote/releases/tag/v2.0.0
- User confirms at least one announcement channel posted (Discord, Reddit, HN, etc.)
- Summary notes completion and any issues
</acceptance_criteria>

**Note:** This task involves manual posting and is therefore a checkpoint.

---

## plan-verification

After tasks complete, verify phase success:

1. **README check:**
   - `grep -q "Linux" README.md`
   - `grep -q "Ubuntu" README.md || grep -q "Fedora" README.md || grep -q "Alpine" README.md`
2. **CHANGELOG exists and populated:**
   - `test -f CHANGELOG.md`
   - `grep -q "## \\[2.0.0\\]" CHANGELOG.md`
   - `grep -q "Linux" CHANGELOG.md`
3. **Version bump:**
   - `grep -q '"version": "2.0.0"' package.json`
4. **npm publish:** (user-verified) `npm view @hoangvu12/claude-remote version` equals 2.0.0.
5. **GitHub release:** (user-verified) release exists.
6. **Build** (`npm run build`) succeeds.
7. **Smoke test** (`npm run test:smoke`) exits 0.

If all checks pass, phase complete.

**Success criteria (Nyquist):**

- **Dimension 2 (Frontmatter):** PLAN.md has required fields.
- **Dimension 4 (Deep work):** Tasks include read_first, action with concrete values, acceptance_criteria with verifiable greps.
- **Dimension 6 (Verification):** plan-verification checklist provided.
- **Dimension 8 (Validation architecture):** Manual checkpoints include user verification steps; release success is externally verifiable.
- **Dimension 9 (Goal-backward):** must_haves directly implement phase goal.

**must_haves:**

- [ ] README.md updated with Linux support, installation, prerequisites, configuration, troubleshooting
- [ ] CHANGELOG.md created with v2.0.0 entry
- [ ] package.json version bumped to 2.0.0 and engines/prepublishOnly set appropriately
- [ ] npm publish completed (user confirmation)
- [ ] GitHub release created
- [ ] Announcements made (at least one channel)
- [ ] Build and smoke tests pass

---

**End of PLAN.md**
