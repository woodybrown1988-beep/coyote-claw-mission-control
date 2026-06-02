# Mission Control v1.1 — Gated Coder-Job Spec (AUTHORITATIVE)

> The resolved spec the engine follows. Decisions D1–D3 are RESOLVED (Woody, 2026-06-01).
> Engine switched **claude → codex** (CODEX_HOME OAuth, the proven step-4 rail, £0 marginal —
> no Anthropic key needed; sidesteps the no-metered-key / never-subscription-OAuth blocker).

---

## 0. Job header

| field | value |
|---|---|
| job type | `coder` |
| engine | **codex** (ChatGPT-subscription OAuth via isolated `~/.coyote-claw/codex-home`) |
| model | `gpt-5.5` (codex default) |
| effort | spec = **medium**, build = **high** (codex `model_reasoning_effort`; spec read-only sandbox / build workspace-write) |
| repo | `woodybrown1988-beep/coyote-claw-mission-control` |
| work branch | `feat/mc-v1-1` (design files committed); PR head = `coyote-claw/job-<id>`, **base = `main`** (require-PR braces live on `main`) |
| merge | nonce-gated, worker-performed (unchanged cage) |
| scope | **restyle only** — same data, same sections, same endpoints, same security as v1 |

> Note: the `frontend-design` skill auto-loads only for the Claude CLI; the **codex** engine does not
> use it. Craft guidance therefore lives entirely in the committed design files the engine reads:
> `design/mc-v1-1-spec.md` (this file) + `design/mc-v1-1-brief.md` + `design/mission-control-v1-1-preview.html`.

---

## 1. What actually changes (preview → production)

The preview (`design/mission-control-v1-1-preview.html`) is **self-contained and on-brand already**:
inline-SVG marks, CSS `feTurbulence` grain, the full token system, all 7 sections. Only **two** things
in it are not production-ready:

1. **Fonts are CDN** (`fonts.googleapis.com`) — production must self-host woff2 (brief §3). The engine
   is sealed (no network), so the **supervisor vendors the woff2 before the build turn** (§3).
