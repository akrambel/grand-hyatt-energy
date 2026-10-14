#!/usr/bin/env bash
# Compiles and runs the host-side firmware tests (needs g++ with C++17).
set -euo pipefail
cd "$(dirname "$0")"
OUT="${TMPDIR:-/tmp}/ghrs_fw_test"
g++ -std=c++17 -Wall -Wextra -Wno-unused-function -O1 -fsanitize=address,undefined test_core.cpp -o "$OUT"
"$OUT"
