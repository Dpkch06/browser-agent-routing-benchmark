---
name: Browser agent routing benchmark
description: A measurement workspace for comparing browser strategies across shared tasks.
colors:
  ink: "#14254a"
  muted: "#51617b"
  line: "#c9d5e5"
  paper: "#fbfdff"
  ground: "#eef3fa"
  cobalt: "#174fb5"
  cobalt-deep: "#103b88"
  citron: "#e5f26a"
  pass: "#19734a"
  pass-bg: "#e3f5e9"
  fail: "#a62a35"
  fail-bg: "#ffeaec"
  warning: "#82570c"
  warning-bg: "#fff2cc"
typography:
  body:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.55
  heading:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "clamp(28px, 3.5vw, 42px)"
    fontWeight: 720
    lineHeight: 1.08
    letterSpacing: "-.045em"
  label:
    fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "12px"
    fontWeight: 700
rounded: {}
spacing: {}
components:
  button-primary:
    backgroundColor: "{colors.cobalt}"
    textColor: "#ffffff"
    height: "42px"
    padding: "0 17px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    height: "42px"
    padding: "0 17px"
  panel:
    backgroundColor: "{colors.paper}"
    rounded: "0"
---

## Overview

The playground is a measurement workspace for browser strategy experiments. Its visual direction uses the language of scientific data plates: an ice-white work surface, a cobalt shell, ink navy text, and citron for selection. This direction was inferred from the benchmark's measurement and comparison needs after the user approved project scope and left visual direction open. It is not a user-confirmed creative North Star.

Outcomes use semantic color, while timing and usage use tabular numerals. Small measurement ticks connect completed matrix cells to their result and duration. Use standard web controls and tables so the dense comparison stays familiar. No raster assets are part of the system.

The finish review resolved its only reported material progress finding, which covered the listed live-progress fix. No paid matrix was run, so the interface records no paid benchmark measurements.

**Key characteristics:** cobalt navigation shell, ice-white surface, citron selection, semantic outcomes, tabular data, standard controls, measurement ticks.

## Colors

The cobalt family identifies the application shell and active work. Citron marks selection and keyboard focus. Ink and muted navy carry content; the ice-white paper and pale blue ground separate the workspace from its surrounding canvas.

**The Outcome Color Rule.** Green and red communicate verified pass and fail outcomes. Amber is reserved for warnings. Do not use these colors as general decoration.

## Typography

Use the system UI sans stack for headings, labels, controls, and explanatory copy. The page heading scales with the viewport; compact table and status labels remain at 12px. Apply tabular numerals to durations, counts, and usage values. Use a monospace stack only for run identifiers and code.

**The Measurement Rule.** Numeric values that users compare align with tabular numerals. Keep monospace limited to identifiers and code.

## Layout

At wide widths, center the page in a maximum 1392px shell and place the main matrix beside a 320px report column. At 1080px, the report column narrows to 280px. At 820px, the workspace stacks, reports follow the primary column, and the matrix scrolls horizontally at its 780px minimum width. At 480px, the navigation stacks, panel insets tighten, and report summaries use two columns.

Keep matrix rows and columns aligned with fine rules. Place the twelve-cell matrix before the saved reports. Keep its horizontal overflow inside the table region on small screens.

## Elevation & Depth

The interface is flat. Panels use a one-pixel line on the paper surface, with no drop shadows. Use inset color only to mark the selected saved report.

## Shapes

Controls and panels use square corners. Fine borders and aligned edges define groups instead of rounded cards. The selected report uses a three-pixel cobalt inset edge. Preserve the visible keyboard focus outline and its offset.

**The Square Form Rule.** Keep panels, buttons, tags, and selection marks square-edged. Do not add rounded card styling.

## Components

The primary action is cobalt with white text and a darker cobalt hover state. The secondary action uses the paper surface, ink text, and a line border. Both use a 42px minimum height and 17px horizontal padding. Disabled actions reduce opacity and use a not-allowed cursor.

Panels use the paper surface and line border. Their headings align title and status information on one row. Progress uses a thin cobalt track. Matrix cells show a short measurement tick above state and tabular metadata; their state colors match the outcome rule.

Saved report entries are full-width standard buttons. Hover adds a pale blue surface; selection adds a pale blue fill and cobalt inset edge. Use semantic table markup for the matrix and report details. Keep the report refresh action a square icon button with an inline SVG.

## Do's and Don'ts

### Do

- Do use cobalt for navigation, primary actions, and active progress.
- Do use citron for active selection and keyboard focus.
- Do keep result, timing, and usage values aligned in a dense grid.
- Do preserve reduced-motion behavior for transitions.

### Don't

- Don't use success or failure colors for decoration.
- Don't replace the system UI font with a display face.
- Don't add raster imagery or rounded card treatments.
- Don't imply measured performance where a paid matrix has not run.
