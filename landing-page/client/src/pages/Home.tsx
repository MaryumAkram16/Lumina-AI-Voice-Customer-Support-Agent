/*
 * Harbor Console design reminder: calm Swiss-editorial control-room aesthetic.
 * Use harbor navy, warm paper, sea-glass teal, and restrained Signal Orange.
 * Keep the page asymmetric, evidence-led, and transparent about operational boundaries.
 */
import { useState } from "react";
import {
  Activity,
  ArrowDownRight,
  Copy,
  ArrowUpRight,
  Bot,
  Check,
  ChevronRight,
  CircleDot,
  Database,
  ExternalLink,
  FileText,
  LockKeyhole,
  Menu,
  Radio,
  ShieldCheck,
  Sparkles,
  Workflow,
  X,
} from "lucide-react";

const asset = {
  logo: `${import.meta.env.BASE_URL}assets/lumina-beacon-logo.png`,
  hero: `${import.meta.env.BASE_URL}assets/lumina-harbor-signal-hero.webp`,
  routePaper: `${import.meta.env.BASE_URL}assets/lumina-route-paper.webp`,
  dusk: `${import.meta.env.BASE_URL}assets/lumina-beacon-dusk.webp`,
  workflow: `${import.meta.env.BASE_URL}assets/lumina-workflow.webp`,
  retell: `${import.meta.env.BASE_URL}assets/lumina-retell.webp`,
  tracking: `${import.meta.env.BASE_URL}assets/lumina-tracking.webp`,
  cancel: `${import.meta.env.BASE_URL}assets/lumina-cancel.webp`,
};

const heroBackground = `linear-gradient(90deg, rgba(3, 28, 35, 0.95) 0%, rgba(3, 28, 35, 0.76) 45%, rgba(3, 28, 35, 0.3) 100%), url("${import.meta.env.BASE_URL}assets/lumina-harbor-signal-hero.webp")`;
const footerBackground = `linear-gradient(90deg, rgba(3, 28, 35, 0.94) 0%, rgba(3, 28, 35, 0.73) 58%, rgba(3, 28, 35, 0.32) 100%), url("${import.meta.env.BASE_URL}assets/lumina-beacon-dusk.webp")`;

const scenarios = [
  {
    id: "track",
    label: "Track an order",
    intent: "track_order",
    event: "demo-track-001",
    status: "success",
    statusLabel: "Verified lookup",
    response: "Demo order ORD-TEST-001 is shipped.",
    detail: "UPS · In transit · Test City",
    accent: "teal",
    command: "track_known_order",
  },
  {
    id: "cancel",
    label: "Cancel a shipment",
    intent: "cancel_order",
    event: "demo-cancel-001",
    status: "demo_only",
    statusLabel: "No action taken",
    response: "Demo cancellation is eligible, but no real cancellation was performed.",
    detail: "Processing · Human confirmation still required",
    accent: "orange",
    command: "cancel_processing_order",
  },
  {
    id: "unknown",
    label: "Unknown order",
    intent: "track_order",
    event: "demo-not-found-001",
    status: "not_found",
    statusLabel: "Safe fallback",
    response: "The demo could not find that order. No status or action was invented.",
    detail: "ORD-TEST-999 · Nothing disclosed",
    accent: "ink",
    command: "not_found_order",
  },
  {
    id: "duplicate",
    label: "Repeat an event",
    intent: "track_order",
    event: "demo-duplicate-001",
    status: "duplicate",
    statusLabel: "No second action",
    response: "This demo event was already processed; no second action was taken.",
    detail: "Idempotency key · demo-duplicate-001",
    accent: "orange",
    command: "duplicate_event",
  },
];

