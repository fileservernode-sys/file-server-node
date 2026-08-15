# Main Website Frontend — Remote Android Personal File Server Platform

This directory contains the production-ready frontend foundation for the **Main Website** component of the Remote Android Personal File Server Platform.

---

## 1. Overview & Architecture

The Main Website is the public marketing, account control, documentation, and device status/discovery interface.

### Technology Stack
- **HTML5**: Semantic HTML with accessibility (WCAG 2.1) and SEO meta tags.
- **Modern Vanilla CSS**: Modular CSS split into tokens, reset/base, components, layouts, and section styles. Completely shared-hosting friendly (e.g. Serverbyt HTML/PHP hosting).
- **Vanilla JavaScript**: Pure JS for sticky header, responsive mobile drawer menu, accessible keyboard handlers, and status demo toggles. Zero external frameworks or heavy dependencies.

---

## 2. Directory Structure

```
main website/Frontend/
├── index.html              # Main website homepage (all 13 sections)
├── pages/
│   ├── product.html        # Product overview & 3 core components breakdown
│   ├── how-it-works.html   # 10-step complete setup sequence & file storage explanation
│   ├── documentation.html # Documentation center hub & topic cards
│   ├── pricing.html       # Provisional pricing comparison table & pricing FAQ
│   ├── about.html         # Mission statement, hardware reuse & values
│   ├── contact.html       # Interactive contact form UI with frontend feedback
│   ├── faq.html           # Accessible ARIA accordion categories
│   ├── privacy.html       # Structured Privacy Policy placeholder
│   ├── terms.html         # Structured Terms of Service placeholder
│   ├── login.html         # Frontend Sign In interface placeholder
│   └── get-started.html    # Frontend Account Creation interface placeholder
├── css/
│   ├── variables.css      # Centralized design system tokens
│   ├── base.css           # Reset, typography defaults, accessibility focus states
│   ├── components.css     # Reusable buttons, cards, badges, loaders, forms, accordions, page header
│   ├── layout.css         # Containers, sticky header, mobile drawer menu, footer layout
│   └── sections.css       # Styles for homepage sections & internal page grids
├── js/
│   └── main.js            # Sticky header, drawer toggle, keyboard navigation, accordion, form handlers
├── assets/
│   └── icons/             # SVG vector icon assets
└── README.md              # Frontend documentation
```

---

## 3. Design System & Component Catalog

### Shared UI Components (`css/components.css`)
- **Page Header**: `.page-header` with title, subtitle, eyebrow badging, and `.breadcrumbs`.
- **Accessible Accordion**: `.accordion`, `.accordion-item`, `.accordion-trigger`, `.accordion-panel`, `.accordion-icon` with `aria-expanded` state tracking and smooth panel toggling.
- **Form Controls**: `.form-group`, `.form-label`, `.form-input`, `.form-select`, `.form-textarea`, `.form-checkbox`, `.form-radio`, `.alert-info`, `.alert-success`, `.alert-error`.
- **Status Indicators**: `status-online`, `status-connecting`, `status-reconnecting`, `status-offline`.

---

## 4. Deferral & Scope Limits Notice

The following functionality is intentionally deferred to later backend/integration batches:
- Real account registration, login authentication, and session cookie management.
- Real email verification sending.
- MySQL database storage and REST API communication.
- Android application HTTP file server and WebSocket gateway tunneling.
- Real subdomain provisioning and DNS automation.


---

## 3. Design System Tokens (`css/variables.css`)

### Color Palette (White/Light Minimalist Luxury Theme)
- `--color-primary`: `#0F172A` (Deep Slate Navy)
- `--color-accent`: `#2563EB` (Royal Blue Accent)
- `--color-background`: `#FAFAFC` (Canvas Light Off-White)
- `--color-surface`: `#FFFFFF` (Pure White Surface)
- `--color-surface-secondary`: `#F1F5F9` (Elevated Neutral Surface)
- `--color-border`: `#E2E8F0` (Default Border)

### Status Indicators (Multi-modal Color + Dot + Text)
- `status-online`: Emerald Green (`#059669`) — Server connected and ready
- `status-connecting`: Amber (`#D97706`) — Tunnel establishing
- `status-reconnecting`: Amber (`#D97706`) — Re-establishing connection
- `status-offline`: Slate (`#64748B`) — Device offline

---

## 4. Local Preview & Testing

To run locally without a build tool:

Using Python:
```bash
cd "main website/Frontend"
python -m http.server 8080
```
Then open `http://localhost:8080` in your web browser.

Or open `index.html` directly in any web browser.

---

## 5. Responsive Breakpoints

- **Mobile Small**: 320px – 390px
- **Mobile Large**: 430px
- **Tablet**: 768px
- **Laptop / Desktop**: 1024px – 1440px
- **Large Screen**: 1920px

---

## 6. Future Component Reference

The tokens and visual style defined here serve as the master reference for:
1. **Flutter Android Application** (Component 2)
2. **In-Built Web File Manager** (Component 3)
