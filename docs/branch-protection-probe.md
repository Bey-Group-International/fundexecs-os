# Branch protection probe

Throwaway. This file exists only to open a pull request that touches nothing
any workflow's `paths:` filter would match, so the set of checks GitHub
reports as required on `main` can be read back from a real pull request
rather than assumed.

Delete this file and close the pull request once that has been read.

## Second sample

Re-triggered after branch protection was changed, to get a fresh pending
window. The reading only means something while the five checks are still
running: a required check that is pending forces `blocked`, where a
non-required one leaves `unstable`.
