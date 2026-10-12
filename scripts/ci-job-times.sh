#!/usr/bin/env bash
# Setup-versus-test minutes per job for one workflow run, and the run's
# summed job-minutes. Setup is the composite setup action's step (Lean
# toolchain, npm, TypeScript build, Lake restore + build) plus any
# standalone Lake build step.
# Usage: scripts/ci-job-times.sh <run-id> [owner/repo]
set -euo pipefail
run="$1"
repo="${2:-lakatos-ts/lakatos}"
jobs=$(gh api --paginate "repos/$repo/actions/runs/$run/jobs")
printf '%s' "$jobs" | jq -r '
  def secs: (.completed_at | fromdateiso8601) - (.started_at | fromdateiso8601);
  def m: (. / 60 * 10 | round) / 10;
  .jobs[] | select(.conclusion != null and (.steps | length) > 0) |
  ([.steps[] | select(.name | test("^Run \\./\\.github/actions/|-setup$|^Build|^Restore Lake|^Install Lean")) | secs] | add // 0) as $setup |
  "\(.name)\tjob \(secs | m)m\tsetup \($setup | m)m\ttest \((secs - $setup) | m)m"
' | sort
printf '%s' "$jobs" | jq -r '
  [.jobs[] | select(.conclusion != null) | (.completed_at | fromdateiso8601) - (.started_at | fromdateiso8601)]
  | "summed job-minutes: \(add / 60 * 10 | round / 10)"'
