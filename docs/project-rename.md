# Renaming a project key safely

The admin rekey endpoint changes all card addresses and preserves card IDs,
numbers, reservations, links, credentials, connections and original evidence.
Old project addresses remain reserved redirects, including through later renames;
they cannot be assigned to another project. Card title/body references are updated.
Each renamed card receives an attributed migration event in the same database
transaction. Original events and Git commits remain intact.

Before applying a live rename, update repository tools that hard-code the old
project key. Running branches and worktree directories can finish in place.
The API resolves historical keys before checking project ownership. Old direct
board URLs redirect, old Plan lines still attach evidence, and existing tokens
retain their project scope. These paths are tested against memory and PostgreSQL.

Do not rewrite Git history or move dirty active worktrees as part of a board rename.
Regenerate and publish the project's code graph after updating source references.
