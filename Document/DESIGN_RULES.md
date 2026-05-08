# NireQ Design Rules — Operational UI Guidelines

**Version:** 1.0  
**Audience:** Engineering team  
**Scope:** Customer flow, POS flow, staff dashboard  
**Priority order:** Operational clarity → Usability → Consistency → Aesthetics

---

## 1. Design Philosophy

### The Core Problem

NireQ operates inside real creator/cosplay/artist event booths. These environments are:

- Crowded, loud, and physically chaotic
- Lit by direct event lighting (bright, variable)
- Operated by staff under time pressure serving 5–15 customers per hour
- Accessed by customers on phones while standing in crowds
- Running on unstable venue WiFi, mobile data, or shared hotspots

Standard startup UI conventions (subtle grays, micro-animations, dense dashboards) fail in this environment. An interface designed for a calm office desktop will create errors, slow down service, and frustrate customers when used at a booth.

### The Design Contract

> **Every UI decision must pass this test: will this be faster and clearer at a live event than the alternative?**

Principles ranked by importance:

1. **Operational speed** — Staff must complete common actions in 1–2 taps without reading
2. **State clarity** — Queue status must be readable at a glance from 50cm away
3. **Error prevention** — The UI must make destructive actions hard to trigger accidentally
4. **Stability** — The layout must not jump, flash, or reflow during realtime updates
5. **Recovery** — When something fails, the UI must offer a clear next step
6. **Aesthetics** — Visual polish matters, but only after the above are satisfied

### What This Is Not

- Not a branding exercise. NireQ's visual identity is secondary to operational reliability.
- Not a dashboard product. Admins and staff need actions, not charts.
- Not a consumer app. Speed and correctness matter more than delight animations.
- Not a desktop app. Every interaction must work one-handed on a phone.

---

## 2. Information Hierarchy Rules

### Priority Layers

Information should be visually weighted in this order:

| Layer | What it represents | Visual treatment |
|---|---|---|
| **1 — Alert** | You are being called / something requires immediate action | Full-card highlight, animation, bright color |
| **2 — Status** | Your current queue number and state | Large number, bold badge, high contrast |
| **3 — Context** | Which event, which booth, how many ahead | Medium text, subdued |
| **4 — Guidance** | What to do next | Smaller text, tonal color matching state |
| **5 — Metadata** | Timestamps, counts, history | Smallest text, gray |

### Typography Hierarchy

```
Queue number / Payment total:   text-5xl to text-7xl  font-black  (most important data)
Section heading:                text-lg to text-xl    font-black
Card title / Status badge:      text-sm to text-base  font-bold
Body / Guidance text:           text-sm               font-medium
Supporting detail:              text-xs               font-medium  text-gray-500
Micro labels / timestamps:      text-[10px]-text-[11px] font-bold uppercase tracking-wide
```

**Rule:** Use `font-black` only for numbers and single-word states that must be read instantly. Use `font-bold` for most readable labels. Never use `font-normal` for interactive elements.

### Card Prioritization

Cards should communicate their importance through background + border, not just text:

- **Urgent / Calling:** Colored background (`bg-yellow-50`), colored ring (`ring-yellow-400`), may animate
- **Active / Serving:** Tinted background (`bg-sky-50`), colored border
- **Neutral / Waiting:** White or very light gray background, standard border
- **Ended / Complete:** Light tinted background, muted border, lower visual weight
- **Disabled / Error:** Reduced opacity or red tint with explicit label

Never rely on a single visual property to communicate state. Always combine: background color + border + badge text.

---

## 3. Color System

### Status Semantic Colors

These colors are fixed to their meaning across the entire application. Do not reassign them.

