# LUKE AI UI/UX Improvements

## Beginner-first changes
- New Home dashboard opens first.
- Six plain-language task cards: Chat, Create Image, Animate Image, Transcribe, Create Voice, AI Library.
- Simplified sidebar labels and modern LUKE AI STUDIO brand lockup.
- Clear readiness status without requiring users to interpret CPU/RAM/VRAM.
- Responsive layout for smaller screens.
- Advanced controls remain available inside each module.

## Build note
The source is ready for the existing macOS first-run frontend build. The validation environment could not download Vite 8.1.0 from its internal registry, so a fresh frontend production build was not claimed here.

## Social Agency — Calendar & Workflow pass (2026-10-26)
- **Calendar**: one header row (month · status summary · primary action). The status
  summary is the legend *and* the status filter — click a status to narrow the grid,
  click again to see everything. Planner options and filters fold away and restate
  their active choices on one line, so the month itself is the first thing on screen.
  Cards carry a status rail on the left, a second line for angle/pillar, and a delete
  affordance in the corner that appears on hover/focus instead of covering the time.
  “เพิ่มโพสต์” and “วันนี้” (which scrolls to today's cell) live in the header.
- **Workflow**: the ten steps are a wrapping grid with numbered cards plus a step rail
  that mirrors the run — no 2,000px horizontal scroll, and the whole run is readable at
  a glance. The header is a single card: post facts, progress, run/approve/report
  actions. Each action in the run history is its own button (no interactive element
  nested inside another), an older run is labelled with a way back to the latest, and
  empty states point at the next useful step.
