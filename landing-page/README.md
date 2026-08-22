# Lumina Product Landing Page

This directory contains the static product page for the Lumina voice-support template. It is a separate frontend presentation layer; it does not replace or modify the Retell and n8n workflow exports in the repository root.

## Local development

```bash
cd landing-page
pnpm install
pnpm dev
```

The site is built with React, Vite, Tailwind CSS, and `lucide-react`. The interactive demo on the page is presentation-only and mirrors the provider-free demo contract in `../demo/`; it makes no provider calls.

## Production build

```bash
pnpm check
pnpm build
```

The Vite output is written to `dist/public`. It is a static site and can be published to GitHub Pages or another static host. Provider accounts are not required to build the page.

## Included page sections

The landing page contains the Harbor Console hero, route explanation, provider-free demo preview, actual workflow proof gallery, package comparison, buyer/privacy boundary, FAQ, and documentation links. Copy intentionally avoids customer testimonials, unverified business metrics, production guarantees, and claims that third-party services are included.

## Asset policy

Small optimized visual assets are stored in `client/public/assets/` for the static build. They are derived from the generated Lumina brand assets and the repository’s own workflow screenshots. No provider credentials, customer data, or production endpoints belong in this directory.

## Commercial links

The package CTA buttons currently route visitors to the relevant sections of the page. Replace them with an approved purchase, contact, or setup-service URL only after the final support scope, pricing, and commercial terms are decided.

## Community versus Pro

The page presents this public repository as the **Community Reference** and describes the Pro Implementation Kit as a separate private offering. The private kit adds deployment-readiness tooling, buyer-specific adapters, expanded verification, operations artifacts, and defined implementation support. Its private contents are not included in this public package.

The package comparison links to the public Community Reference and to the owner’s GitHub profile for private Pro access inquiries. Payment and checkout integration are intentionally not included until commercial URLs and final terms are approved.