| State | Background | Border | Badge bg | Badge text | Usage |
|---|---|---|---|---|---|
| **Waiting** | `bg-gray-50` | `border-gray-200` | `bg-gray-200` | `text-gray-700` | Customer in queue, not yet called |
| **Calling** | `bg-yellow-50` | `border-yellow-200` | `bg-yellow-500` | `text-white` | Customer is being called — urgent |
| **Serving** | `bg-sky-50` | `border-sky-200` | `bg-sky-500` | `text-white` | Currently at booth, being served |
| **Complete** | `bg-green-50` | `border-green-200` | `bg-green-100` | `text-green-700` | Transaction complete |
| **Paid** | `bg-emerald-50` | `border-emerald-200` | `bg-emerald-100` | `text-emerald-700` | Payment confirmed (use in POS) |
| **Expired / Missed** | `bg-purple-50` | `border-purple-200` | `bg-purple-100` | `text-purple-700` | Session ended, ticket expired |
| **Cancelled** | `bg-red-50` | `border-red-200` | `bg-red-100` | `text-red-700` | Explicitly cancelled by user/admin |
| **Error / Problem** | `bg-red-50` | `border-red-200` | `bg-red-500` | `text-white` | System error requiring action |
| **Warning / Caution** | `bg-amber-50` | `border-amber-200` | `bg-amber-100` | `text-amber-800` | Recoverable issue, staff should check |
| **Disabled / Loading** | `bg-gray-50` | `border-gray-100` | — | `text-gray-400` | Not actionable, waiting for data |

### Brand Accent

- Primary action: `bg-pink-600` (`#be185d`) — use only for the single most important CTA per screen
- Primary hover: `bg-pink-700` (`#9d174d`)
- Primary shadow: `shadow-pink-200`
- Soft brand background: `bg-pink-50` / `bg-[#fff7fb]`

The pink brand color is used for: "Get ticket" button, "Charge" button, selected queue tab, active nav item. Do not use pink for status communication.

### Offline / Disconnected

`bg-red-600 text-white` — sticky banner at top of screen. This state must be unmissable. No other uses of full-width `bg-red-600` banners.

### Color-only is never enough

Every color-coded state must also carry a text label (badge or heading). Do not communicate state by color alone. Staff in bright environments and colorblind users must be able to read state from text.

---

## 4. Layout & Spacing Rules

### Mobile-First Constraints

Customer views: constrained to `max-w-md mx-auto` (448px). Staff dashboard: full viewport with responsive breakpoints (`md:` for sidebar/panel split).

The phone-width constraint on customer views is intentional — it ensures the UI is readable and reachable one-handed on all screen sizes without requiring zoom.

### Spacing Scale

Use this scale consistently. Do not create custom spacing values except for safe-area utilities:

| Token | Value | Use |
|---|---|---|
| `gap-1` | 4px | Inline elements, badge internals |
| `gap-2` | 8px | Tight groups (icon + label) |
| `gap-3` | 12px | Related elements (card internals) |
| `gap-4` | 16px | Distinct elements within a section |
| `p-3` | 12px | Compact card padding |
| `p-4` / `px-4 py-3` | 16px / 16px+12px | Standard card / section padding |
| `space-y-2` | 8px | List items |
| `space-y-3` | 12px | Cards in a list |
| `mb-4` | 16px | Section separator |

### Touch Target Sizing

Every interactive element must meet minimum touch target requirements:

- **Minimum height for buttons:** `min-h-11` (44px) — WCAG 2.1 AA recommendation
- **Minimum height for primary actions:** `min-h-12` (48px) or `py-3` + text height
- **Minimum height for icon-only buttons:** `min-h-11 min-w-11` — see `.icon-touch` utility
- **Minimum height for inline controls (qty +/-):** `h-6 w-6` is acceptable inside a 44px row, but the row itself must be at least 44px tall

Apply `.touch-manipulation` (CSS: `touch-action: manipulation`) to all interactive elements. This eliminates the 300ms tap delay and prevents accidental double-tap zoom — critical for fast staff operation.

### Safe Area (iPhone)

Use these CSS utilities on all elements pinned to screen edges:

- `.pt-safe-top` — on banners pinned to `top-0` (clears iPhone notch / Dynamic Island)
- `.pb-safe-bar` — on bars/sheets pinned to `bottom-0` (clears iPhone home bar)

Never pin a primary action button to `bottom-0` without `.pb-safe-bar`.

### Section Grouping

Group related controls visually using `rounded-xl border border-gray-100 bg-white` cards with `p-3` or `p-4` padding. Use `space-y-3` between cards. Use a visible `border-b` or margin between distinct functional sections (e.g., queue controls vs. ticket list).

Do not use color differences alone to group sections — use explicit card boundaries.

---

## 5. Button & Action Rules

### Button Hierarchy per Screen

