# Movie Glacier project instructions

## Release workflow

The user has authorized automatic GitHub updates for every new application
version. After completing a version, perform the following without asking for
confirmation again:

1. Update the application version and bilingual version history.
2. Build the application and Windows x64 installer. Run relevant unit and
   integration tests, including the packaged application when applicable.
3. Commit and push the source changes to the configured GitHub repository.
4. Create and push the version tag, then publish a GitHub Release containing the
   installer and `SHA256SUMS.txt`. Follow the repository's existing naming scheme.
5. Verify publication and give the user the release link with a concise account
   of the changes and validation.

Inspect remote changes before pushing and preserve other work. Publish only
after required validation succeeds. If a release is blocked, report the concrete
blocker and completed work; do not claim publication succeeded.

Documentation-only changes do not require a new application version or installer.

## Private configuration

Never commit or package real API keys, credentials, login sessions, local
databases, media folders, proxy settings, or user-data directories. When adopting
local appearance preferences as defaults, read and copy only an explicit
allowlist of visual parameters. Preserve existing user settings and library data
during updates.
