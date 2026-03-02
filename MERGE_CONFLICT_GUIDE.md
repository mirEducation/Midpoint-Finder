# Merge Conflict Resolution Guide for This PR

If GitHub asks you to choose between **Current**, **Incoming**, or **Both** changes while merging:

1. For feature behavior in `src/App.jsx` (bias slider + dashed line), prefer the version from this PR branch.
2. For config files (`package.json`, `vite.config.js`, `tailwind.config.js`, etc.), keep both only when each side adds valid, non-duplicate settings.
3. After resolving, run:

```bash
git add .
git commit -m "Resolve merge conflicts"
```

## Recommended local flow

```bash
git checkout main
git pull
git checkout work
git merge main
# resolve conflicts in editor
git add .
git commit -m "Resolve merge conflicts with main"
git push
```

This updates the PR and removes the GitHub conflict prompt once resolved.