Each screen should have at most **one** primary action. All other buttons are secondary or tertiary.

| Level | Style | When to use |
|---|---|---|
| **Primary** | `bg-pink-600 text-white font-bold rounded-xl py-3 shadow-pink-200` | The single most important action: "Get Ticket", "Charge", "Confirm Order" |
| **Secondary** | `bg-white border border-gray-200 text-gray-700 font-bold rounded-xl py-3` | Supporting actions that don't complete a flow |
| **Tertiary** | `text-gray-500 font-bold` (no background/border) | Low-risk actions: "Cancel", "Dismiss", "Clear filter" |
| **Danger** | `bg-red-50 border border-red-200 text-red-600 font-bold rounded-xl` | Destructive but reversible: "Leave queue" before confirmation |
| **Danger confirmed** | `bg-red-600 text-white font-bold rounded-xl` | Used only inside a confirmation dialog |
| **Disabled** | `opacity-50 cursor-not-allowed` + original style | Loading, invalid state, or permission denied |

### Confirmation for Destructive Actions

Any action that is hard to reverse (leave queue, delete, cancel order) must use a **two-step confirmation**:

1. First tap: opens `ConfirmDialog` with clear explanation of consequence
2. Second tap (inside dialog): executes the action

The cancel/dismiss option in the dialog must be clearly more accessible than the confirm button (larger or placed first on mobile).

Never execute a destructive action on first tap, even if the button label already says "Leave" or "Cancel."

### Preventing Duplicate Actions

All async actions must be guarded against double-tap:

1. **In-flight ref** (`useRef(false)`) — server-side guard against RPC duplication
2. **`disabled={loading}`** — render-time guard to grey out the button
3. **`touch-action: manipulation`** — browser-level double-tap prevention

If a button is `disabled`, it must visually appear disabled (opacity or greyed out). Never hide a button that is temporarily unavailable — keep it visible but disabled with a clear label explaining why (e.g., "Order load failed").

### Button Labels

- Use verbs: "Charge ฿120", "Leave Queue", "Open Booth"
- Include the consequence when space allows: "Charge ฿120" not "Pay"
- Show current state during loading: "Processing..." not just a spinner
- Show the reason when blocked: "Order load failed" or "No active event"

---

## 6. Queue UX Rules

### Current Serving Visibility

The "Now Serving" indicator must be the first and most visible element on any customer queue screen. It must:

- Show a large number (`text-5xl font-black`) in high contrast (white on dark background)
- Include a live indicator dot (animated or color-coded)
- Always be visible even when the customer has a ticket — they need to know where the queue is relative to their number
- Show `--` (not blank, not "none") when no queue is being served

### Customer Queue Number

The customer's own queue number is their primary identity in the system. Display it at `text-7xl font-black` in the ticket card. This must be readable from a distance of 50cm in bright light. Do not reduce this size.

### Fairness Communication

Customers are anxious about queue position. Show:

- Estimated wait time range ("~8–12 min, 4 people ahead") when data is available
- ETA based on current service pace, not raw position alone
- If ETA is unavailable, display a neutral message — never show a placeholder or a zero

### Empty States

Empty states must explain why it's empty and what to do:

- "No queues serving" — show when the booth hasn't started calling yet
- "Queue closed temporarily" — show when staff has paused the queue
- Never show a blank space. Every empty state needs a label and guidance.

### Queue Transition Clarity

When a ticket changes state (waiting → calling), the transition must be:

- **Immediate** — realtime update, not on next refresh
- **Unmissable** — color change + badge change + (for calling) animation pulse
- **Persistent** — the "calling" state must remain visible until the customer dismisses it or it transitions to "serving"

The calling notification banner (`CallingNotification`) is `fixed top-0` for this reason — it renders above all content regardless of scroll position.

### Ticket Lifecycle Communication

| Status | What customer sees | What they should do |
|---|---|---|
| waiting | Gray card, queue number, ETA | Wait; browse the menu |
| calling | Yellow card, pulsing ring, banner notification | Go to booth immediately |
| serving | Sky blue card | You're being served |
| complete | Green card | Transaction complete |
| expired | Purple card | Ticket no longer valid; rejoin if needed |
| missed/cancelled | Red card | Queue cancelled |

