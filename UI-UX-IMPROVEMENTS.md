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

## Luke AI Workflow — publishing pass (2026-10-26)
- **The builder now finishes the job.** Two new nodes — “โพสต์อัตโนมัติ” and
  “โพสต์ลิงก์ภายนอก” — take the text a workflow just wrote and put it on one of
  16 free channels. Eight of them post through a real API; the rest get a
  paste-ready text plus a link with the title/tags already filled in.
- **A step palette with three groups** (เขียน / สร้าง / เผยแพร่) instead of one flat
  list, so the publishing steps are visible without scrolling.
- **“ช่องทางฟรี” tab** on the right: searchable, filterable by *ยิง API ได้ /
  ต้องกดเอง / สมัครง่าย*, sorted by DA, each card stating the honest trade-off
  (nofollow, API status, signup effort).
- **Keys never reach the browser.** A credential box per channel writes to a
  `0600` file on the server; the UI only ever learns “set / not set”, and a dry
  run shows the exact request with the secret replaced by `[set]`.
- **Results are visible.** A post node shows the published link, the channel, and
  whether it was automatic or one click, with a copy button for the text.

## Luke AI Workflow — palette fix (2026-10-27)
- Reported: "เข้าเมนู Luke AI Workflow ไม่เห็น palette กลุ่ม เผยแพร่ (ฟรี)".
  The group existed, but the palette stacked all ten nodes in a 218px column
  that scrolled; the publishing group fell below the fold with no visible
  scrollbar (macOS hides it), so it looked like the nodes did not exist.
- The palette now shows **one group at a time behind tabs** (สร้าง 5 · จัดรูปแบบ 3 ·
  เผยแพร่ 2 with a ใหม่ badge), so every group is always on screen.
- The header chip **16 ช่องทางฟรี** is now a button that opens the publishing
  nodes *and* the channel library in one click, and each group states what is
  in it. A `test-ai-workflow-publishing` check fails if a node is ever put in a
  group that has no tab.