2. **Data is a static mock** — production must render the same markup from **live `server.js` SQLite
   reads** (v1's server already has every query; this is a template swap, not new data plumbing).

Everything else (palette tokens, status-colour mapping, motion, grain, layout, the inline-SVG marks)
the engine **copies from the preview verbatim** — it must not invent its own layout.

---

## 2. Engine instruction (what the codex build turn implements)

> You are restyling an existing read-only dashboard. The design target is committed in this clone at
> `design/mission-control-v1-1-preview.html` — **match it exactly**; do not invent layout, palette, or
> motion. The brief is `design/mc-v1-1-brief.md`; this spec is `design/mc-v1-1-spec.md`.
>
> **Edit `mission-control/server.js` only**, plus add committed static assets under
> `mission-control/static/`. Keep it pure `node:http` + `node:sqlite`. **No new runtime deps. No
> framework, no bundler, no build step.** It stays **read-only / SELECT-only**, loopback-bound, served
> on the existing port. Do not touch the cage, the daemon, the nonce gate, or any query's security.
>
> 1. Replace the v1 HTML/CSS the server emits with the preview's markup + `<style>`, as **CSS custom
>    properties** (the `:root` token block — no hardcoded hex in rules). Status colour is **fixed and
>    semantic only**: queued→steel, spec/build→amber+pulse, merged→green, refused/failed→red.
> 2. **Add a static file handler** (v1 has none — it only emits text/html, json, plain). Serve
>    `mission-control/static/` with **correct MIME types**: `.woff2`→`font/woff2`, `.svg`→
>    `image/svg+xml`, `.png`→`image/png`, `.css`→`text/css`, `.js`→`text/javascript`. Keep
>    `x-content-type-options: nosniff`. (See acceptance A — this is the top silent-failure risk.)
> 3. **Fonts:** remove the Google-Fonts `<link>`/`preconnect`. The latin-subset woff2 are already
>    vendored at `mission-control/static/fonts/` (§3). Add `@font-face` rules for Oswald / Barlow /
>    JetBrains Mono pointing at those local files (`font-display:swap`). **No external font request may
>    appear in the network tab**, and computed `font-family` must resolve to the vendored faces, not a
>    system fallback (acceptance C).
> 4. **Bind every section to live SQLite** (same queries/shape as v1 — header SEALED×4 + worker LIVE/
>    IDLE + last-refresh; KPI row; job-queue table; worker heroes; metered £-spend with the Codex-
>    excluded line + honest-cost note; token panel; outcomes/gate trail). Keep the existing **poll
>    auto-refresh**.
> 5. **Worker hero card:** render name / current job / engine / effort / stage. There is **no
>    `start_ts`/`claimed_at` column** in the jobs table (only `created_at`/`updated_at`/`fresh_until`),
>    so render **NO live elapsed countdown** — do not fabricate a timer. You may show the static
>    timeout ceiling as a label (spec 300s / build 1800s) but not a fake running clock (acceptance B).
> 6. **Token panel = real empty state**, never fake zeros: render the **preview's inline dimmed-claw
>    SVG glyph** + "Awaiting first instrumented job" (the `.empty` block). Built to the
>    `job_token_usage` contract; lights up when worker token-capture lands.
> 7. **Outcomes/gate trail** must show **correction text** on refused events (amber left-rule `.corr`
>    quote) — the learning signal.
> 8. **Marks:** header claw = the preview's **inline SVG**. **No image generation anywhere** (D1).
>    Favicon = `static/brand/claw.svg` authored from the preview's inline claw, linked
>    `<link rel="icon" type="image/svg+xml" href="/static/brand/claw.svg">` (D2). The sealed raster
>    `static/brand/claw-mark.png` is wired **only** as
>    `<link rel="apple-touch-icon" href="/static/brand/claw-mark.png">` — **no `og:image` meta tag**
>    (Tailscale-private host, never unfurls) (D3).
> 9. **Grain** stays the CSS `feTurbulence` data-URI from the preview — no image asset.
>
> Before finishing, self-check against §6. Commit your edits locally (the worker pushes + opens the PR).

---

## 3. Supervisor pre-build steps (OUTSIDE the sealed engine, network-side)

Run **before** the engine build turn (the engine has no network). **No imagegen calls this job (D1).**

1. **Vendor fonts** — `npm install @fontsource/oswald @fontsource/barlow @fontsource/jetbrains-mono`
   in a scratch dir; copy the **latin-subset** woff2 for the weights the preview uses into
   `mission-control/static/fonts/`, committed:
   - Oswald: 400, 500, 700
   - Barlow: 300, 400, 500, 700
   - JetBrains Mono: 400, 500, 700
   The `@fontsource/*` packages are **NOT** added to the dashboard's `package.json` — only the `.woff2`
   files are committed. Net runtime deps stay **zero** (node built-ins only).
2. **Raster claw** — copy `~/coyote-claw/assets/brand/coyote-claw.png` (sealed brand mark, 1254×1254)
   → `mission-control/static/brand/claw-mark.png`, committed. Used **only** as `apple-touch-icon` (D3).

(Favicon `claw.svg` and all visible marks are authored by the engine from the preview's inline SVG —
no supervisor step, no generation.)

---

## 4. Asset manifest (RESOLVED)

```json
{
  "version": "1.1",
  "assets": [
    { "id": "claw-mark-svg", "path": "inline <svg> (header) + static/brand/claw.svg (favicon)",
      "source": "the preview's inline claw SVG — sharp, scalable, zero gen", "prompt": null,
      "usage": "header logo + favicon (link rel=icon type=image/svg+xml)" },
    { "id": "claw-mark-png", "path": "mission-control/static/brand/claw-mark.png",
      "source": "~/coyote-claw/assets/brand/coyote-claw.png (1254x1254, sealed — copy, DO NOT regenerate)",
      "prompt": null, "usage": "apple-touch-icon ONLY (no og:image)" },
    { "id": "token-empty", "path": "inline <svg> in the token panel .empty block",
      "source": "the preview's inline dimmed-claw SVG — D1: NO OAuth generation", "prompt": null,
      "usage": "empty-state glyph for the token panel" }
  ]
}
```

**Worker imagegen calls this job: ZERO.** All marks are SVG (inline or authored) or the reused sealed
PNG. The background grain is CSS `feTurbulence` — no asset.

---

## 5. Decisions — RESOLVED (Woody, 2026-06-01)

- **D1 — token-empty glyph:** **inline SVG** (the preview ships it). No OAuth gen; worker makes **zero**
  imagegen calls this job.
- **D2 — favicon:** **`static/brand/claw.svg`**, `type="image/svg+xml"` (scalable, no resize, no dep).
- **D3 — raster claw:** copy the sealed PNG into the repo, wire it **only** as `apple-touch-icon`; **no
  `og:image` meta tag** (Tailscale-private host never unfurls).

Non-negotiable regardless: self-hosted fonts (§3) + live-data wiring (§1).

---

## 6. Acceptance (verify, don't assume, before the merge tap)

Brief §8:
- [ ] Renders over Tailscale at `:8787`; every v1 section present and populated from live SQLite.
- [ ] Token panel shows the empty state, not zeros.
- [ ] Codex excluded from the £ total; honest-cost note present.
- [ ] Fonts served locally — **no external font request** in the network tab.
- [ ] Refused gate event shows its correction text.
- [ ] No new deps; `node:http` + `node:sqlite` only; security model untouched (read-only, loopback).
- [ ] Matches `mission-control-v1-1-preview.html` layout.

Added (Woody):
- [ ] **A — Static handler MIME types.** The new static handler returns the correct `Content-Type` for
      `.woff2` (`font/woff2`), `.svg` (`image/svg+xml`), and `.png` (`image/png`). (v1 had **no** static
      handler — it must be added; this is the highest-probability silent failure: fonts/favicon must
      load, not 404 / wrong-MIME.)
- [ ] **B — Hero elapsed.** Wire elapsed from `start_ts` + timeout config (spec 300s / build 1800s).
      **`start_ts` is NOT available** in v1's jobs data (no such column) → render stage/engine/effort with
      **NO countdown**; never fabricate a timer.
- [ ] **C — Fonts actually resolve.** Computed `font-family` resolves to the **vendored woff2** (not a
      system fallback) for display (Oswald), body (Barlow), and mono (JetBrains Mono). Latin-subset woff2
      for Oswald 400/500/700, Barlow 300/400/500/700, JetBrains Mono 400/500/700 are committed in
      `static/fonts/`, with **no `package.json` entry**.
