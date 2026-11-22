# Security policy

## Supported versions

Security fixes target the latest published stable release and `main`. Older
releases and unmerged branches are not maintained separately.

## Report a vulnerability

Use [GitHub's private vulnerability reporting](https://github.com/ysskrishna/bb-profiles/security/advisories/new).
Include the affected version or commit, reproduction steps, and likely impact.
Do not post credentials, private conversations, or exploit details in public issues.

The maintainer will review the report and coordinate a fix and disclosure. There
is no guaranteed response time or bug bounty program.

## Plugin access

Profiles reads BB's project, provider and environment lists and each provider's
model list. It stores its profiles in BB plugin storage and reads BB's query
data in the browser to filter the model picker. It does not read conversations
or message text. Custom models are the one exception to plugin storage: the
plugin edits the top-level `customModels` list in BB's own `config.json`,
keeping every other key, and asks BB to reload its config. It makes no network
requests of its own. `bb profiles import` reads only the file path you give it.