---

## 7. POS UX Rules

### Speed is the Primary Metric

Staff are handling 5–15 customers per hour under real event pressure. Every extra tap or decision costs 3–10 seconds. Design for the common case (select customer → add items → charge) to complete in under 10 seconds.

### Cart Panel Behavior

- **Desktop:** Cart is always visible as a fixed side panel
- **Mobile:** Cart is a sticky bottom bar that expands into a bottom sheet on tap
- The cart bar must always show: item count, total amount, selected queue
- Cart must never be empty-looking when items exist — the item count and total are the primary indicators
- Previous cart contents must remain visible during loading (overlay spinner, not cleared state)

### Queue Selection

Staff must be able to select a queue customer with a single tap. The queue selector row must:

- Show queue number prominently (`Queue #3`, not just `3`)
- Highlight the selected queue clearly (filled background, not just a border change)
- Support walk-in (no queue) as the default state
- Not require scrolling to see the first 3–5 serving queues

### Payment Flow

The payment confirmation screen must:

- Show the total prominently before the payment buttons
- Use large tap targets (`p-6` cards) for CASH and TRANSFER — staff are often looking at the customer, not the screen
- Block the buttons when loading or in error state
- Show "Payment status unknown" (not an error) on network timeout — staff must understand the difference between "payment definitely failed" and "network interrupted, check history"

### Stock and Catalog

- Items should be sorted by: pinned first, then alphabetical (default)
- Out-of-stock items should be filtered out — staff should not need to manually skip them
- Low-stock items should show a warning badge but remain selectable
- Overdrafted cart items (stock sold while item was in cart) should be shown in red with an explicit "reduce or remove before charging" label

### Error Prevention in Checkout

- Never allow checkout with overdrafted items
- Never allow checkout when order data is in error state (`fetchError`)
- Never allow checkout without an active event
- All blocking conditions should be stated in the button label, not just in the disabled state

---

## 8. Loading / Error / Empty State Rules

### Loading States

**During initial load:** Show a skeleton that matches the layout of the loaded content. The skeleton should preserve the structure of cards, header, and action areas so the layout does not jump when data arrives.

**During action (async operation):** Show a spinner overlay or button loading state. Do not clear existing content. The previous data should remain visible under a semi-transparent overlay (`bg-white/60 backdrop-blur-[1px]`).

**During queue switch (POS):** Previous cart remains visible under a loading overlay. Do not flash an empty cart state between queue switches.

### Error States

An error state must:

1. Describe what failed (not "Something went wrong")
2. Describe what the user can do (retry, refresh, contact staff)
3. Not leave previously valid data in an actionable state

For the POS order fetch error specifically: show an overlay over the cart, disable all cart actions, and set the Charge button label to "Order load failed". The customer should not be chargeable when the server state is unknown.

### Empty States

Every list, section, or data area must have a defined empty state:

| Component | Empty state |
|---|---|
| Queue list — no waiting customers | "No customers waiting" (show the heading, list the count as 0) |
| Product catalog — no results | "No products match your filter — clear filters to see all items" |
| Order history — no orders | "No orders yet for this event" |
| Serving queues — none | "No queues serving" (italic, gray) |

Never show a blank space. An empty list with no label reads as "broken" to users.

### Offline / Disconnected

Show a full-width sticky banner at `top-0 z-[60]` with high contrast (`bg-red-600 text-white`) when realtime is disconnected. This banner must:

- Appear immediately on disconnect
- Disappear immediately on reconnect
- Not require any user action to dismiss — it's informational, not blocking
- Be rendered above all content (not hidden by modals or sheets)

---

## 9. Realtime UX Principles

### Preserve Layout Stability

Realtime updates must not cause layout shifts. Rules:

- Reserve space for dynamic content (queue number, price totals) before data arrives using skeleton or placeholder dimensions
- Use `min-h-[...]` to reserve minimum height for variable-content areas
- Animate content changes within their reserved space — do not change the element's dimensions on update

### Coalesce Burst Updates

When multiple realtime events arrive in rapid succession (e.g., 5 queue status changes in 500ms), debounce the UI update:

