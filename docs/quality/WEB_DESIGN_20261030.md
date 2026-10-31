# Platinum Circles public web design and connected journeys

Date: 2026-10-30. This report describes source implementation and local, actual-component browser checks. Hosted deployment and release acceptance are recorded separately in `DESIGN_COMPLETION_20261030.md`.

## Design direction

The supplied Home, Discover, personal/creator/business profile, composer and settings concepts establish the visual direction: a navy identity, white or deep-dark surfaces, restrained champagne accents, consistent outline icons, large media, clear headings and a stable navigation frame. The implementation uses real application data and destinations. The fictional accounts, sports events, analytics and financial figures in the references were not inserted into the product.

The desktop public application has a 248-pixel primary rail, a compact rail at intermediate widths, a sticky search/action header, and a responsive content/right-column layout. The professional workspace has its own full-width shell. On small screens, the header and existing bottom navigation are supplemented by a searchable all-destinations menu. The 320-pixel check verifies that the brand, controls and full-width post actions remain inside the viewport. Below 360 pixels the redundant header notification icon is removed; Notifications remains in the destinations menu.

Light, Dim and Lights out use the application's real persisted appearance controls. System appearance and reduced-motion preferences remain available. The composer and menus use theme tokens, visible focus treatment and named controls. Post media expands to the card width on small screens without shrinking the image into the space left by the author's avatar.

## Connected journeys

| Surface | Implemented entry/action | Exit and recovery |
| --- | --- | --- |
| Main navigation | Home, Discover, Watch, Messages, Channels, Communities, Jobs, Market, Notifications, profile and Studio | Active routes are derived from exact/prefix matching. Nested records have deterministic parent destinations. |
| More destinations | Saved, Archive, Ads, Monetization, Businesses, Settings and Help | Keyboard-contained popover; Escape, outside click and navigation close it and restore focus. |
| Global search | Named search field and Command/Ctrl+K; correctly encoded Discover destination | Unsaved profile/composer form guards run before unrelated search navigation. |
| Create menu | Post, Photo, Video, Poll, Story and Article open their real editor routes | On Home, the event opens the existing composer without remounting and losing its current draft. |
| Composer | Ordered media, edit/alt-text controls, review/edit, caption and audience settings, upload failure guidance | Cancel/collapse keeps the current work. Nested editor Escape is respected. File attachments are not falsely described as persisted across a reload. |
| Watch and Discover | Real video-filtered discovery queries, bounded loading, visible failure and retry | Actual navigation back to public application; empty data is distinct from a failed request. |
| Personal and creator profiles | Actual cover, avatar, identity, counts, bio, links, memory books and posts | Profile lookup failures are visible; private collection/draft/edit controls require the actual owner. |
| Business profile | Real product, review, contact, hours and safe website information | Existing business authorization and media hydration remain authoritative; no invented ticket or schedule destination. |
| Messages workspace | Actual inbox, conversation search and filters, named voice/video controls, new-recipient search/review, profile and loaded shared-media detail panel | Close/Back preserves per-conversation drafts; recipient search and opening failures retry without automatically sending a message; mobile chat uses a solid surface and makes the underlying navigation inert. |
| Communities and Channels | Responsive directories, search, membership actions, real detail routes, About/rules, members, invites, requests and broadcast settings | Native keyboard-contained dialogs preserve creation drafts through Cancel; settings photos remain local until Save and failed saves retain the same upload path for retry. |
| Visitor message action | Re-check current Auth identity, request the real direct conversation, navigate only after confirmation | Pending lock, bounded wait and clear retry; stale responses cannot open a conversation for a switched account. |
| Edit profile | Real owner-bound name, headline, bio, workplace, location, links, visibility, profile photo and cover | Validation before upload, preview before Save, confirmed-write feedback, retry with the same file paths, explicit draft restore/discard after browser Back. |
| Settings | Searchable actual account, privacy, security, professional, media, appearance and help destinations | Clear no-results exit; preference switches read back actual persisted values and react to cross-tab storage changes. |
| Connection notice | Offline state and an explicit bounded connection check | Reconnection does not reload the page or replay a mutation. The existing composer remains intact. |
| Account menu | Profile, settings, appearance and sign-out | Sign-out is deduplicated and time bounded. A failed response leaves the user on the current route with a visible error. |

## Profile editor correctness

The new `/settings/profile` editor is bound to the verified Auth user. It does not rely on a username, route parameter or editable client role as ownership. Initial authentication, profile loading, image validation, upload and save responses carry an account generation; old work cannot update a different account's form or report success after unmount. A failed initial account lookup can be retried in the same page.

Up to five links are accepted after normalization to HTTP(S). Credential-bearing addresses, executable schemes, control characters and overlong fields are rejected. Photo uploads require actual JPG, PNG or WebP bytes, a matching supported media type, a non-empty file and a maximum of 10 MB. Selecting a photo creates only a local preview. No Storage request is made until Save.

