# Mission Control v1.1 — Redesign Brief & Asset Manifest

**Job:** gated coder job, Claude engine + `frontend-design` skill. Same data, sections, and security as v1. Restyle only.
**Design target:** `mission-control-v1-1-preview.html` (the engine should match this, not invent its own layout).
**Repo:** `woodybrown1988-beep/coyote-claw-mission-control` · branch `feat/mc-v1-1` · require-PR.

---

## 1. Aesthetic — Navy Command-Deck

Coyote Claw is a **sibling brand to Coyote Burger, not the same brand.** Burger = charcoal + red "industrial appetite." Claw = **deep navy + grey steel**, honouring the existing claw mark (grey geometric paw on navy). It reads as a control room / instrument panel, not a restaurant tool.

Shared DNA from the Coyote design system: dark, operator-built, mono numbers, hairline borders, left-border accents, subtle grain, snappy mechanical motion, zero AI-slop. **Diverged:** palette is navy/steel; colour is reserved entirely for status.

## 2. Tokens (CSS custom properties — no hardcoded hex)

```css
/* base */            /* status / signature */
--void:#070B14;       --amber:#F5A623;   /* LIVE / in-flight / active stage */
--navy:#0C1322;       --green:#34D399;   /* merged / shipped / approved */
--panel:#121C30;      --red:#F2555A;     /* failed / gate refused */
--elevated:#1A2740;   --idle:#3D4A63;    /* queued / dormant */
--line:rgba(120,150,200,.10);
--steel:#5B6B86; --ash:#8A9AB5; --mist:#C9D3E3; --bright:#EAF0FA;
```

Status mapping is **fixed**: queued→steel, spec/build→amber (with pulse), merged→green, refused/failed→red. Never decorative colour.

## 3. Type — self-host, do NOT CDN

Oswald (display, uppercase headers) · Barlow (body) · JetBrains Mono (all numbers, IDs, £, tokens — tabular-nums).
**Vendor via npm** (`@fontsource/oswald`, `@fontsource/barlow`, `@fontsource/jetbrains-mono`) → copy the `.woff2` into the served static dir. npm registry is allowed on the box; this keeps the tool sealed and offline-resilient. (The preview file uses Google Fonts for convenience only — production self-hosts.)

## 4. Sections (identical to v1 — restyle, do not add/remove data)

1. **Header** — claw mark + `COYOTE CLAW / MISSION CONTROL` lockup; right side: daemon `SEALED ×4`, worker LIVE/IDLE pulse, last-refresh timestamp.
2. **KPI row** — Jobs today · Gates passed · Metered spend · Open gates (pending taps) · Active stage. Headline numbers first, mono, left-border accent.
3. **Job queue** — full-width table: ID · job · state pill · engine · stage · ref (branch/PR/sha).
4. **Workers ("heroes")** — per-worker card: name, current job, engine, effort, timeout countdown, progress bar. Active worker gets amber inset accent + pulse.
5. **Metered spend** — £ only. Router + claude-worker lines; Codex line shown **excluded (OAuth, shared quota)**; total; cap remaining bar. Honest-cost note retained.
6. **Token usage** — built to `job_token_usage` contract; currently EMPTY → render a proper **empty state** (dimmed claw glyph + "Awaiting first instrumented job"), never fake zeros that look like real data.
7. **Outcomes · gate trail** — `job_events` timeline incl. **correction text** as the learning signal (amber left-rule quote under refused events).

## 5. Motion (ops-appropriate, not playful)

Staggered fade-in on load (0.04s increments). Amber pulse on live worker + active-stage KPI. Row hover tint. No bounce, no spring, ≤0.4s. Page auto-refreshes (poll) — keep the existing refresh mechanic.

## 6. Hard constraints (unchanged from v1)

- Pure JS: `node:http` + `node:sqlite`. **No framework, no bundler, no build step** beyond copying vendored woff2.
- Read-only. Tailscale-only (`100.80.56.91:8787`). No new runtime deps. No network calls from the page except its own poll endpoint.
- Security model identical to v1 — this is a restyle, nothing touches the cage, daemon, or nonce gate.

---

## 7. Asset-manifest convention

JSON in the spec; worker generates assets via OAuth imagegen **before** the engine build turn. Minimal contract is `{path, prompt, size}`; full convention adds `id`, `usage`, `reuse`:

```json
{
  "version": "1.1",
  "assets": [
    {
      "id": "claw-mark",
      "path": "assets/brand/claw-mark.png",
      "reuse": "~/coyote-claw/assets/brand/coyote-claw.png",
      "prompt": null,
      "size": "512x512",
      "usage": "header logo + favicon source — reuse the sealed brand asset, do not regenerate"
    },
    {
      "id": "favicon",
      "path": "assets/favicon-180.png",
      "reuse": "derive from claw-mark (resize, no gen)",
      "prompt": null,
      "size": "180x180",
      "usage": "browser tab / home-screen icon"
    },
    {
      "id": "token-empty",
      "path": "assets/states/token-empty.png",
      "prompt": "ART-DIRECT ME →  a single grey geometric coyote paw-print, dimmed and dormant, on deep navy #0C1322, enclosed by a faint dashed circle suggesting 'no signal / awaiting telemetry', flat hard-edged vector, matte, no gradients, no glow, no text, centred",
      "size": "1024x1024",
      "usage": "empty-state glyph for the token panel"
    }
  ]
}
```

**Image-rich ≠ decorative.** A control room is information-rich; gratuitous imagery is noise. The only generated asset is the empty-state glyph (and the preview already ships a clean SVG version of all marks, so even that is optional). The background grain is CSS `feTurbulence` — free, sharper, no asset. Art-direct the `token-empty` prompt at the spec gate; everything else reuses the sealed claw.

## 8. Acceptance checklist (verify-don't-assume, before merge tap)

- [ ] Renders over Tailscale at `:8787`, every v1 section present and populated from live SQLite.
- [ ] Token panel shows the empty state, not zeros.
- [ ] Codex excluded from £ total; note present.
- [ ] Fonts served locally (no external font request in network tab).
- [ ] Refused gate event shows its correction text.
- [ ] No new deps; `node:http`+`node:sqlite` only; security model untouched.
- [ ] Matches `mission-control-v1-1-preview.html` layout.
