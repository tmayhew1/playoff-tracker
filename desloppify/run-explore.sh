#!/bin/bash
# Crawls every tab. Explore branches too widely for one blind crawl, so it is
# crawled from several starting states: the landing view, an open player card,
# Compare, By Category, a category context card, and a By Player career.
cd /home/user/playoff-tracker
r(){ NAME="$1" PREFIX="$2" node desloppify/crawl.mjs "$3" "$4" "$5" > "desloppify/out/log-${1// /_}.txt" 2>&1; }
ROW='{"label":"show value added breakdown"}'
lane1(){ r EXP_ROOT '[]' EXPLORE 200 2; r EXP_ROW "[$ROW]" EXPLORE 200 3; r EXP_PO_ROW '[{"click":"Playoffs"},'"$ROW"']' EXPLORE 150 3; r INFO '[]' INFO 5 1; r DRAFT '[]' DRAFT 200 4; }
lane2(){ r EXP_CMP "[$ROW,{\"clickText\":\"Compare\"}]" EXPLORE 200 3; r EXP_CAT "[$ROW,{\"click\":\"By Category\"}]" EXPLORE 200 3; r COLLEGE '[]' COLLEGE 200 4; r "SHOT ZONES" '[]' "SHOT ZONES" 200 4; }
lane3(){ r EXP_PLAYER '[{"click":"By Player"},{"fill":"Search a player…","value":"LeBron"},{"clickText":"LeBron James"}]' EXPLORE 250 3; r EXP_CTX "[$ROW,{\"click\":\"Scoring\"}]" EXPLORE 200 3; r "D RATING" '[]' "D RATING" 200 4; }
lane4(){ r 2025-26 '[]' 2025-26 250 4; r LEGACY '[]' LEGACY 250 4; r USAGE '[]' USAGE 250 4; r 2024-25 '[]' 2024-25 60 2; r 2023-24 '[]' 2023-24 60 2; }
lane1 & lane2 & lane3 & lane4 & wait
echo ALL DONE