Save verifies the current Auth identity, uploads each selected file to a random owner-scoped path, verifies identity again and updates the exact owner row. Retrying the same selected file uses the same path. A database timeout or ambiguous response leaves the draft intact; no uncertain upload is deleted and no success is manufactured. Existing avatar-bucket public URL behavior is preserved. This does not claim that avatar storage is private or replace the separate protected-media rollout.

Leaving through an app link, unrelated search form or page unload protects unsaved changes. Browser Back/Forward can change a Next route without firing `beforeunload`, so the editor retains at most one verified owner's draft and selected files in tab memory for up to 30 minutes. Returning shows the saved profile with an explicit **Restore draft / Discard draft** choice. It does not automatically upload or overwrite anything. Changing the signed-in account clears the retained draft; files and draft contents are not stored in localStorage or a database. A full browser reload cannot restore this in-memory draft and remains guarded by the browser's unload prompt.

## Read and network behavior

Shared identity loading now has a deadline, a retryable error and an Auth-event generation fence. Home/discovery recommendation panels and account status expose failures rather than substituting false zero counts or empty successful results. Server counts are bounded and validated; presentation uses unknown/unavailable where the source did not establish a value.

The connection component uses the real navigator status and a bounded same-origin check. Returning online presents recovery controls while preserving in-progress editing. It does not queue or replay posts, payments, profile edits or other writes. This is browser recovery behavior; it does not establish push, call, background or physical-device networking acceptance.

## Verification and evidence

`web/tests/browser/social-run.cjs` compiles the actual production components with a synthetic Auth/database adapter and local generated media. The adapter contains no live credentials and is not imported by an application route. It exercises navigation, keyboard focus, composer review/cancel, appearance, profile saves, upload validation, explicit browser-Back recovery, account changes, conversation recovery, sign-out and offline state.

The current machine-readable receipt is [web-design-20261030/browser-receipt.json](web-design-20261030/browser-receipt.json). It records the exact timestamp, browser version, individually named checks and captured runtime errors. The final public-web suite has 38 named cases. It includes the actual Messages, Communities and Channels components, failed-initial-Auth recovery, profile editing and navigation. Consult the current receipt rather than adding successive runs together. The existing Messages regression suite separately passes 25 behavioral cases covering history, outbox ownership, late microphone permission, privacy and read receipts.

Visual evidence, all with synthetic records:

- [Desktop Home, light](web-design-20261030/home-light.png)
- [Desktop Home, dark](web-design-20261030/home-dark.png)
- [Dark composer](web-design-20261030/composer-dark.png)
- [Owner profile](web-design-20261030/profile-light.png)
- [Profile editor](web-design-20261030/profile-editor.png)
- [Settings](web-design-20261030/settings-light.png)
- [Mobile Home](web-design-20261030/mobile-home.png)
- [Mobile destinations](web-design-20261030/mobile-destinations.png)
- [320-pixel layout](web-design-20261030/mobile-320.png)
- [Desktop Messages](web-design-20261030/messages-desktop.png)
- [Mobile conversation](web-design-20261030/messages-mobile.png)
- [320-pixel attachments](web-design-20261030/messages-mobile-320.png)
- [Communities directory](web-design-20261030/communities-desktop.png)
- [Community detail](web-design-20261030/community-desktop.png)
- [Mobile community](web-design-20261030/community-mobile.png)
- [Channel detail](web-design-20261030/channel-desktop.png)

The browser verifies decoded image dimensions before judging media width; a screenshot captured before an image finishes decoding is not treated as a layout result. Existing publication, Home feed, profile lookup and username tests retain their original behavioral assertions. A contrast check caught a disabled theater-send button becoming too faint with the updated accent and its disabled opacity was corrected.

Reproduce the browser fixture with a local Chromium executable:

```sh
PLATINUM_CHROMIUM=/path/to/chrome node web/tests/browser/social-run.cjs
```

A screenshot review found that the old mobile conversation surface was translucent, allowing the top and bottom navigation to show through. The corrected layer uses the opaque theme surface, keeps the call controls beside the recipient and makes background navigation inert while the chat is open. Resize checks wait for the browser layout to settle before measuring overflow.

Strict ESLint review of the seven changed messaging/community/channel modules found no new error-category diagnostics against the baseline; the new ProductDialog and NewMessageDialog have zero errors. Existing legacy React Compiler/ref and typing diagnostics remain in the large conversation and community/channel files (44 errors across those five older modules, down from 57). This is not a claim of a clean whole-repository lint run. Avatar-image recommendations and the deliberate asynchronous generation-fence warning were reviewed separately.

The full application, database and browser verification inventory is in the integrated report. Local synthetic checks establish the tested component behavior, not real-provider or hosted-session acceptance.

## Remaining release boundaries

The requested real iPhone files, camera/HEIC/HDR, Photos export, gesture and interruption behavior, calls, push, two-device delivery, VoiceOver and Dynamic Type still require the installed candidate on physical devices. Production protected-media bucket conversion, warmed-cache/revoked-URL behavior and complete disposable-account Storage/CDN/Auth erasure remain separate gates. This design implementation does not change production access policies or remove the TestFlight hold.