```ts
// Correct: coalesce with setTimeout
if (timerRef.current) clearTimeout(timerRef.current);
timerRef.current = setTimeout(() => fetchNowServing(), 200);

// Wrong: update on every event
channel.on('...', () => fetchNowServing()); // fires 5× in 500ms
```

The 200ms debounce is invisible to users but prevents multiple fetches and layout flashes.

### Optimistic vs. Confirmed Updates

| Action | Update timing | Reason |
|---|---|---|
| Booth open/close | Optimistic (immediate) | Low risk, reversal is cheap |
| Broadcast message | Optimistic | Fast feedback matters; failures roll back |
| Queue status change | Optimistic | Critical for staff speed |
| Payment / checkout | **Confirmed only** | Financial transaction — never show success before RPC confirms |
| Ticket creation | **Confirmed only** | Customer must have a real ticket ID to display |

Never show "Payment completed" before the payment RPC resolves successfully.

### Realtime Status Communication

- **Connected:** No indicator needed — silence is the normal state
- **Disconnecting / reconnecting:** Show subtle spinner or connection badge near affected data
- **Disconnected:** Full red banner (see Section 8)
- **Stale data:** Show a "last updated X minutes ago" label only when data may be stale (e.g., after extended disconnect)

### Version-Gated State Updates

When multiple async requests can be in flight simultaneously (e.g., rapid queue selection), use a version/token pattern to ensure only the latest request updates state:

```ts
const version = ++fetchVersionRef.current;
// ... fetch ...
if (version !== fetchVersionRef.current) return; // stale, discard
setMyData(result);
```

This prevents older responses from overwriting newer state — critical during fast POS queue switching.

---

## 10. Accessibility & Event Environment Considerations

### Bright Environments

Event venues use strong overhead and spot lighting. Designs must account for:

- **Low contrast fails:** Never use `text-gray-300` or `text-gray-400` for any meaningful text. Minimum: `text-gray-500` for supporting text, `text-gray-700` for anything the user needs to read
- **Washed-out colors:** Avoid relying on pastel colors alone for state communication. Use filled badges (`bg-yellow-500 text-white`) for urgent states, not `bg-yellow-100 text-yellow-600`
- **Glare on glass:** Customers holding phones in bright light need maximum contrast on status numbers. Use `font-black` and high-contrast backgrounds for queue numbers

### Touch Accuracy Under Pressure

Staff and customers in crowded environments have imprecise touch:

- Minimum 44px touch target on all interactive elements (enforced by `min-h-11`, `.icon-touch`)
- Add `touch-action: manipulation` to prevent double-tap zoom interfering with fast tapping
- Avoid placing two adjacent destructive actions near each other without sufficient spacing (`gap-3` minimum)
- Do not place the "Leave Queue" or "Cancel Order" button immediately adjacent to the primary action button

### Fast-Glance Readability

The queue number must be readable in under 1 second from the customer's natural phone-holding distance:

- Queue number: `text-7xl font-black` (72px) minimum
- "Now Serving" number: `text-5xl font-black` (48px) minimum
- Status badges: `text-xs font-bold uppercase tracking-wide` — short words only (max 2 words)

### Staff Under Stress

Staff are performing fast, repetitive operations under customer pressure. UI rules for staff views:

- The most common action per screen must be reachable without scrolling on mobile
- Destructive actions must require two taps (confirmation dialog)
- Loading and error states must be explicit — staff cannot afford to re-read instructions
- Error messages must specify what to do next, not just what failed

### Screen Size Coverage

Test all views at these breakpoints:

| Breakpoint | Context |
|---|---|
| 375px (iPhone SE) | Smallest supported phone |
| 390px (iPhone 14) | Most common customer phone |
| 768px (iPad / tablet) | Booth tablet setup |
| 1024px+ (laptop) | Staff management dashboard |

Staff dashboard panels must function at 768px without horizontal scroll. Customer views are constrained to `max-w-md` (448px) on all breakpoints.

---

## 11. Component Consistency Rules

### Border Radius

| Size | Usage |
|---|---|
| `rounded-full` | Badges, counters, pill labels, avatar images |
| `rounded-xl` (12px) | Buttons, small cards, input fields |
| `rounded-2xl` (16px) | Standard content cards, modals |
| `rounded-3xl` (24px) | Large hero cards, bottom sheets |

Do not mix border radius values within the same card component.

