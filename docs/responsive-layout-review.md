# Responsive layout review

Checked 24 September 2026 using Playwright with headless Chrome and mobile/touch
emulation. These checks use device-sized browser viewports, not physical iPads
or Safari/WebKit. Screenshots were visually inspected as well as measured.

## Changes

- Replaced the fixed-height header that allowed wrapped phone navigation to
  overlap page content. Phones now have an accessible Menu/Close control;
  Escape closes it and restores focus. Navigation links have 44px minimum height.
- Tablet navigation gets its own row when needed; labels stay on one line and
  the brand tagline is hidden before it starts crowding the links.
- Portrait tablet practice uses the full content width, with rewards below the
  question instead of squeezing it beside a sidebar.
- About and How To stack their hero content and instructional cards on portrait
  tablets. The calendar summary uses five, three or two columns as space permits.
- Enlarged smaller touch controls and kept account form inputs at 16px on touch
  devices. Long account addresses wrap inside their cards.

## Viewport coverage

Nine loaded pages were checked at each of eighteen sizes: practice, word list,
calendar, rewards, account, About, How To, story library and story reader.
Authenticated pages used an isolated temporary account with representative
calendar data. Separate signed-out checks covered the account forms.

| Group | CSS viewport sizes |
| --- | --- |
| Phone portrait | 320×568, 375×667, 390×844, 430×932 |
| Phone landscape | 568×320, 667×375, 844×390 |
| Small tablet | 600×960 |
| iPad/tablet portrait | 768×1024, 810×1080, 820×1180, 834×1194 |
| iPad/tablet landscape | 1024×768, 1080×810, 1180×820, 1194×834 |
| Large tablet/desktop | 1366×1024, 1440×900 |

**162 of 162 page/viewport checks passed** after the fixes: no document-wide
horizontal overflow, overlapping navigation links or navigation outside its
header. No uncaught browser JavaScript exceptions were recorded. Expanded phone
menus were also checked for containment, non-overlap and 44px link height.

## Interaction checks

Passed at 320×568, 390×844, 768×1024, 834×1194, 1024×768, 1180×820 and 1366×1024:

- Touch/click navigation and keyboard Escape with focus restoration.
- Vocabulary difficulty selection and search, with matching results and exports.
- Calendar month navigation and day selection.
- Word-note popovers within the viewport before and after rotation.
- A visible sticky reading timer after scrolling.
- Correct mobile viewport scaling and no horizontal page scroll.

Signed-out email/password forms also fit at 320×568, 768×1024 and 1024×768.
Header lint, TypeScript checking and production build passed.

Local screenshots and machine-readable measurements are saved under
`outputs/responsive/` (ignored by Git). `audit.json` records the initial findings;
`audit-after.json` records the final 162-case matrix.
