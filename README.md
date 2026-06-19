# 🫏 Donkey Game

A tiny daily party game. A 3×3 grid hides **8 right-side-up donkeys** and **1 upside-down donkey**.
Players take turns — each on their own device — uncovering blocks. Find all 8 donkeys to win;
whoever uncovers the upside-down donkey loses.

- **Same board for everyone, every day.** The layout is derived from the date (like Wordle), so
  every device shows the identical board with no server or backend.
- **New board daily** at **midnight Israel time** (`Asia/Jerusalem`), counting up `No. 0`, `No. 1`, …
- Pure static site — just open `index.html`. No build step, no dependencies.

## Playing together (online)
Everyone opens the same URL. On your turn, click a block and tell the others its number; they click
the same block on their screen and see the same result.

## Preview other days
Add `?day=5` (any number) to the URL to preview a specific board.

---
*Vibecoded by Leo.*