const packages = [
  {
    name: "Community Reference",
    kicker: "Study the route",
    description: "The public implementation for builders who want a transparent base to inspect and adapt.",
    includes: ["Retell agent export", "n8n workflow assets", "Synthetic demo harness", "Setup + operations guides"],
    action: "Explore the repository",
    featured: false,
  },
  {
    name: "Pro Implementation Kit",
    kicker: "Configure · verify · operate",
    description: "Deployment-ready tooling for buyers who want fewer configuration mistakes and a clearer handoff.",
    includes: ["Configuration manifest", "Preflight validator", "Acceptance-test matrix", "Security + upgrade runbooks"],
    action: "Review the Pro Kit",
    featured: true,
  },
  {
    name: "Implementation Service",
    kicker: "Bring your stack online",
    description: "Hands-on configuration of one agreed provider stack, adapter path, escalation policy, and test call.",
    includes: ["Pro Kit configuration", "Credential walkthrough", "Webhook verification", "Private test-call review"],
    action: "Request implementation",
    featured: false,
  },
];

const faqItems = [
  {
    question: "What do I receive when I buy the template?",
    answer: "You receive the Retell agent configuration, n8n workflow exports, synthetic demo harness, setup guide, operations guide, and commercial-scope guide. Provider subscriptions, API credits, hosting, and custom integrations remain separate.",
  },
  {
    question: "Do I need Retell, n8n, and Google accounts before I start?",
    answer: "Not to inspect the package or run the provider-free demo. You need your own Retell, n8n, data-source, and model-provider accounts only when you move from the local demo to a live call flow.",
  },
  {
    question: "Does the demo call a real provider or change an order?",
    answer: "No. The local demo uses synthetic orders, makes no network calls, and returns deterministic responses. Cancellation, return, and refund scenarios report safe outcomes without performing a real state change.",
  },
  {
    question: "Can Lumina work with my existing order system?",
    answer: "The reference implementation uses Google Sheets as its data source. You can adapt the lookup and write steps to another system, but that requires integration work and buyer-side credentials.",
  },
  {
    question: "Is Lumina compliant out of the box?",
    answer: "No template can make that promise for every deployment. The buyer is responsible for consent, retention, access control, regional processing, contracts, and any legal or industry requirements that apply to their customer data.",
  },
  {
    question: "What happens when a voice or model response is wrong?",
    answer: "The operations guide treats uncertainty as a handoff condition. Unknown orders, validation failures, provider errors, and state-changing requests should follow a safe fallback or human-escalation path instead of inventing a result.",
  },
];

function scrollToId(id: string) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

