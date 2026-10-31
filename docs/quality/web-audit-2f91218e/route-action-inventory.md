# Web audit route and control inventory

Source: `2f91218e71dbcaf94ea7b454a0e3562800bfe601`. The existing action checklist has been reconciled; these are static bindings, not completed runtime checks.

- Actual Next page routes: 93
- Web JSX files: 265
- Interaction bindings: 2083
- Prior checklist: 1634 bindings

| Route | Direct bindings | Existing fixture directly imports page | Active audit status |
| --- | ---: | --- | --- |
| `/[username]/follows` | 8 | No direct page import | Pending |
| `/[username]` | 13 | social-fixture.tsx | Pending |
| `/about` | 1 | No direct page import | Pending |
| `/account-deletion` | 0 | No direct page import | Pending |
| `/ads/new` | 15 | No direct page import | Pending |
| `/ads` | 12 | No direct page import | Pending |
| `/album/[id]` | 0 | No direct page import | Pending |
| `/archive` | 10 | No direct page import | Pending |
| `/business-login` | 8 | No direct page import | Pending |
| `/businesses/apply` | 19 | No direct page import | Pending |
| `/businesses/new` | 5 | No direct page import | Pending |
| `/businesses` | 10 | No direct page import | Pending |
| `/calls` | 4 | No direct page import | Pending |
| `/channels/[id]` | 43 | social-fixture.tsx | Pending |
| `/channels` | 17 | social-fixture.tsx | Pending |
| `/communities/[id]` | 62 | social-fixture.tsx | Pending |
| `/communities/join/[token]` | 2 | No direct page import | Pending |
| `/communities` | 20 | social-fixture.tsx | Pending |
| `/discover` | 5 | No direct page import | Pending |
| `/explore` | 5 | No direct page import | Pending |
| `/forgot-password` | 4 | No direct page import | Pending |
| `/home` | 0 | No direct page import | Pending |
| `/jobs/[id]/applicants` | 16 | No direct page import | Pending |
| `/jobs/[id]` | 7 | commerce-fixture.tsx | Pending |
| `/jobs/applications` | 17 | commerce-fixture.tsx | Pending |
| `/jobs/messages` | 0 | No direct page import | Pending |
| `/jobs/new` | 16 | No direct page import | Pending |
| `/jobs` | 20 | commerce-fixture.tsx | Pending |
| `/jobs/saved` | 8 | commerce-fixture.tsx | Pending |
| `/login` | 8 | No direct page import | Pending |
| `/market/[id]` | 23 | commerce-fixture.tsx | Pending |
| `/market/messages` | 0 | No direct page import | Pending |
| `/market/new` | 17 | No direct page import | Pending |
| `/market/orders` | 2 | commerce-fixture.tsx | Pending |
| `/market` | 27 | commerce-fixture.tsx | Pending |
| `/market/saved` | 5 | commerce-fixture.tsx | Pending |
| `/messages` | 0 | No direct page import | Pending |
| `/messages/requests` | 4 | No direct page import | Pending |
| `/monetization` | 8 | No direct page import | Pending |
| `/music` | 1 | No direct page import | Pending |
| `/notifications` | 13 | No direct page import | Pending |
| `/` | 0 | No direct page import | Pending |
| `/post/[id]` | 2 | No direct page import | Pending |
| `/privacy` | 1 | No direct page import | Pending |
| `/reset-password` | 6 | No direct page import | Pending |
| `/saved` | 11 | No direct page import | Pending |
| `/search` | 18 | No direct page import | Pending |
| `/settings/account-type` | 1 | No direct page import | Pending |
| `/settings/activity` | 3 | No direct page import | Pending |
| `/settings/archive` | 2 | No direct page import | Pending |
| `/settings/audio` | 7 | No direct page import | Pending |
| `/settings/blocked` | 2 | No direct page import | Pending |
| `/settings/delete-account` | 0 | No direct page import | Pending |
| `/settings/download` | 1 | No direct page import | Pending |
| `/settings/follow-requests` | 4 | No direct page import | Pending |
| `/settings/help` | 1 | No direct page import | Pending |
| `/settings/hidden-words` | 3 | No direct page import | Pending |
| `/settings/login-activity` | 2 | No direct page import | Pending |
| `/settings/muted-words` | 3 | No direct page import | Pending |
| `/settings/muted` | 2 | No direct page import | Pending |
| `/settings/notifications` | 4 | No direct page import | Pending |
| `/settings` | 8 | social-fixture.tsx | Pending |
| `/settings/profile` | 25 | social-fixture.tsx | Pending |
| `/settings/restricted` | 3 | No direct page import | Pending |
| `/settings/standing` | 0 | No direct page import | Pending |
| `/settings/support/[id]` | 2 | No direct page import | Pending |
| `/settings/support` | 4 | No direct page import | Pending |
| `/settings/two-factor` | 7 | No direct page import | Pending |
| `/settings/username` | 2 | No direct page import | Pending |
| `/settings/verification` | 7 | No direct page import | Pending |
| `/signup` | 7 | No direct page import | Pending |
| `/story/[id]` | 0 | No direct page import | Pending |
| `/story/new` | 0 | No direct page import | Pending |
| `/studio/ads` | 53 | studio-fixture.tsx | Pending |
| `/studio/audience` | 18 | No direct page import | Pending |
| `/studio/commerce` | 25 | No direct page import | Pending |
| `/studio/content` | 6 | No direct page import | Pending |
| `/studio/earnings` | 11 | studio-fixture.tsx | Pending |
| `/studio/inbox` | 26 | No direct page import | Pending |
| `/studio/insights` | 12 | studio-fixture.tsx | Pending |
| `/studio/newsroom` | 40 | studio-fixture.tsx | Pending |
| `/studio` | 17 | studio-fixture.tsx | Pending |
| `/studio/partnerships` | 50 | studio-fixture.tsx | Pending |
| `/studio/planner` | 37 | studio-fixture.tsx | Pending |
| `/studio/recruiter` | 21 | No direct page import | Pending |
| `/studio/reviews` | 7 | No direct page import | Pending |
| `/studio/settings/organization` | 19 | No direct page import | Pending |
| `/studio/settings` | 22 | studio-fixture.tsx | Pending |
| `/studio/team` | 0 | studio-fixture.tsx | Pending |
| `/terms` | 1 | No direct page import | Pending |
| `/topic/[tag]` | 1 | No direct page import | Pending |
| `/watch` | 1 | No direct page import | Pending |
| `/write` | 19 | No direct page import | Pending |

Fixture routes that display “Destination reached” or “Fixture destination” are not accepted as execution of the actual destination. A page import also does not establish all its controls were exercised.
