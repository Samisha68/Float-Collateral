#!/usr/bin/env bash
# Build, and fail on the warnings that do not fail the build by themselves.
#
# The Solana toolchain reports a BPF stack overflow as a line beginning
# "Error: Function ... Stack offset of N exceeded max offset of 4096", and then
# exits zero and writes a .so anyway. The resulting program has undefined
# behaviour: ours silently read a bool from a corrupted stack frame and
# rejected every borrow with the wrong error for an afternoon. A green build is
# not evidence. This makes it evidence.
set -euo pipefail

out=$(anchor build 2>&1) || { echo "$out"; exit 1; }
echo "$out"

if echo "$out" | grep -qiE "Stack offset of [0-9]+ exceeded max offset"; then
  echo ""
  echo "BUILD REJECTED: BPF stack overflow above. Box the large accounts in that"
  echo "context (Box<Account<..>> / Box<InterfaceAccount<..>>) and build again."
  exit 1
fi
echo "OK: no stack overflow."
