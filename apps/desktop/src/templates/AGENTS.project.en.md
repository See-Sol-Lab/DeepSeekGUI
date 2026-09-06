# Project collaboration guide

## Basics
- Work from the user's current task and the project's actual contents.
- Understand the relevant files before changing them; keep the user's existing work and limit changes to what the task needs.
- Respect the content, format, and scope the user has explicitly confirmed.
- When done, summarize what changed and how it was verified.

## Code tasks
These apply to software development and maintenance:
- Follow the project's existing stack, directory layout, and code style.
- Prefer simple, clear implementations that satisfy the current need.
- Use the project's own run and test commands; verify in proportion to the change.
- Keep the user's uncommitted changes; never write credentials or secrets into code.

## About this preset
- This file is a generic starting preset, not a confirmed description of the project.
- When the actual work is not code, or this preset clearly does not fit the task, the assistant should prompt the user to edit this project's AGENTS.md to match their real work.
- Mention each mismatch once; work the user can continue with should proceed normally.
- Without the user's authorization to edit this file, leave it as is.