### Shadows

| Class | Usage |
|---|---|
| `shadow-sm` | Subtle card lift |
| `shadow-md` | Interactive cards (hover state) |
| `shadow-lg` | Modals, important floating elements |
| `shadow-2xl` | Bottom sheets, payment modals |
| `shadow-pink-200` | Primary action buttons only |

Do not add shadows to list items, inline badges, or table rows.

### Typography Scale (Tailwind Classes)

```
text-[9px]  – Timestamp, micro count (e.g., "+2 more")
text-[10px] – Section label, uppercase tracking header
text-[11px] – Supporting detail, badge label
text-xs     – Body supporting text, list item detail  
text-sm     – Primary body text, button labels
text-base   – Card title, important labels
text-lg     – Section heading
text-xl     – Page heading (staff)
text-2xl+   – Not used for headings; reserved for numbers (POS total, queue number)
```

### Icon Usage

- Use `lucide-react` exclusively — do not mix icon libraries
- Icon size: `size={14}` for inline/badge icons, `size={16}` for button icons, `size={18}` for banner icons, `size={20-24}` for standalone status icons
- Icons must have `aria-hidden="true"` when paired with a text label
- Icons must have an accessible label (`aria-label`) when used alone as a button

### Status Badges

All status badges must follow this pattern:

```tsx
<span className="px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wide bg-{tone} text-{tone}">
  {statusLabel}
</span>
```

- Always `rounded-full`
- Always `uppercase` + `tracking-wide`
- Always a text label (never icon-only)
- Text label: 1–2 words maximum ("Waiting", "Now Serving", "Complete")

### Toast / Feedback Messages

Toast tone rules (non-negotiable):

| Tone | When to use | Examples |
|---|---|---|
| `success` | Action completed successfully | "Payment completed", "Queue cancelled" |
| `error` | Action failed, likely not retried safely | "Payment failed", "Could not get ticket" |
| `warning` | Action blocked or state requires attention | "Cart is empty", "No active event", "Ticket expired" |
| `info` | Neutral state information, no action required | "Not your turn yet" |

**Rule:** If the user needs to do something because of the message, use `warning` or `error`. Use `info` only for genuinely neutral information.

### Modal Behavior

- Modals must be dismissible by tapping outside (backdrop click) on all sizes
- Modals must not auto-close without user action (except transient toasts)
- On mobile, prefer bottom sheets (`rounded-t-3xl`) over centered modals — they are easier to interact with one-handed
- Bottom sheets must use `max-h-[78dvh]` to leave the header visible behind them
- Bottom sheets must add `.overscroll-contain` to their scroll area to prevent background scroll chain

---

## 12. Anti-Patterns to Avoid

### Over-Animation

**Bad:** Framer Motion transitions on every state change, spinning loaders that draw attention away from content, count-up animations on numbers.

**Why it fails:** During an event, staff need to read state instantly. Animations add latency to perception. A 300ms fade-in means the staff member reads the data 300ms later.

**Allowed exceptions:** Single entrance animation for the "calling" state (to catch attention), subtle skeleton pulse, `animate-bounce` on the "now serving" arrow.

### Fancy Dashboard Clutter

**Bad:** Analytics charts, utilization graphs, heatmaps, sparklines, "insights" panels in the operational dashboard.

**Why it fails:** Staff does not have time to interpret visualizations during active queue management. Any non-operational information competes for visual attention and slows down task completion.

**Allowed:** Simple counters (waiting: 12, serving: 3), elapsed time since last call.

### Tiny Buttons

**Bad:** Action buttons under 36px height, icon-only buttons without labels in primary flows, action links styled as small text.

**Why it fails:** At an event booth, staff may be wearing gloves, have sweaty hands, or be rushing. Touch error rates increase dramatically below 44px.

### Color-Only Communication

**Bad:** Using only color to indicate status (green dot = open, no label), red text with no icon or label for errors.

**Why it fails:** Bright environments wash out colors. Some users are colorblind. In a crowded booth, staff and customers cannot reliably interpret subtle color differences.

### Hidden Important Actions

**Bad:** Putting "Call Next" behind a menu, requiring scroll to reach the charge button, putting the booth toggle inside settings.

