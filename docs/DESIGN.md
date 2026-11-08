# Design system

What-If should feel like considered, editorial software, not a template dashboard. The interface is quiet so that the decision and the numbers carry the page.

## Principles

1. **Typography and spacing before boxes.** Sections are separated by hairlines and whitespace, not by cards. Panels appear only where content is a distinct object, such as dialogs, the question box and suggestions.
2. **One accent.** A deep ink blue (`--accent`) marks primary actions, focus and selection. Everything else is warm neutral.
3. **Colour has a job.** Scenario identity uses the categorical palette, risks and opportunities use the status colours, and value provenance uses the source colours. Colour is never the only signal: every coloured mark has a label, legend, icon or text.
4. **The question is the headline.** Decision titles use a serif (Source Serif 4) to read like the human question they are. All other UI text uses Inter.
5. **Numbers are honest.** Tabular figures appear in tables and axes. Compact notation is used only at 10,000 and above. Every projection shows its range and assumptions nearby.

## Tokens

All colours, type sizes, spacing, radii, shadows and motion are CSS custom properties in `apps/web/src/styles/tokens.css`. Light and dark values are defined for both the OS preference and the explicit theme toggle (`data-theme`). Reports always print in the light palette.

| Group | Tokens |
|---|---|
| Surfaces | `--bg`, `--surface`, `--surface-raised`, `--surface-sunken`, `--hover`, `--active` |
| Ink | `--text`, `--text-2`, `--text-3`, `--text-inverse` |
| Lines | `--border`, `--border-strong`, `--ring` |
| Accent | `--accent`, `--accent-hover`, `--accent-soft`, `--accent-text` |
| Status | `--good`, `--warn`, `--bad` (+ `-soft`) |
| Sources | `--src-user`, `--src-ai`, `--src-system`, `--src-external` |
| Charts | `--chart-surface`, `--chart-grid`, `--chart-axis`, `--chart-text`, `--series-1…8` |
| Scale | `--text-xs…3xl`, `--s-1…16` (4 px grid), `--radius-sm/…/lg` |

## Scenario palette

The eight scenario colours are a categorical palette whose order was validated for colour-vision deficiency. The validator script was run against What-If's own light (`#fbfaf8`) and dark (`#151514`) surfaces:

- worst adjacent-pair CVD ΔE: 9.1 (light) and 8.4 (dark);
- normal-vision ΔE: at least 19.

Three light-mode hues fall below 3:1 contrast with the surface, so every chart has a legend, direct end-labels where they fit, and a table view. Colours follow the scenario (`colorIndex`), never its rank, so filtering never repaints the remaining scenarios.

## Components

`apps/web/src/components/ui` contains:

- Button (primary, secondary, ghost, danger; sm, md, lg; icon-only buttons always keep an accessible name);
- Field, Input, NumberInput, Select, Textarea, Switch, Segmented;
- Dialog (focus trap, Escape to close), ConfirmDialog, Menu (arrow-key navigation);
- Toasts, Badge, SourceTag, Callout, EmptyState, Skeleton.

`components/charts` contains:

- **LineChart**: 2 px lines, an optional P10–P90 band at about 12 % opacity, a hairline grid, a crosshair tooltip, a legend when there are two or more series, and collision-aware end labels.
- **Tornado**: diverging bars around the expected value.

## Motion

Short fades and 4 px rises (120–200 ms, `cubic-bezier(0.2, 0, 0, 1)`). All motion is disabled under `prefers-reduced-motion`.

## Accessibility

- A skip link and landmarks.
- A visible focus ring on every interactive element.
- Labels on every input.
- Dialogs trap focus.
- Tabs use `role="tab"` and `aria-selected`.
- Charts expose `role="img"` with a description, and a table alternative is one click away.
- Status is always text plus an icon.
- Layouts are responsive down to 360 px, with a drawer for navigation and horizontally scrollable tables.