export default function Home() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [activeScenario, setActiveScenario] = useState(scenarios[0]);
  const [commandCopied, setCommandCopied] = useState(false);
  const demoCommand = `python3 demo/lumina_demo.py --scenario ${activeScenario.command}`;

  const copyDemoCommand = async () => {
    try {
      await navigator.clipboard.writeText(demoCommand);
      setCommandCopied(true);
      window.setTimeout(() => setCommandCopied(false), 1600);
    } catch {
      setCommandCopied(false);
    }
  };

  const handleNav = (id: string) => {
    setMenuOpen(false);
    scrollToId(id);
  };

  // Set by the combined Vercel build (serverless/scripts/build-landing.mjs).
  // Empty on GitHub Pages, where there is no backend to call.
  const liveCallUrl = import.meta.env.VITE_LIVE_DEMO_URL as string | undefined;

  return (
    <div className="site-shell">
      <header className={`site-nav ${menuOpen ? "is-open" : ""}`}>
        <a className="brand-lockup" href="#top" aria-label="Lumina home" onClick={() => setMenuOpen(false)}>
          <span className="brand-mark"><img src={asset.logo} alt="" /></span>
          <span className="brand-wordmark">LUMINA</span>
        </a>
        <nav className="desktop-nav" aria-label="Primary navigation">
          <a href="#route">The route</a>
          <a href="#demo">Live demo</a>
          <a href="#architecture">Architecture</a>
          <a href="#checklist">Checklist</a>
          <a href="#proof">Proof</a>
          <a href="#packages">Packages</a>
          <a href="#faq">FAQ</a>
          {liveCallUrl ? <a href={liveCallUrl}>Talk to Lumina</a> : null}
        </nav>
        <button className="nav-cta" type="button" onClick={() => scrollToId("packages")}>
          View the kit <ArrowUpRight size={16} />
        </button>
        <button className="menu-toggle" type="button" aria-label={menuOpen ? "Close menu" : "Open menu"} aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
          {menuOpen ? <X size={21} /> : <Menu size={21} />}
        </button>
        <div className="mobile-menu">
          {["route", "demo", "architecture", "checklist", "proof", "packages", "faq"].map((id) => (
            <button key={id} type="button" onClick={() => handleNav(id)}>{id === "route" ? "The route" : id === "demo" ? "Live demo" : id === "architecture" ? "Architecture" : id === "checklist" ? "Checklist" : id === "proof" ? "Proof" : id === "packages" ? "Packages" : "FAQ"}</button>
          ))}
          {liveCallUrl ? <a className="mobile-menu-cta" href={liveCallUrl}>Talk to Lumina live <ArrowUpRight size={16} /></a> : null}
          <button className="mobile-menu-cta" type="button" onClick={() => handleNav("packages")}>View the kit <ArrowUpRight size={16} /></button>
        </div>
      </header>

      <main id="top">
        <section className="hero-section">
          <div className="hero-image" style={{ backgroundImage: heroBackground }} aria-hidden="true" />
          <div className="hero-grid-overlay" aria-hidden="true" />
          <div className="hero-inner page-width">
            <div className="hero-copy reveal-up">
              <div className="eyebrow light-eyebrow"><span className="eyebrow-dot" /> RETELL AI × N8N STARTER KIT</div>
              <h1>Give every support call a <em>clear route.</em></h1>
              <p className="hero-lede">Lumina is a self-hosted voice-support template for e-commerce teams that want the handoff from caller to verified order response to stay visible.</p>
              <div className="hero-actions">
                {liveCallUrl ? <a className="button button-primary" href={liveCallUrl}>Talk to Lumina live <ArrowUpRight size={17} /></a> : null}
                <button className={liveCallUrl ? "text-button light-text-button" : "button button-primary"} type="button" onClick={() => scrollToId("demo")}>Run the safe demo <ArrowDownRight size={17} /></button>
                <button className="text-button light-text-button" type="button" onClick={() => scrollToId("route")}>See how it routes <ChevronRight size={16} /></button>
              </div>
              <div className="hero-meta">
                <span><LockKeyhole size={14} /> No provider keys in the repo</span>
                <span><Activity size={14} /> Demo mode included</span>
              </div>
            </div>

            <div className="dispatch-console reveal-up delay-1" aria-label="Lumina workflow preview">
              <div className="console-topline">
                <span className="console-id"><CircleDot size={11} /> INCOMING REQUEST</span>
                <span className="console-state"><span className="pulse-dot" /> ACTIVE ROUTE</span>
              </div>
              <div className="console-body">
                <div className="console-time mono">09:41:08.224Z / EVENT demo-track-001</div>
                <div className="call-line caller-line"><span className="line-label">CALLER</span><span>“Can you tell me where my order is?”</span></div>
                <div className="call-line system-line"><span className="line-label">LUMINA</span><span>“I’ll check that for you. What’s the order number?”</span></div>
                <div className="console-route-line"><span className="route-node node-orange" /><span className="route-rule" /><span className="route-node node-teal" /><span className="route-rule" /><span className="route-node node-cream" /></div>
                <div className="route-labels mono"><span>RETELL</span><span>n8n</span><span>RESPONSE</span></div>
                <div className="console-result">
                  <div className="result-icon"><Check size={18} /></div>
                  <div><span className="result-kicker mono">VERIFIED LOOKUP</span><strong>ORD-TEST-001 is shipped.</strong><small>UPS · In transit · Test City</small></div>
                  <span className="result-code mono">200 OK</span>
                </div>
              </div>
              <div className="console-footer mono"><span>SAFE RESPONSE CONTRACT</span><span>action_taken: false</span></div>
            </div>
          </div>
          <div className="hero-bottom page-width"><span className="mono">01 / A CALM CONTROL SURFACE FOR MESSY CONVERSATIONS</span><span className="scroll-cue">Scroll to inspect <ArrowDownRight size={15} /></span></div>
        </section>

        <section className="signal-strip" aria-label="System properties">
          <div className="page-width signal-strip-inner">
            <div><span className="signal-number">04</span><span><strong>support intents</strong><small>track · cancel · return · refund</small></span></div>
            <div><span className="signal-number">03</span><span><strong>connected layers</strong><small>voice · logic · data</small></span></div>
            <div><span className="signal-number">00</span><span><strong>fake promises</strong><small>no invented business metrics</small></span></div>
            <div className="signal-strip-mark"><span className="signal-ring" /><span className="mono">L / 01</span></div>
          </div>
        </section>

        <section className="route-section section-paper" id="route">
          <div className="page-width route-layout">
            <div className="section-rail"><span className="rail-number mono">02</span><span className="rail-line" /><span className="rail-label mono">THE ROUTE</span></div>
            <div className="route-content">
              <div className="section-intro split-intro">
                <div><div className="eyebrow"><span className="eyebrow-dot" /> HOW THE HANDOFF WORKS</div><h2>One call. Three layers. <em>Nothing hidden.</em></h2></div>
                <p>The reference workflow keeps the voice layer, business logic, and data layer distinct. That makes it easier to inspect, adapt, and hand a failed request to a person instead of pretending it succeeded.</p>
              </div>
              <div className="route-board">
                <div className="route-board-art"><img src={asset.routePaper} alt="Abstract route map with voice waveform and data paths" /><div className="art-caption mono">LUMINA / ROUTE MAP / V1</div></div>
                <div className="route-steps">
                  <article className="route-step"><span className="step-index">01</span><div><div className="step-icon"><Radio size={19} /></div><h3>Voice layer</h3><p>Retell handles the conversation and passes a structured request forward.</p><span className="mono step-tag">INCOMING VOICE</span></div></article>
                  <article className="route-step"><span className="step-index">02</span><div><div className="step-icon"><Workflow size={19} /></div><h3>Logic layer</h3><p>n8n validates intent, looks up the order, and controls the fallback path.</p><span className="mono step-tag">ORCHESTRATION</span></div></article>
                  <article className="route-step"><span className="step-index">03</span><div><div className="step-icon"><Database size={19} /></div><h3>Data layer</h3><p>A buyer-owned source of truth returns the status. No guessed answer leaves the system.</p><span className="mono step-tag">VERIFIED RESPONSE</span></div></article>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="architecture-section section-paper" id="architecture">
          <div className="page-width architecture-layout">
            <div className="section-rail"><span className="rail-number mono">03</span><span className="rail-line" /><span className="rail-label mono">ARCHITECTURE</span></div>
            <div className="architecture-content">
              <div className="section-intro split-intro"><div><div className="eyebrow"><span className="eyebrow-dot" /> THE HANDOFF MAP</div><h2>Every layer has a job. <em>Every fallback has a name.</em></h2></div><p>Use this map to explain the template to a buyer, an engineer, or the person responsible for the first live call.</p></div>
              <div className="architecture-diagram" role="img" aria-label="Lumina architecture: Retell voice enters n8n orchestration, which reads order data and returns a verified response or human escalation">
                <div className="architecture-node node-input"><span className="architecture-node-index mono">01 / VOICE</span><div className="architecture-node-icon"><Radio size={20} /></div><h3>Retell AI</h3><p>Captures the call and structured intent.</p><span className="mono architecture-node-tag">INBOUND</span></div>
                <div className="architecture-connector"><span className="mono">webhook</span><span className="connector-line" /><ChevronRight size={15} /></div>
                <div className="architecture-node node-logic"><span className="architecture-node-index mono">02 / LOGIC</span><div className="architecture-node-icon"><Workflow size={20} /></div><h3>n8n</h3><p>Validates, routes, and applies safe fallbacks.</p><span className="mono architecture-node-tag">ORCHESTRATOR</span></div>
                <div className="architecture-branch"><div className="branch-line" /><div className="branch-label mono">lookup</div><div className="branch-line" /></div>
                <div className="architecture-node node-data"><span className="architecture-node-index mono">03 / DATA</span><div className="architecture-node-icon"><Database size={20} /></div><h3>Order source</h3><p>Returns a verified record from the buyer’s system.</p><span className="mono architecture-node-tag">SOURCE OF TRUTH</span></div>
                <div className="architecture-output"><div className="output-path"><span className="mono">verified response</span><span className="output-line teal-line" /><div className="architecture-node node-response"><span className="architecture-node-index mono">04A / RESPONSE</span><div className="architecture-node-icon"><Bot size={20} /></div><h3>Customer answer</h3><p>Retell speaks only what the route can verify.</p></div></div><div className="output-path"><span className="mono">uncertain / failed</span><span className="output-line orange-line" /><div className="architecture-node node-escalation"><span className="architecture-node-index mono">04B / SAFETY</span><div className="architecture-node-icon"><ShieldCheck size={20} /></div><h3>Human handoff</h3><p>State-changing or uncertain requests stay reviewable.</p></div></div></div>
              </div>
            </div>
          </div>
        </section>

        <section className="checklist-section section-paper" id="checklist">
          <div className="page-width checklist-layout">
            <div className="section-rail"><span className="rail-number mono">04</span><span className="rail-line" /><span className="rail-label mono">CHECKLIST</span></div>
            <div className="checklist-content">
              <div className="section-intro split-intro"><div><div className="eyebrow"><span className="eyebrow-dot" /> FROM FILE TO FIRST CALL</div><h2>Six checks between <em>“import” and “live.”</em></h2></div><p>Use this as the buyer’s handoff sheet. Each step has a clear owner and a piece of evidence to keep.</p></div>
              <div className="checklist-board">
                <div className="checklist-column"><div className="checklist-column-head"><span className="mono">01—03 / CONFIGURE</span><span className="checklist-column-rule" /></div><article className="checklist-item"><span className="checklist-index">01</span><div><h3>Prepare the accounts</h3><p>Create or confirm Retell, n8n, data-source, and model-provider access.</p><span className="mono checklist-owner">OWNER / BUYER</span></div></article><article className="checklist-item"><span className="checklist-index">02</span><div><h3>Load the environment</h3><p>Copy `.env.example`, fill placeholders locally, and keep secrets outside Git.</p><span className="mono checklist-owner">EVIDENCE / CONFIG REVIEW</span></div></article><article className="checklist-item"><span className="checklist-index">03</span><div><h3>Import the route</h3><p>Import the n8n workflows, connect credentials, and replace the Retell webhook placeholder.</p><span className="mono checklist-owner">EVIDENCE / ACTIVE WEBHOOK</span></div></article></div>
                <div className="checklist-column"><div className="checklist-column-head"><span className="mono">04—06 / VERIFY</span><span className="checklist-column-rule" /></div><article className="checklist-item"><span className="checklist-index">04</span><div><h3>Run the local demo</h3><p>Exercise known, unknown, validation, and duplicate-event scenarios before live traffic.</p><span className="mono checklist-owner">EVIDENCE / TEST OUTPUT</span></div></article><article className="checklist-item"><span className="checklist-index">05</span><div><h3>Place a test call</h3><p>Use synthetic order data first. Confirm the voice response, lookup, and post-call record.</p><span className="mono checklist-owner">EVIDENCE / CALL + LOG</span></div></article><article className="checklist-item"><span className="checklist-index">06</span><div><h3>Approve the handoff</h3><p>Document escalation, retention, monitoring, rollback, and who owns production incidents.</p><span className="mono checklist-owner">EVIDENCE / GO-LIVE SIGN-OFF</span></div></article></div>
              </div>
              <div className="checklist-note"><Sparkles size={17} /><span><strong>Suggested gate:</strong> do not connect production data until the local demo and one synthetic test call both pass.</span></div>
            </div>
          </div>
        </section>

        <section className="demo-section" id="demo">
          <div className="page-width demo-layout">
            <div className="section-rail inverse-rail"><span className="rail-number mono">05</span><span className="rail-line" /><span className="rail-label mono">SAFE DEMO</span></div>
            <div className="demo-content">
              <div className="section-intro split-intro inverse-intro">
                <div><div className="eyebrow light-eyebrow"><span className="eyebrow-dot" /> NO CREDENTIALS REQUIRED</div><h2>Try the response contract <em>before the accounts.</em></h2></div>
                <p>A local harness ships with synthetic orders, deterministic scenarios, and tests. It makes no network calls and never mutates an order.</p>
              </div>
              <div className="demo-console">
                <div className="demo-controls" role="tablist" aria-label="Demo scenarios">
                  {scenarios.map((scenario, index) => (
                    <button key={scenario.id} type="button" role="tab" aria-selected={activeScenario.id === scenario.id} className={activeScenario.id === scenario.id ? "is-active" : ""} onClick={() => setActiveScenario(scenario)}>
                      <span className="mono">0{index + 1}</span>{scenario.label}<ChevronRight size={15} />
                    </button>
                  ))}
                </div>
                <div className="demo-output" aria-live="polite">
                  <div className="demo-output-top"><span className="mono"><span className="pulse-dot" /> DEMO MODE / {activeScenario.event}</span><span className={`demo-status status-${activeScenario.accent}`}><span /> {activeScenario.statusLabel}</span></div>
                  <div className="demo-payload"><span className="mono payload-key">REQUEST</span><code>{`{ intent: "${activeScenario.intent}", order_id: "${activeScenario.id === "unknown" ? "ORD-TEST-999" : "ORD-TEST-00" + (activeScenario.id === "track" ? "1" : activeScenario.id === "cancel" ? "2" : "3")}" }`}</code></div>
                  <div className="demo-response"><span className="mono payload-key">RESPONSE</span><div><strong>{activeScenario.response}</strong><small>{activeScenario.detail}</small></div></div>
                  <div className="demo-audit-row"><span><span className="mono">source</span> synthetic fixture</span><span><span className="mono">side effects</span> none</span><span><span className="mono">event key</span> {activeScenario.event}</span></div>
                  <div className="demo-contract"><span><ShieldCheck size={16} /> demo_mode: true</span><span><LockKeyhole size={16} /> action_taken: false</span><span><Activity size={16} /> outcome: {activeScenario.status}</span></div>
                </div>
              </div>
              <div className="demo-footnote"><span className="mono">RUN IT LOCALLY</span><code>{demoCommand}</code><button className="copy-command" type="button" onClick={copyDemoCommand} aria-label="Copy the current demo command">{commandCopied ? <Check size={14} /> : <Copy size={14} />} {commandCopied ? "Copied" : "Copy command"}</button><a className="inline-link" href="https://github.com/MaryumAkram16/Lumina-AI-Voice-Customer-Support-Agent/blob/main/demo/scenarios.json" target="_blank" rel="noreferrer">View scenario source <ExternalLink size={14} /></a></div>
            </div>
          </div>
        </section>

        <section className="proof-section section-paper" id="proof">
          <div className="page-width proof-layout">
            <div className="section-rail"><span className="rail-number mono">06</span><span className="rail-line" /><span className="rail-label mono">PROOF</span></div>
            <div className="proof-content">
              <div className="section-intro split-intro"><div><div className="eyebrow"><span className="eyebrow-dot" /> THE ACTUAL WORKFLOW</div><h2>Show the system. <em>Don’t sell the fog.</em></h2></div><p>These are the workflow surfaces the template is built around. They are evidence to inspect, not claims of production performance.</p></div>
              <div className="proof-feature"><div className="proof-image-main"><img src={asset.workflow} alt="Lumina n8n workflow diagram" /><span className="image-index mono">01 / ORCHESTRATION MAP</span></div><div className="proof-aside"><div className="proof-note"><span className="mono">WHAT YOU CAN ADAPT</span><h3>Prompts, fields, fallbacks, and data source.</h3><p>Keep the route. Change the language, order system, escalation policy, and visual identity around it.</p></div><div className="proof-stat"><span className="signal-ring small-ring" /><span><strong>Repository-first</strong><small>Read the implementation before you buy the implementation.</small></span></div></div></div>
              <div className="proof-gallery"><figure><img src={asset.retell} alt="Retell voice agent configuration" /><figcaption><span className="mono">02</span> Voice configuration</figcaption></figure><figure><img src={asset.tracking} alt="Lumina order tracking flow" /><figcaption><span className="mono">03</span> Track order branch</figcaption></figure><figure><img src={asset.cancel} alt="Lumina cancellation flow" /><figcaption><span className="mono">04</span> Cancellation branch</figcaption></figure></div>
            </div>
          </div>
        </section>

        <section className="packages-section" id="packages">
          <div className="page-width packages-layout">
            <div className="section-rail inverse-rail"><span className="rail-number mono">07</span><span className="rail-line" /><span className="rail-label mono">THE KIT</span></div>
            <div className="packages-content">
              <div className="section-intro split-intro inverse-intro"><div><div className="eyebrow light-eyebrow"><span className="eyebrow-dot" /> CHOOSE YOUR HANDOFF</div><h2>Study the route. <em>Buy the readiness.</em></h2></div><p>The public repository stays open. The Pro Kit adds configuration, verification, operations, and defined implementation support around it.</p></div>
              <div className="package-board">
                {packages.map((pack, index) => <article key={pack.name} className={`package-card ${pack.featured ? "featured" : ""}`}><div className="package-top"><span className="mono">0{index + 1} / {pack.kicker}</span>{pack.featured && <span className="package-badge">RECOMMENDED</span>}</div><h3>{pack.name}</h3><p>{pack.description}</p><ul>{pack.includes.map((item) => <li key={item}><Check size={15} /> {item}</li>)}</ul><button type="button" className={pack.featured ? "button button-primary" : "button button-ghost"} onClick={() => scrollToId("footer-cta")}>{pack.action} <ArrowUpRight size={16} /></button></article>)}
              </div>
              <div className="package-links"><a href="https://github.com/MaryumAkram16/Lumina-AI-Voice-Customer-Support-Agent" target="_blank" rel="noreferrer">Explore the Community Reference <ExternalLink size={14} /></a><a href="https://github.com/MaryumAkram16" target="_blank" rel="noreferrer">Ask about private Pro access <ExternalLink size={14} /></a></div>
              <div className="package-disclosure"><FileText size={16} /><span>Not included: provider subscriptions, API credits, production hosting, custom integrations, or legal/compliance advice. <button type="button" className="inline-link" onClick={() => scrollToId("disclosure")}>Read the boundary <ArrowUpRight size={14} /></button></span></div>
            </div>
          </div>
        </section>

        <section className="faq-section section-paper" id="faq">
          <div className="page-width faq-layout">
            <div className="section-rail"><span className="rail-number mono">08</span><span className="rail-line" /><span className="rail-label mono">FAQ</span></div>
            <div className="faq-content">
              <div className="section-intro split-intro"><div><div className="eyebrow"><span className="eyebrow-dot" /> QUESTIONS BEFORE THE CALL</div><h2>Read the boundaries. <em>Then choose your route.</em></h2></div><p>Everything important should be clear before a buyer connects a provider account or sends production traffic.</p></div>
              <div className="faq-list">{faqItems.map((item, index) => <details className="faq-item" key={item.question} open={index === 0}><summary><span className="mono">0{index + 1}</span><strong>{item.question}</strong><span className="faq-plus" aria-hidden="true" /></summary><p>{item.answer}</p></details>)}</div>
            </div>
          </div>
        </section>

        <section className="disclosure-section section-paper" id="disclosure">
          <div className="page-width disclosure-layout"><div className="section-rail"><span className="rail-number mono">09</span><span className="rail-line" /><span className="rail-label mono">BEFORE PRODUCTION</span></div><div className="disclosure-content"><div className="eyebrow"><span className="eyebrow-dot" /> THE RESPONSIBLE VERSION</div><h2>Clear boundaries are part of the product.</h2><div className="disclosure-grid"><div><span className="mono disclosure-label">PRIVACY</span><p>The template is designed for privacy-conscious deployments. The buyer configures consent, retention, access control, and regional processing.</p></div><div><span className="mono disclosure-label">DEPENDENCIES</span><p>Retell, n8n, Google, and model-provider accounts are separate services with their own pricing, limits, and terms.</p></div><div><span className="mono disclosure-label">ESCALATION</span><p>Voice and model outputs can be wrong. State-changing actions need explicit authorization and a human path.</p></div></div></div></div>
        </section>

        <section className="footer-cta-section" id="footer-cta">
          <div className="footer-cta-image" style={{ backgroundImage: footerBackground }} aria-hidden="true" /><div className="footer-cta-overlay" aria-hidden="true" /><div className="page-width footer-cta-inner"><div className="eyebrow light-eyebrow"><span className="eyebrow-dot" /> READY FOR A PRIVATE TEST CALL?</div><h2>Keep the signal.<br /><em>Lose the guesswork.</em></h2><p>Inspect the demo, read the route, then decide how much help you want bringing Lumina into your stack.</p><div className="hero-actions"><button className="button button-primary" type="button" onClick={() => scrollToId("demo")}>Run the safe demo <ArrowDownRight size={17} /></button><button className="text-button light-text-button" type="button" onClick={() => scrollToId("route")}>Read the setup path <ChevronRight size={16} /></button></div></div>
        </section>
      </main>

      <footer className="site-footer"><div className="page-width footer-inner"><div className="footer-brand"><a className="brand-lockup" href="#top"><span className="brand-mark"><img src={asset.logo} alt="" /></span><span className="brand-wordmark">LUMINA</span></a><p>A configurable voice-support starter kit for teams who prefer visible handoffs to AI theater.</p></div><div className="footer-links"><div><span className="mono">EXPLORE</span><button type="button" onClick={() => scrollToId("route")}>The route</button><button type="button" onClick={() => scrollToId("demo")}>Safe demo</button><button type="button" onClick={() => scrollToId("proof")}>Workflow proof</button></div><div><span className="mono">DOCUMENTATION</span><a href="https://github.com/MaryumAkram16/Lumina-AI-Voice-Customer-Support-Agent/blob/main/SETUP.md" target="_blank" rel="noreferrer">Setup guide <ArrowUpRight size={13} /></a><a href="https://github.com/MaryumAkram16/Lumina-AI-Voice-Customer-Support-Agent/blob/main/OPERATIONS.md" target="_blank" rel="noreferrer">Operations <ArrowUpRight size={13} /></a><a href="https://github.com/MaryumAkram16/Lumina-AI-Voice-Customer-Support-Agent" target="_blank" rel="noreferrer">GitHub repository <ArrowUpRight size={13} /></a></div></div><div className="footer-last mono"><span>© 2026 LUMINA</span><span>BUILT FOR VISIBLE HANDOFFS</span></div></div></footer>
    </div>
  );
}