**Why it fails:** Common actions must be always visible and reachable in 1 tap. If a common action requires navigation, staff will miss it or slow down significantly.

### Excessive Modals

**Bad:** Every operation opens a modal (add product → modal, edit item → modal, view order → modal).

**Why it fails:** Modals break flow, require context switching, and on mobile require dismissal before continuing. Limit modals to: confirmations of destructive actions, payment flow, and complex forms.

### UI Jitter During Realtime Updates

**Bad:** Queue list reorders every time a status changes, cart panel collapses during order load, page scrolls to top on realtime event.

**Why it fails:** Staff are mid-operation when updates arrive. Unexpected layout changes cause errors (tapping the wrong item after a reorder, losing cart context).

**Fix:** Preserve scroll position, use stable keys, coalesce burst updates, keep previous content visible during re-fetch.

### Technical Error Messages

**Bad:** "PGRST116: no rows returned", "NetworkError when attempting to fetch resource", "Error: 403 Forbidden".

**Why it fails:** Staff and customers cannot act on these. They create anxiety without providing resolution path.

**Rule:** All user-visible error messages must describe what happened in plain language and what to do next.

---

## 13. Suggested Future Improvements

These are not current requirements. They are investment areas once the operational foundation is stable.

### Design Token System

Extract the current hardcoded color + spacing values into a structured token file:

```ts
// design-tokens.ts
export const tokens = {
  status: {
    waiting:  { bg: 'bg-gray-50',    border: 'border-gray-200',   badge: 'bg-gray-200 text-gray-700' },
    calling:  { bg: 'bg-yellow-50',  border: 'border-yellow-200', badge: 'bg-yellow-500 text-white' },
    serving:  { bg: 'bg-sky-50',     border: 'border-sky-200',    badge: 'bg-sky-500 text-white' },
    complete: { bg: 'bg-green-50',   border: 'border-green-200',  badge: 'bg-green-100 text-green-700' },
  },
  // ...
};
```

This eliminates status color duplication across QueueView, QueuePanel, PosPanel, and any future admin views.

### Shared Status Badge Component

```tsx
<StatusBadge status="calling" />    // renders: bg-yellow-500 text-white rounded-full
<StatusBadge status="waiting" />    // renders: bg-gray-200 text-gray-700 rounded-full
```

Currently status badge styling is duplicated in at least 3 files. A single component would enforce consistency and make status color changes a one-line update.

### Advanced Booth Analytics (Low Priority)

Only useful after core operations are stable and booths have run multiple events:

- Orders per hour graph (event post-mortem, not live)
- Average service time by day
- Queue depth over time
- Popular items by event

These belong in a separate "Reports" view, never in the operational dashboard.

### Theme System

A dark mode or high-contrast mode could improve visibility in very bright environments or very dark venue lighting. Implement only after the component library is fully componentized — retrofitting theme support into raw Tailwind class strings is prohibitively expensive.

### Animation System

Once operational stability is complete, a coordinated motion language would improve polish:

- Status transition timing: `duration-200 ease-in-out` as the base
- Enter animations: `opacity-0 scale-95` → `opacity-100 scale-100`
- Exit animations: immediate (never delay content removal)
- Calling pulse: 1.5s ease-in-out cycle only (not faster — causes stress)

---

## Appendix: Quick Reference — Current CSS Utilities

```css
/* Touch / interaction */
.touch-manipulation { touch-action: manipulation; }
.workspace-action    { min-height: 2.75rem; touch-action: manipulation; }
.icon-touch          { min-width: 2.75rem; min-height: 2.75rem; }

/* Safe area (iPhone) */
.pt-safe-top  { padding-top: max(0.75rem, env(safe-area-inset-top)); }
.pb-safe-bar  { padding-bottom: max(0.625rem, env(safe-area-inset-bottom)); }

/* Scroll */
.no-scrollbar      { -ms-overflow-style: none; scrollbar-width: none; }
.overscroll-contain { overscroll-behavior: contain; }

/* Animation */
.fade-in            { animation: fade-in 200ms ease-in-out; }
.animate-pulse-subtle { animation: pulse-subtle 2s infinite; }
```

---

*This document reflects the NireQ codebase as of May 2026. Update it when patterns change — stale guidelines are worse than no guidelines.*
