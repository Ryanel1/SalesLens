---
target: hero header
total_score: 24
p0_count: 0
p1_count: 2
timestamp: 2026-06-30T17-32-11Z
slug: saleslens-web-hero-header
---
Method: dual-agent (A: 019f1992-2490-7f10-9b67-10f12aef90ef · B: 019f1992-5e63-76f0-8839-3621ece00742)

## Design Health Score

| # | Heuristic | Score | Key Issue |
|---|-----------|-------|-----------|
| 1 | Visibility of System Status | 3 | Sales, delta, and units are visible, but the hero does not reveal data freshness or next action. |
| 2 | Match System / Real World | 3 | Metrics match retail reporting language. |
| 3 | User Control and Freedom | 2 | Header is passive; controls moved to top nav, but hero itself has no drill or contextual action. |
| 4 | Consistency and Standards | 3 | Fits the sports-scoreboard dashboard system. |
| 5 | Error Prevention | 2 | Loading/blocked states exist, but could look too similar to real metric states. |
| 6 | Recognition Rather Than Recall | 3 | Account, period, current sales, YoY, and units are readable. |
| 7 | Flexibility and Efficiency | 2 | Power users do not get top driver, stock risk, or report freshness in the first view. |
| 8 | Aesthetic and Minimalist Design | 2 | Strong brand impact, but too much low-information upper space. |
| 9 | Error Recovery | 2 | Hero does not surface a recovery action when report inputs fail. |
| 10 | Help and Documentation | 2 | Delta methodology and data freshness are not obvious. |
| **Total** | | **24/40** | **Promising, but compositionally underused** |

## Anti-Patterns Verdict

**LLM assessment**: This does not read as generic AI slop because the Volshop/Tennessee identity, sports-scoreboard typography, and orange account accent feel specific. The weak spot is a common generated-dashboard pattern: a huge brand moment plus a full-width metric slab, with atmospheric space doing no product work.

**Deterministic scan**: The detector returned clean JSON: `[]`. No rule hits in `saleslens-web/src/app/page.tsx`.

**Browser evidence**: Live geometry at 1280px showed the problem clearly. The hero was 1178x394. The intro row spanned 992px, but the visible title occupied about 449px. The scoreboard sat below as a 1116px-wide strip with columns around 675 / 257 / 181px. This confirms the upper-right hero space has no job, while the lower row carries almost all the data.

## Overall Impression

The hero is confident and branded, but it is acting more like a report cover than a dashboard command center. The empty upper-right area is not merely visual whitespace; it is unused decision space. Filling it with decoration would make the problem worse. Filling it with one compact, decision-grade insight would make the hero feel intentional.

## What's Working

1. The account identity is unmistakable. `VOLSHOP` plus the Tennessee mark makes the dashboard feel client-specific rather than generic.
2. The three headline metrics are the right foundation: current sales, year-over-year change, and units.
3. The dark stadium background and orange accent fit the sports retail context without needing more ornamental graphics.

## Priority Issues

**[P1] Upper hero space is under-informative**

Why it matters: The top row spans the full width but only contains account identity and a date pill. On wide screens, that makes the right side feel accidentally empty.

Fix: Add one compact upper-right insight module: `Top seller`, `Top category`, `Inventory watch`, or `Report updated`. Do not add a decorative card.

Suggested command: `$impeccable layout saleslens-web hero header`

**[P1] Scoreboard is too monolithic**

Why it matters: The metric strip carries all the useful information, so the header feels bottom-heavy. The primary sales number also dominates so much that YoY and units become secondary fragments.

Fix: Move current sales into the left identity zone or make the scoreboard a two-zone composition: left identity + current sales, right compact stack for YoY, units, and one insight.

Suggested command: `$impeccable layout saleslens-web hero header`

**[P2] Hero answers “how much?” but not “so what?”**

Why it matters: An account manager needs a meeting-ready sentence from the header. Right now the sentence is only “Volshop sold $217k,” not “Volshop is up 18% because X / watch Y.”

Fix: Add one decision-grade metric. Best candidates for this business are `Top driver`, `Inventory coverage`, or `Best seller`.

Suggested command: `$impeccable clarify saleslens-web hero header`

**[P2] YoY tile has crowded hierarchy**

Why it matters: `Up 18.0%` and `+$333,112.60` compete as equal green headlines. Users should scan the percent first and treat the dollar delta as support.

Fix: Keep percent large; reduce dollar change into one supporting line such as `+$333.1k vs June 2025`.

Suggested command: `$impeccable typeset saleslens-web hero header`

**[P3] Date pill is visually stronger than its informational value**

Why it matters: It gets a prime accent treatment but only repeats period context.

Fix: Pair the date with freshness/status, or demote it once a stronger insight takes the upper-right role.

Suggested command: `$impeccable distill saleslens-web hero header`

## Persona Red Flags

**Executive reader**: Can see performance is up, but cannot tell why. The upper-right empty zone should carry the sentence they would repeat.

**Merchandise planner**: Sees units, but not stock pressure or inventory coverage. If inventory is part of SalesLens’ value, this is a missed first-view signal.

**Account manager**: Gets a polished branded snapshot, but the header does not yet provide a client-facing proof point beyond total sales.

## Minor Observations

- The background image is carrying atmosphere but not information.
- The units tile feels stranded at far right.
- The current structure will feel more imbalanced on very wide screens.
- The top-bar move for `All Brands` was directionally right; the hero should now use that freed space more deliberately.

## Questions to Consider

1. Should the hero’s one-sentence takeaway be about growth, product driver, or inventory risk?
2. Is this header meant to feel like a branded report cover or an operational scoreboard?
3. Which upper-right signal would make the empty space feel inevitable: `Top Seller`, `Inventory Watch`, or `Report Updated`?
