# Lumina Product Landing Page — Design Brainstorm

## Three stylistic approaches

### Theme Name: Signal Room
**Very Brief Intro:** A dark editorial operations room where warm signal colors, precise interface fragments, and generous negative space make the automation feel dependable rather than futuristic. The page should feel like a product brief for an operator who cares about control.

**Probability:** 0.07

### Theme Name: Paper Circuit
**Very Brief Intro:** A light, tactile systems-manual aesthetic using off-white paper, ink-black typography, acid chartreuse accents, and thin technical diagrams. The experience feels practical, collectible, and quietly intelligent.

**Probability:** 0.03

### Theme Name: Harbor Console
**Very Brief Intro:** A calm maritime-inspired interface with deep navy, sea-glass teal, and signal orange. It frames the voice agent as a reliable dispatch layer that guides every customer request to a safe destination.

**Probability:** 0.08

## Selected direction: Harbor Console

### Design Movement
Contemporary Swiss editorial design fused with nautical control-room graphics: disciplined typography, asymmetrical composition, signal markers, and precise diagrammatic lines. It should feel like a calm command surface for a system that handles messy customer conversations.

### Core Principles
1. **Calm over spectacle:** Lumina is positioned as controlled infrastructure, not a novelty chatbot. Avoid neon glow, purple gradients, and exaggerated AI language.
2. **Signal hierarchy:** Use orange only for action and status moments; let navy, cream, and teal establish trust and readability.
3. **Editorial asymmetry:** Use offset columns, split bands, side annotations, and long horizontal rules instead of repetitive centered cards.
4. **Proof in the interface:** Show the actual workflow shape, safety contract, deterministic demo behavior, and package boundaries as evidence.

### Color Philosophy
Deep harbor navy provides operational trust and enough contrast for luminous cream type. Sea-glass teal suggests a live, healthy system without resorting to generic tech blue. Signal orange is an ownable, sparing accent reserved for CTAs, active states, and the visual “handoff” between voice and workflow. Warm paper cream keeps the page human and editorial. The palette should feel like a well-lit control room at first light: serious, legible, quietly active.

### Layout Paradigm
The page uses a horizontal “route map” structure. A strong left rail anchors the narrative with an eyebrow, section index, and vertical signal line; the main content flows in offset bands. The hero is a two-column dispatch console: copy on the left, a live-looking conversation/workflow artifact on the right. Sections alternate between navy full-bleed bands and cream editorial fields. Package comparison is a wide table-like route board rather than three identical cards.

### Signature Elements
- **Signal rail:** Thin vertical teal/orange rule with numbered section markers and small monospaced labels.
- **Dispatch packet:** Dark framed UI artifact showing an incoming request, routing decision, safe response, and post-call record.
- **Harbor marks:** Small compass-like rings, coordinate labels, and angled route strokes used sparingly as navigation motifs.

### Interaction Philosophy
Interactions should feel like confirming a safe handoff. Buttons lift by one or two pixels and expose an orange edge; navigation links reveal a small signal dot; the demo panel switches scenarios with immediate, readable state changes. Hover and focus states should be crisp, not flashy. Every interactive element must have a visible keyboard focus treatment.

### Animation
Use brief, low-amplitude motion: the hero dispatch packet enters with a 220ms translate-and-fade, route lines draw in with opacity only, and scenario status changes crossfade rather than reflow. Stagger related elements by 50ms. Use `prefers-reduced-motion` to disable non-essential entrance motion. Never animate layout dimensions or create perpetual background motion.

### Typography System
Use **DM Sans** for body copy and UI labels, paired with **Space Grotesk** for display headlines and section titles. Use a compact monospace face such as **IBM Plex Mono** for route labels, timestamps, event IDs, and technical annotations. Headlines use tight tracking and strong contrast; body copy stays between 16–18px with a readable 1.55 line-height. Monospace is a signal layer, never the dominant reading font.

### Brand Essence
Lumina is a self-hosted voice-support starter kit for e-commerce operators and automation builders who need a dependable path from customer call to verified order response. It is different because it shows the workflow, safety boundaries, and buyer responsibilities instead of hiding them behind AI theater.

**Personality:** composed, practical, transparent.

### Brand Voice
Headlines are direct and operational. CTAs sound like a clear next action, never a hype promise. Microcopy names boundaries plainly and treats safety as a product feature.

- **Example headline:** “Route the call. Verify the order. Keep the handoff visible.”
- **Example CTA:** “Inspect the workflow”

### Wordmark & Logo
Use a custom symbol-first mark: a compact harbor beacon made from two offset concentric rings interrupted by a single diagonal signal bar. Pair the mark with the word “LUMINA” in a wide, custom-tracked Space Grotesk wordmark. The favicon uses only the beacon mark, never tiny text.

### Signature Brand Color
**Signal Orange — `#F36B3B`**. Use it for the primary CTA, active route markers, and a small number of status highlights. It should remain rare enough that every appearance means “continue” or “attention.”

## Style Decisions

- Use Harbor Console consistently across the hero, route map, package comparison, and footer.
- Use real repository screenshots as proof assets, but frame them as operational evidence rather than decorative cards.
- Use generated visuals only for the brand mark and one abstract harbor-signal texture; keep the workflow screenshots legible and source-controlled.
- Do not claim live metrics, customer testimonials, provider inclusion, or production guarantees.
