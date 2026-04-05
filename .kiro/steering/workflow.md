# Development Workflow

## Package Manager

Always use `pnpm`. Never use `npm` or `yarn`. See `tech.md` for full details.

## Git

- Git must be initialized in the workspace root before any implementation begins
- After every completed task, stage all changes and commit with a message referencing the task number and a short description
- Commit message format: `task(<number>): <short description>`
- Examples:
  - `task(1): initialise project and install dependencies`
  - `task(2.1): add Chrome MV3 manifest`
  - `task(5.1): implement BrowserCompat class`
- Use `git add -A` to stage all changes before committing
- Do not squash or amend commits — each task gets its own commit

## CI/CD

- GitHub Actions workflow at `.github/workflows/ci.yml`
- Jobs run in order: lint → test → build
- All three browser targets must build successfully before artifacts are uploaded
