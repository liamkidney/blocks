# Blocks

A lightweight falling-block puzzle game for the web.

Play in a modern browser using the on-screen controls, touch gestures, or keyboard arrow keys.

## Branches and releases

All changes are made on `dev`; `main` is the last released, validated dev commit. Production is published at https://liamkidney.github.io/blocks/ and development at https://liamkidney.github.io/blocks/dev/.

Run tests and validate the development PWA before releasing. To promote, run GitHub Actions → **Promote validated Dev to Main** on `main`. The workflow verifies Git ancestry, tests and builds the exact dev SHA, then fast-forwards main without generating new application commits. The Pages pipeline deploys both channels after the successful release workflow. Never commit directly to main, use cherry-picks, or squash/rebase a release. Production and development differ only in generated URLs, PWA titles, optional development inspectors, revision stamps and cache isolation.
