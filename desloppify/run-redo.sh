#!/bin/bash
# Re-crawls the tabs whose first pass raced their own loading.
cd /home/user/playoff-tracker
r(){ NAME="$1" PREFIX="$2" node desloppify/crawl.mjs "$3" "$4" "$5" > "desloppify/out/log-${1// /_}.txt" 2>&1; }
while pgrep -f "^node desloppify/crawl.mjs 2023-24" >/dev/null; do sleep 5; done
r LEGACY '[]' LEGACY 250 4; r USAGE '[]' USAGE 250 4; r 2025-26 '[]' 2025-26 250 4; r 2024-25 '[]' 2024-25 60 2
echo REDO DONE
