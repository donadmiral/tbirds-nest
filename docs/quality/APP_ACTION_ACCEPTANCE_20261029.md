# App action acceptance inventory — 20261029

**This is the action-by-action execution checklist, not completed device acceptance.** The static scan includes native screens and components, web app/components, and admin app/components. Component callbacks can describe the same visible control more than once, and conditional/dynamically generated controls are not guaranteed to appear in a source scan.

For each applicable signed-out, member, author, applicant/employer, buyer/seller, moderator and staff role: record the exact source/build, enter the screen, trigger the control, verify the destination and data outcome, check Back/Cancel/Next, and repeat relevant rejected-write, denied-permission and offline/retry paths. Record Pass, Fail, Not applicable or Blocked with a reason. Screen registration and automated suites do not mark these rows passed.

An authenticated browser session, intentional test accounts/records, and a permitted development iPhone environment are required. TestFlight remains on hold. Provider-specific actions stay blocked until their real provider environment is available. Exact source positions and machine-readable control bindings are in the JSON companion.

| App | JSX files scanned | Files with bindings | Interaction bindings |
| --- | ---: | ---: | ---: |
| native | 235 | 193 | 2232 |
| web | 239 | 175 | 1634 |
| admin | 61 | 46 | 221 |

## Per-file controls

### admin-web/app/ads/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 173 | Content approval. Payment is verified separately through IntoBank. Approve | action | Pending |
| 178 | Reject | action | Pending |
| 200 | End | action | Pending |

### admin-web/app/analytics/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 348 | likes comments shares | href | Pending |

### admin-web/app/businesses/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 58 | a (dynamic/unlabelled) | href | Pending |
| 64 | Approve - create @ with space grey | action | Pending |
| 68 | Decline | action | Pending |
| 107 | Open | href | Pending |

### admin-web/app/dashboard/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 59 | Link (dynamic/unlabelled) | href | Pending |
| 227 | Link (dynamic/unlabelled) | href | Pending |
| 251 | Full analytics | href | Pending |
| 271 | Link (dynamic/unlabelled) | href | Pending |
| 289 | All members | href | Pending |
| 292 | @ | href | Pending |
| 311 | All posts | href | Pending |
| 318 | @ | href | Pending |
| 371 | Audit log | href | Pending |
| 410 | Link (dynamic/unlabelled) | href | Pending |
| 455 | applied for | href | Pending |
| 466 | Reported for | href | Pending |
| 481 | Manage in Controls | href | Pending |

### admin-web/app/error.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 6 | Retry | onClick | Pending |

### admin-web/app/global-error.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 9 | Try again | onClick | Pending |

### admin-web/app/market/orders/[id]/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 24 | All orders | href | Pending |
| 25 | Buyer | href | Pending |
| 25 | Seller | href | Pending |
| 25 | Listings desk | href | Pending |

### admin-web/app/market/orders/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 15 | Listings | href | Pending |
| 15 | Refresh orders | href | Pending |
| 19 | × | href | Pending |
| 20 | Link (dynamic/unlabelled) | href | Pending |
| 20 | Link (dynamic/unlabelled) | href | Pending |
| 23 | Newest orders | href | Pending |
| 23 | Older orders | href | Pending |

### admin-web/app/market/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 191 | Review reported seller ratings | href | Pending |
| 192 | Investigate orders, returns and disputes | href | Pending |

### admin-web/app/market/reviews/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 51 | Reports desk | href | Pending |
| 70 | Reports desk | href | Pending |
| 73 | Open reports | href | Pending |
| 76 | All reports / restore reviews | href | Pending |
| 123 | Reviewer | href | Pending |
| 131 | Seller | href | Pending |
| 136 | Reporter (staff only) | href | Pending |
| 151 | Decision reason | action | Pending |
| 208 | Older reports | href | Pending |

### admin-web/app/organizations/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 67 | Link (dynamic/unlabelled) | href | Pending |
| 103 | Profile | href | Pending |
| 105 | Restore | action | Pending |
| 107 | Archive | action | Pending |
| 109 | Set | action | Pending |

### admin-web/app/p/[id]/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 58 | Open in the app | href | Pending |

### admin-web/app/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 15 | Staff email Password | action | Pending |
| 26 | Forgot password? | href | Pending |

### admin-web/app/payments/creators/ReviewForm.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 8 | Decision Reason shown to creator | action | Pending |

### admin-web/app/payments/creators/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 16 | Back to operations | href | Pending |
| 23 | Back to payments | href | Pending |
| 26 | Link (dynamic/unlabelled) | href | Pending |
| 27 | Next 50 creators | href | Pending |
| 30 | Link (dynamic/unlabelled) | href | Pending |

### admin-web/app/payments/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 153 | Creator finance and reviews | href | Pending |
| 157 | Search | submit | Pending |
| 158 | Creator finance | href | Pending |
| 161 | Newest | href | Pending |
| 163 | Older transfers → | href | Pending |

### admin-web/app/reports/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 102 | Seller review reports | href | Pending |
| 113 | First page | href | Pending |
| 114 | Previous | href | Pending |
| 116 | Next | href | Pending |

### admin-web/app/reset-password/RecoveryForms.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 33 | Back to sign in | href | Pending |
| 34 | form (dynamic/unlabelled) | onSubmit | Pending |
| 39 | button (dynamic/unlabelled) | submit | Pending |

### admin-web/app/reset-password/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 9 | Request a new reset link | href | Pending |
| 12 | Back to sign in | href | Pending |

### admin-web/app/reset-password/request/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 8 | Back to sign in | href | Pending |

### admin-web/app/security/SecurityForm.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 8 | select (dynamic/unlabelled) | onChange | Pending |
| 8 | Set up authenticator | onClick | Pending |
| 10 | Authenticator code Verify and continue | onSubmit | Pending |
| 10 | input (dynamic/unlabelled) | onChange | Pending |

### admin-web/app/security/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 18 | Continue to operations | href | Pending |
| 18 | Sign out | action | Pending |

### admin-web/app/staff/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 144 | Invite | action | Pending |
| 150 | Invite | submit | Pending |

### admin-web/app/support/[tid]/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 48 | &larr; All tickets | href | Pending |
| 55 | Link (dynamic/unlabelled) | href | Pending |
| 69 | Owner Unassigned Priority Queue Escalation Standard Escalated Reason Save assignment | action | Pending |
| 85 | Latest | href | Pending |
| 86 | Newer | href | Pending |
| 87 | Older | href | Pending |
| 104 | Send reply | action | Pending |
| 112 | CommandForm (dynamic/unlabelled) | action | Pending |

### admin-web/app/support/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 160 | Search subjects Status Open Pending Solved Appeals All tickets Apply | action | Pending |
| 165 | Apply | submit | Pending |
| 168 | First page | href | Pending |
| 169 | Previous | href | Pending |
| 171 | Next | href | Pending |

### admin-web/app/system/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 41 | CommandForm (dynamic/unlabelled) | action | Pending |
| 53 | Publish to the platform | action | Pending |
| 69 | Retire | action | Pending |
| 81 | Block | action | Pending |
| 88 | &times; | action | Pending |

### admin-web/app/users/[uid]/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 64 | Lift early | action | Pending |
| 71 | Warn - recorded strike only Restrict - no posting or listing Suspend - account hidden Ban - permanent intent Issue | action | Pending |
| 85 | Restore account | action | Pending |
| 91 | Revoke badge | action | Pending |
| 135 | Remove | action | Pending |
| 157 | Remove | action | Pending |
| 251 | Link (dynamic/unlabelled) | href | Pending |

### admin-web/app/users/deletions/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 21 | Back to users | href | Pending |
| 22 | Check availability again | href | Pending |
| 30 | Back to users | href | Pending |
| 33 | Link (dynamic/unlabelled) | href | Pending |
| 41 | Previous | href | Pending |
| 42 | Next | href | Pending |

### admin-web/app/users/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 47 | Deletion requests | href | Pending |
| 65 | Previous | href | Pending |
| 66 | Next | href | Pending |

### admin-web/components/CommandForm.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 13 | form (dynamic/unlabelled) | onSubmit | Pending |

### admin-web/components/CommandPalette.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 136 | Search desks, members, actions | onClick | Pending |
| 149 | Esc | onClick | Pending |
| 151 | Esc | onClick | Pending |
| 159 | Jump to a desk, find a member, run an action | onChange, onKeyDown | Pending |
| 168 | button (dynamic/unlabelled) | onClick | Pending |

### admin-web/components/Desk.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 127 | button (dynamic/unlabelled) | onClick | Pending |
| 180 | Link (dynamic/unlabelled) | href | Pending |
| 245 | button (dynamic/unlabelled) | onClick | Pending |
| 257 | input (dynamic/unlabelled) | onChange | Pending |
| 261 | : All | onChange | Pending |
| 275 | ↗ | onClick | Pending |
| 280 | ↗ | onClick | Pending |
| 299 | div (dynamic/unlabelled) | onClick, onKeyDown | Pending |
| 325 | Back | onClick | Pending |
| 328 | Next | onClick | Pending |
| 394 | CommandForm (dynamic/unlabelled) | action | Pending |
| 405 | button (dynamic/unlabelled) | submit | Pending |
| 414 | Link (dynamic/unlabelled) | href | Pending |
| 484 | Share or export this table | onClick | Pending |
| 497 | div (dynamic/unlabelled) | onClick | Pending |
| 502 | Export these rows (CSV) | onClick | Pending |
| 503 | Export all rows (CSV) | onClick | Pending |
| 504 | Export these rows (JSON) | onClick | Pending |
| 506 | Add this table to the presentation | onClick | Pending |

### admin-web/components/MediaPreview.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 65 | Reload media preview | onClick | Pending |
| 85 | video (dynamic/unlabelled) | onPlay, onPause | Pending |
| 115 | / | onClick | Pending |
| 116 | button (dynamic/unlabelled) | onClick | Pending |
| 120 | Video preview position | onChange | Pending |
| 123 | button (dynamic/unlabelled) | onClick | Pending |

### admin-web/components/PlatformActivityChart.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 45 | D | onClick | Pending |

### admin-web/components/PresentBuilder.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 113 | Back to the dashboard | href | Pending |
| 123 | Presentation builder | href | Pending |
| 129 | Export data | onClick | Pending |
| 130 | Export JSON | onClick | Pending |
| 131 | Download PDF | onClick | Pending |
| 132 | Present | onClick | Pending |
| 140 | button (dynamic/unlabelled) | onClick | Pending |
| 156 | div (dynamic/unlabelled) | onClick | Pending |
| 162 | section (dynamic/unlabelled) | onClick | Pending |
| 177 | input (dynamic/unlabelled) | onChange | Pending |
| 178 | 1 to 31 August 2026 | onChange | Pending |
| 182 | button (dynamic/unlabelled) | onClick | Pending |
| 196 | button (dynamic/unlabelled) | onClick | Pending |
| 205 | What should the reader do with this? | onChange | Pending |
| 211 | input (dynamic/unlabelled) | onChange | Pending |
| 216 | Remove | onClick | Pending |
| 220 | Clear everything | onClick | Pending |

### admin-web/components/PresentTray.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 45 | Open builder | onClick | Pending |
| 49 | Clear the tray | onClick | Pending |

### admin-web/components/ReportsDesk.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 33 | button (dynamic/unlabelled) | onClick | Pending |
| 42 | button (dynamic/unlabelled) | onClick | Pending |
| 68 | Remove post | action | Pending |
| 74 | Remove listing | action | Pending |
| 80 | No violation | action | Pending |
| 87 | Mark actioned | action | Pending |
| 91 | No violation | action | Pending |
| 98 | Open author | href | Pending |

### admin-web/components/ReviewMediaGallery.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 14 | Previous attachment | onClick | Pending |
| 16 | Next attachment | onClick | Pending |
| 19 | button (dynamic/unlabelled) | onClick | Pending |

### admin-web/components/ShareMenu.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 80 | Share, export or present this view | onClick | Pending |
| 105 | Copy link to this view | onClick | Pending |
| 110 | Snapshot this view as PDF | onClick | Pending |
| 115 | Add a note to the presentation | onClick | Pending |
| 122 | textarea (dynamic/unlabelled) | onChange | Pending |
| 125 | Add to presentation | onClick | Pending |
| 134 | Open presentation builder | onClick | Pending |

### admin-web/components/Shell.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 104 | Operations | href | Pending |
| 122 | Work waiting | href | Pending |
| 133 | Exit | action | Pending |

### admin-web/components/SideRail.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 187 | Link (dynamic/unlabelled) | onClick, href | Pending |
| 257 | Close navigation | onClick | Pending |
| 259 | aside (dynamic/unlabelled) | onKeyDown | Pending |
| 289 | button (dynamic/unlabelled) | onClick | Pending |
| 299 | nav (dynamic/unlabelled) | onScroll | Pending |
| 325 | button (dynamic/unlabelled) | onClick | Pending |
| 365 | Expand rail | onClick | Pending |
| 373 | Account security | onClick, href | Pending |
| 382 | Open Open in new tab Copy link | onClick | Pending |
| 388 | Open | onClick | Pending |
| 389 | Open in new tab | onClick | Pending |
| 390 | button (dynamic/unlabelled) | onClick | Pending |
| 391 | Copy link | onClick | Pending |

### admin-web/components/SignInButton.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 5 | button (dynamic/unlabelled) | submit | Pending |

### admin-web/components/ThemeControls.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 47 | Light appearance | onClick | Pending |
| 53 | Dark appearance | onClick | Pending |
| 58 | Use device appearance | onClick | Pending |

### admin-web/components/UsersDesk.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 52 | button (dynamic/unlabelled) | onClick | Pending |
| 74 | @ | onClick | Pending |
| 107 | @ | href | Pending |
| 127 | Restore account | action | Pending |
| 132 | Issue strike | onClick | Pending |
| 135 | Revoke badge | action | Pending |
| 143 | Warn Restrict posting Suspend Ban Confirm strike | action | Pending |
| 162 | Disable and request deletion | action | Pending |
| 169 | Suspend account | action | Pending |

### admin-web/components/VerificationDesk.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 45 | button (dynamic/unlabelled) | onClick | Pending |
| 54 | button (dynamic/unlabelled) | onClick | Pending |
| 88 | a (dynamic/unlabelled) | href | Pending |
| 113 | Review basis I checked identity, authority and impersonation risk against independent evidence. Approve \u2014 | action | Pending |
| 121 | Reject | action | Pending |

### admin-web/components/Viz.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 76 | button (dynamic/unlabelled) | onClick | Pending |
| 86 | D | onClick | Pending |

### src/components/AccountSwitcherSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 33 | Accounts | onRequestClose | Pending |
| 35 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 42 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 54 | Add account | onPress | Pending |
| 60 | Log out of | onPress | Pending |
| 61 | Log out | onPress | Pending |

### src/components/ActorSwitcher.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 48 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 62 | Post as This changes who authors the post. Your feed stays yours either way. | onRequestClose | Pending |
| 63 | Post as This changes who authors the post. Your feed stays yours either way. | onPress | Pending |
| 64 | Post as This changes who authors the post. Your feed stays yours either way. | onPress | Pending |
| 74 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/AddAccountSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 43 | Add account The account you're using stays signed in. Cancel | onRequestClose | Pending |
| 46 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 51 | Email or username | onChangeText | Pending |
| 52 | Password | onChangeText | Pending |
| 54 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 57 | Cancel | onPress | Pending |

### src/components/AnnouncementBanner.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 31 | × | onPress | Pending |

### src/components/AppLockGate.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 52 | Unlock with Face ID | onPress | Pending |

### src/components/AppleMusicSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 37 | Song, artist or Apple Music song link | onChangeText | Pending |
| 40 | Two-letter Apple Music catalog country | onChangeText | Pending |
| 41 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 44 | Share this song link | onPress | Pending |
| 49 | Open in Apple Music | onPress | Pending |
| 50 | Share | onPress | Pending |
| 52 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 59 | Apple Music Close | onRequestClose | Pending |
| 62 | Close | onPress | Pending |
| 63 | AppleMusicPicker (dynamic/unlabelled) | onSelect | Pending |

### src/components/ArticleBody.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 52 | Text (dynamic/unlabelled) | onPress | Pending |
| 58 | Text (dynamic/unlabelled) | onPress | Pending |
| 68 | Text (dynamic/unlabelled) | onPress | Pending |

### src/components/BusinessTabs.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 67 | Try again | onPress | Pending |
| 83 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 113 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 160 | Stars (dynamic/unlabelled) | onPick | Pending |
| 161 | What was it like? (optional) | onChangeText | Pending |
| 166 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 235 | Try again | onPress | Pending |
| 242 | Show sold items | onPress | Pending |
| 262 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/ChannelSettingsSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 156 | Make collaborator | onPress | Pending |
| 157 | Make moderator | onPress | Pending |
| 158 | Make member | onPress | Pending |
| 159 | Remove from channel | onPress | Pending |
| 177 | Channel settings | onRequestClose | Pending |
| 183 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 185 | StudioLoadError (dynamic/unlabelled) | onRetry | Pending |
| 192 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 203 | Channel name | onChangeText | Pending |
| 205 | What is it about? | onChangeText | Pending |
| 209 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 219 | Switch (dynamic/unlabelled) | onValueChange | Pending |
| 221 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 231 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 242 | Search people | onChangeText | Pending |
| 251 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 262 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/ChatImageEditor.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 213 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 217 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 221 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 242 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 249 | Rotate | onPress | Pending |
| 253 | Mirror | onPress | Pending |
| 257 | Reset | onPress | Pending |
| 284 | Text (dynamic/unlabelled) | onLongPress | Pending |
| 298 | Add a caption | onChangeText | Pending |
| 309 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 314 | Draw | onPress | Pending |
| 318 | Text | onPress | Pending |
| 322 | Undo | onPress | Pending |
| 329 | Cancel Add | onRequestClose | Pending |
| 332 | Say something | onChangeText | Pending |
| 342 | Cancel | onPress | Pending |
| 343 | Add | onPress | Pending |

### src/components/ChatInfoSections.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 138 | Switch (dynamic/unlabelled) | onValueChange | Pending |
| 156 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 175 | members | onPress | Pending |
| 207 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/CollaboratorsSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 20 | Collaborators | onRequestClose | Pending |
| 22 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 28 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/CreatorCommercePanel.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 40 | Refresh | onPress | Pending |
| 46 | Program revenue shares | onPress | Pending |
| 50 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 51 | Product name | onChangeText | Pending |
| 52 | Price in USD | onChangeText | Pending |
| 53 | Access period in days | onChangeText | Pending |
| 54 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 56 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/CreatorPayoutForm.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 37 | Payout amount in USD | onChangeText | Pending |
| 39 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 40 | Edit amount | onPress | Pending |

### src/components/ErrorBoundary.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 39 | Try loading this screen again | onPress | Pending |

### src/components/FullscreenVideo.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 160 | Close video | onPress | Pending |
| 165 | Back 10 seconds | onPress | Pending |
| 166 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 169 | Forward 10 seconds | onPress | Pending |
| 177 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/GifPickerLite.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 39 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 40 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 45 | Search GIPHY | onChangeText | Pending |
| 47 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 57 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/InAppBrowser.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 37 | Modal (dynamic/unlabelled) | onRequestClose, onDismiss | Pending |
| 46 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 62 | Open in browser | onPress | Pending |
| 82 | Open in browser | onPress | Pending |

### src/components/IncomingCallListener.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 366 | Incoming call | onPress | Pending |
| 383 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 398 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/LinkAttachSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 65 | Cancel Add a link Attach | onRequestClose | Pending |
| 67 | Cancel Add a link Attach | onPress | Pending |
| 71 | Cancel | onPress | Pending |
| 73 | Attach | onPress | Pending |
| 78 | Paste a YouTube, TikTok or website link | onChangeText | Pending |
| 91 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 110 | Attach as plain link | onPress | Pending |
| 115 | Remove attached link | onPress | Pending |

### src/components/LinkIntoBankSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 54 | I Link IntoBank In IntoBank, open Profile, Connected apps, then Platinum Circles. Review the wallet access and payment permissions. Generate a connection code and paste it here. Ca | onRequestClose | Pending |
| 66 | IntoBank approval code | onChangeText | Pending |
| 77 | Connect approved IntoBank account | onPress | Pending |
| 80 | Cancel | onPress | Pending |

### src/components/MediaRenderer.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 156 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 166 | In this video | onRequestClose | Pending |
| 167 | In this video | onPress | Pending |
| 172 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 197 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 247 | ✕ | onRequestClose | Pending |
| 250 | ✕ | onPress | Pending |
| 675 | ZoomModal (dynamic/unlabelled) | onClose | Pending |
| 697 | ZoomModal (dynamic/unlabelled) | onClose | Pending |

### src/components/MemoryAlbumCard.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 65 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 68 | View all memory books | onPress | Pending |
| 69 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 74 | Create memory book | onPress | Pending |
| 75 | Memory books | onRequestClose, onDismiss | Pending |
| 75 | Back to profile | onPress | Pending |
| 75 | New memory book | onPress | Pending |
| 76 | Search memory books | onChangeText | Pending |
| 77 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 80 | MemoryBookDesigner (dynamic/unlabelled) | onClose, onDismiss | Pending |

### src/components/MfaGate.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 51 | 000000 | onChangeText | Pending |
| 53 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 54 | Sign out | onPress | Pending |

### src/components/MiniCallBar.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 94 | Tap to expand | onPress | Pending |
| 106 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/NewPostsPill.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 12 | Load new posts | onPress | Pending |

### src/components/PeoplePickerSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 37 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 40 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 46 | Type a name or @username | onChangeText | Pending |
| 50 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/PollCard.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 44 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 55 | · | onPress | Pending |
| 56 | PollVotersSheet (dynamic/unlabelled) | onClose | Pending |

### src/components/PollVotersSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 15 | Votes | onRequestClose | Pending |
| 16 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/PostCarousel.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 216 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 234 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 250 | 10 | onPress | Pending |
| 255 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 259 | 10 | onPress | Pending |
| 266 | Play fullscreen | onPress | Pending |
| 352 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 373 | Sensitive content This photo or video may be sensitive. Tap to view. | onPress | Pending |
| 407 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 467 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/PostDraftPreview.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 49 | / | onPress | Pending |

### src/components/PostInsightsSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 100 | Insights | onRequestClose | Pending |
| 101 | Insights | onPress | Pending |
| 102 | Insights | onPress | Pending |
| 110 | Close insights | onPress | Pending |
| 129 | Try again | onPress | Pending |
| 180 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/PostMediaEditSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 269 | Cancel | onRequestClose | Pending |
| 272 | Cancel media editing | onPress | Pending |
| 274 | Apply media edits | onPress | Pending |
| 278 | MediaCanvas (dynamic/unlabelled) | onRetry | Pending |
| 292 | Tap where the person is | onPress | Pending |
| 319 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 327 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 328 | Straighten | onChange | Pending |
| 329 | Rotate 90 degrees | onPress | Pending |
| 329 | Flip horizontally | onPress | Pending |
| 329 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 330 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 334 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 335 | Strength | onChange | Pending |
| 338 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 339 | EditorSlider (dynamic/unlabelled) | onChange | Pending |
| 340 | Reset adjustments | onPress | Pending |
| 343 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 344 | TrimStrip (dynamic/unlabelled) | onChange | Pending |
| 346 | Original audio | onPress | Pending |
| 347 | Speed × | onPress | Pending |
| 348 | × | onPress | Pending |
| 350 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 350 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 353 | CoverStrip (dynamic/unlabelled) | onChange | Pending |
| 354 | Video frame | onPress | Pending |
| 354 | Upload cover | onPress | Pending |
| 355 | Adjust crop | onPress | Pending |
| 358 | Add a caption to your video | onChangeText | Pending |
| 358 | Aa | onPress | Pending |
| 358 | Caption start in seconds | onChangeText, onBlur | Pending |
| 358 | Caption end in seconds | onChangeText, onBlur | Pending |
| 358 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 359 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 359 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 360 | Add another caption | onPress | Pending |
| 362 | Apply this look to all media | onPress | Pending |
| 363 | Reset | onPress | Pending |
| 366 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 367 | Cancel | onRequestClose | Pending |
| 369 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 374 | Who is this? | onChangeText | Pending |
| 375 | Cancel | onPress | Pending |
| 380 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 402 | MiniSlider (dynamic/unlabelled) | onChange | Pending |

### src/components/PostMediaViewer.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 23 | Post | onRequestClose | Pending |
| 28 | Close post media | onPress | Pending |

### src/components/PostSoundtrack.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 10 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 10 | Retry music | onPress | Pending |

### src/components/ProductCarousel.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 81 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 123 | InAppBrowser (dynamic/unlabelled) | onClose | Pending |

### src/components/ProductPickerSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 170 | Add products of selected. They show as a product card under the post. Done From your Market listings Add a product by link, from your shop or any site Import from your shop feed | onRequestClose | Pending |
| 171 | Add products of selected. They show as a product card under the post. Done From your Market listings Add a product by link, from your shop or any site Import from your shop feed | onPress | Pending |
| 172 | Add products of selected. They show as a product card under the post. Done From your Market listings Add a product by link, from your shop or any site Import from your shop feed | onPress | Pending |
| 181 | Done | onPress | Pending |
| 195 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 211 | Try again | onPress | Pending |
| 222 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 252 | Add a product by link, from your shop or any site | onPress | Pending |
| 259 | Product name | onChangeText | Pending |
| 264 | yourshop.co.zw/product | onChangeText | Pending |
| 269 | Price (optional) | onChangeText | Pending |
| 274 | Add product | onPress | Pending |
| 284 | Import from your shop feed | onPress | Pending |
| 291 | shop.intobank.app | onChangeText | Pending |
| 297 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 308 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/ProfileHeader.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 77 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 169 | Settings | onPress | Pending |
| 184 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 198 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 205 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 220 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 221 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 228 | Edit profile | onPress | Pending |
| 232 | Share profile | onPress | Pending |
| 250 | Add a bio | onPress | Pending |
| 277 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 304 | Followers | onPress | Pending |
| 309 | Following | onPress | Pending |
| 325 | Reached · 28 days | onPress | Pending |
| 338 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/ProfileRestore.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 30 | Retry now | onPress | Pending |
| 33 | Sign out | onPress | Pending |

### src/components/RemoteCallMedia.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 42 | 's screen | onPress | Pending |
| 50 | View cameras | onPress | Pending |
| 77 | Previous participants | onPress | Pending |
| 83 | Next participants | onPress | Pending |

### src/components/SendMoneySheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 241 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 243 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 253 | Close | onPress | Pending |
| 260 | IntoBank approval code | onChangeText | Pending |
| 271 | Connect approved IntoBank account | onPress | Pending |
| 293 | Decrease amount by one dollar | onPress | Pending |
| 301 | Increase amount by one dollar | onPress | Pending |
| 308 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 317 | Request | onPress | Pending |
| 326 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/SettingsExit.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 9 | Exit settings to your profile | onPress | Pending |

### src/components/SoundtrackPicker.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 41 | MiniSlider (dynamic/unlabelled) | onChange | Pending |
| 47 | Music Music unavailable Back to editing | onRequestClose | Pending |
| 47 | Close music | onPress | Pending |
| 47 | Remove selected music | onPress | Pending |
| 47 | Back to editing | onPress | Pending |
| 48 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 49 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 49 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 51 | Search music | onChangeText | Pending |
| 51 | Clear music search | onPress | Pending |
| 51 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 54 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 56 | · | onPress | Pending |
| 56 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 56 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 59 | Replace | onPress | Pending |
| 63 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 64 | Remove music | onPress | Pending |
| 66 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 67 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 68 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 70 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 70 | Use track | onPress | Pending |

### src/components/StudioLoadError.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 10 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/TrendingList.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 54 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 61 | · Trending in Zimbabwe # ··· | onPress | Pending |
| 77 | ··· | onPress | Pending |

### src/components/TrendingStoriesRail.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 66 | 🔥 views | onPress | Pending |

### src/components/TrendingTopicsStrip.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 194 | people | onPress | Pending |

### src/components/VideoFeedModal.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 138 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 142 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 145 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 148 | Share | onPress | Pending |
| 151 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 154 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 157 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 161 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 170 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 173 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 178 | Follow | onPress | Pending |
| 190 | x | onPress | Pending |
| 196 | Playback Quality Auto Captions This post Not interested Copy link Why you are seeing this Report | onRequestClose | Pending |
| 197 | Playback Quality Auto Captions This post Not interested Copy link Why you are seeing this Report | onPress | Pending |
| 202 | x | onPress | Pending |
| 207 | Not interested | onPress | Pending |
| 208 | Copy link | onPress | Pending |
| 210 | Report | onPress | Pending |
| 250 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 253 | CommentsSheet (dynamic/unlabelled) | onClose | Pending |

### src/components/VoiceNote.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 88 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 120 | x | onPress | Pending |

### src/components/feed/CommentsPanel.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 90 | Text (dynamic/unlabelled) | onPress | Pending |
| 91 | Text (dynamic/unlabelled) | onPress | Pending |
| 374 | Restrict | onPress | Pending |
| 395 | Reply | onLongPress | Pending |
| 397 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 416 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 420 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 424 | Reply | onPress | Pending |
| 437 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 439 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 444 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 449 | Delete | onPress | Pending |
| 453 | Delete | onPress | Pending |
| 463 | View | onPress | Pending |
| 470 | Hide replies | onPress | Pending |
| 489 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 507 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 516 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 529 | Add a GIF | onPress | Pending |
| 532 | TextInput (dynamic/unlabelled) | onChangeText, onFocus, onBlur | Pending |
| 546 | Post comment | onPress | Pending |
| 561 | Try again | onPress | Pending |
| 567 | may be spam | onPress | Pending |
| 578 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 594 | GifPickerLite (dynamic/unlabelled) | onClose, onSelect | Pending |

### src/components/feed/CommentsSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 270 | Close comments | onPress | Pending |
| 280 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 284 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 287 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 290 | Share | onPress | Pending |
| 297 | Close comments | onPress | Pending |
| 309 | Close comments | onPress | Pending |
| 329 | Modal (dynamic/unlabelled) | onRequestClose | Pending |

### src/components/feed/DiscoverTile.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 44 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 62 | Article | onPress | Pending |
| 75 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 89 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/feed/DiscoverViewer.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 70 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 71 | Retry music | onPress | Pending |
| 72 | Play video | onPress | Pending |
| 73 | Try again | onPress | Pending |
| 87 | Show sensitive content | onPress | Pending |
| 87 | DiscoverVideo (dynamic/unlabelled) | onRetry | Pending |
| 91 | Could not load image. Try again. | onPress | Pending |
| 92 | Previous photo | onPress | Pending |
| 92 | Next photo | onPress | Pending |
| 108 | Discover | onRequestClose | Pending |
| 110 | Close Discover | onPress | Pending |
| 110 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 111 | FlatList (dynamic/unlabelled) | onEndReached | Pending |
| 111 | DiscoverCell (dynamic/unlabelled) | onRetry | Pending |
| 112 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 112 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 112 | Open comments | onPress | Pending |
| 112 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 112 | Share post | onPress | Pending |
| 113 | Retry more posts | onPress | Pending |
| 114 | CommentsSheet (dynamic/unlabelled) | onClose | Pending |

### src/components/feed/SharedPostCard.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 47 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 63 | Open post | onPress | Pending |
| 72 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/jobs/JobListRow.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 22 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/market/MarketFilterSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 34 | Clear all Filters Apply Price to Condition Location Sort by | onRequestClose | Pending |
| 35 | Clear all Filters Apply Price to Condition Location Sort by | onPress | Pending |
| 36 | Clear all Filters Apply Price to Condition Location Sort by | onPress | Pending |
| 41 | Clear all | onPress | Pending |
| 43 | Apply | onPress | Pending |
| 49 | Minimum price | onChangeText | Pending |
| 51 | Maximum price | onChangeText | Pending |
| 57 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 64 | Location | onChangeText | Pending |
| 68 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/market/MarketOrderPanel.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 61 | Confirm | onPress | Pending |
| 64 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 69 | Order quantity | onChangeText | Pending |
| 72 | Order instructions | onChangeText | Pending |
| 95 | SendMoneySheet (dynamic/unlabelled) | onClose | Pending |
| 96 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 97 | Order action details | onChangeText | Pending |

### src/components/market/MarketplaceShelf.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 19 | Explore the marketplace | onPress | Pending |
| 25 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/market/ReportListingSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 87 | Report Your identity is hidden from the reported person. Staff can review your report. | onRequestClose | Pending |
| 115 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 132 | Report details, optional | onChangeText | Pending |
| 150 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 164 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/market/SellerReviews.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 42 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 234 | Retry | onPress | Pending |
| 272 | Write or edit a review | onPress | Pending |
| 290 | · · | onPress | Pending |
| 321 | Stars (dynamic/unlabelled) | onPick | Pending |
| 326 | Your review | onChangeText | Pending |
| 339 | Cancel | onPress | Pending |
| 346 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 390 | Report review | onPress | Pending |
| 401 | Load older reviews | onPress | Pending |
| 410 | ReportListingSheet (dynamic/unlabelled) | onClose | Pending |

### src/components/market/SellerTrust.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 47 | Seller history could not load. Tap to retry. | onPress | Pending |

### src/components/memory/MemoryAudienceEditor.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 10 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 10 | Search people | onChangeText | Pending |
| 10 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 10 | + | onPress | Pending |
| 10 | × | onPress | Pending |

### src/components/memory/MemoryBookDesigner.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 29 | Modal (dynamic/unlabelled) | onDismiss, onRequestClose | Pending |
| 30 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 30 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 32 | Retry stories | onPress | Pending |
| 34 | Book title | onChangeText | Pending |
| 35 | Book subtitle | onChangeText | Pending |
| 37 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 38 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 41 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 44 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 46 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/memory/MemoryPageImage.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 13 | Retry memory image | onPress | Pending |

### src/components/memory/MemoryPageTurn.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 56 | Previous memory | onPress | Pending |
| 57 | Next memory | onPress | Pending |

### src/components/messages/MediaViewer.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 108 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 154 | Pressable (dynamic/unlabelled) | onPress | Pending |
| 169 | Pressable (dynamic/unlabelled) | onPress | Pending |
| 179 | Pressable (dynamic/unlabelled) | onPress | Pending |

### src/components/messages/PrivateMediaViewer.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 72 | Pressable (dynamic/unlabelled) | onPress | Pending |
| 248 | Close | onRequestClose | Pending |
| 278 | Close private view | onPress | Pending |
| 310 | Optional camera guard | onValueChange | Pending |
| 328 | Pressable (dynamic/unlabelled) | onPress | Pending |
| 431 | Return to chat | onPress | Pending |

### src/components/messages/ShareDetailsSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 21 | Cancel | onRequestClose | Pending |
| 23 | Contact name | onChangeText | Pending |
| 23 | Contact phone | onChangeText | Pending |
| 23 | Contact email | onChangeText | Pending |
| 26 | Use my current location | onPress | Pending |
| 28 | Cancel | onPress | Pending |
| 28 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/stories/AddYoursStickerCard.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 13 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 15 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 21 | · See all | onPress | Pending |
| 22 | joined · See all | onPress | Pending |

### src/components/stories/AddYoursThreadSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 37 | ADD YOURS | onRequestClose | Pending |
| 39 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 44 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 49 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/stories/BloomSystem.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 92 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 119 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/stories/CategoryPicker.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 22 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 34 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/stories/ComposerToolbar.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 65 | Aa | onPress | Pending |
| 77 | 😀 | onPress | Pending |
| 89 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 101 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 113 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 125 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 137 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 149 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 161 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 174 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/stories/ComposerTopBar.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 41 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 64 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 74 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 84 | Aa | onPress | Pending |

### src/components/stories/CountdownStickerCard.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 77 | Remind me | onPress | Pending |
| 84 | Add to your story | onPress | Pending |

### src/components/stories/DrawLayer.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 186 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 189 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 192 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 196 | Done | onPress | Pending |
| 204 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 211 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 216 | MiniSlider (dynamic/unlabelled) | onChange | Pending |

### src/components/stories/DualArrangementOverlay.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 263 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 286 | Swap | onPress | Pending |
| 295 | Done | onPress | Pending |

### src/components/stories/HighlightRow.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 49 | New | onPress | Pending |
| 59 | TouchableOpacity (dynamic/unlabelled) | onPress, onLongPress | Pending |

### src/components/stories/IdentityPresence.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 25 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 26 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 27 | Close story | onPress | Pending |
| 30 | Story views | onPress | Pending |
| 32 | Story activity | onPress | Pending |
| 33 | Save story to memory book | onPress | Pending |
| 34 | Story options | onPress | Pending |

### src/components/stories/ImmersiveReplyField.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 57 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 60 | Say something... | onChangeText | Pending |
| 72 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 93 | Say something... | onPress | Pending |
| 97 | TouchableOpacity (dynamic/unlabelled) | onPress, onLongPress | Pending |
| 107 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/stories/ManageMentionsSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 97 | Remove | onPress | Pending |
| 107 | Mentions People you mentioned in this story. Done | onRequestClose | Pending |
| 108 | Mentions People you mentioned in this story. Done | onPress | Pending |
| 140 | Switch (dynamic/unlabelled) | onValueChange | Pending |
| 147 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 154 | Done | onPress | Pending |

### src/components/stories/MediaCanvas.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 513 | Retry | onPress | Pending |
| 521 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/stories/MusicSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 185 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 187 | Close sound picker | onPress | Pending |
| 189 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 190 | AppleMusicPicker (dynamic/unlabelled) | onSelect | Pending |
| 191 | Remove | onPress | Pending |
| 192 | Share a song link | onPress | Pending |
| 193 | Search story sounds | onChangeText | Pending |
| 194 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 197 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 200 | I own this recording and have permission from everyone featured to publish it. | onPress | Pending |
| 201 | Also make this original sound public and allow others to reuse it in Platinum stories. | onPress | Pending |
| 202 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 202 | Use voiceover | onPress | Pending |
| 205 | Retry | onPress | Pending |
| 205 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 205 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 205 | Use | onPress | Pending |
| 207 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/stories/PollCard.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 71 | TouchableOpacity (dynamic/unlabelled) | onLongPress, onPress | Pending |
| 140 | OptionRow (dynamic/unlabelled) | onPress | Pending |
| 158 | Share results | onLongPress, onPress | Pending |

### src/components/stories/PostStoryCard.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 44 | Pressable (dynamic/unlabelled) | onPress | Pending |
| 50 | Open shared post | onPress | Pending |
| 52 | Pressable (dynamic/unlabelled) | onPress | Pending |
| 55 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 59 | View post | onPress | Pending |
| 64 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/stories/QuestionStickerCard.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 28 | TouchableOpacity (dynamic/unlabelled) | onLongPress, onPress | Pending |
| 36 | TouchableOpacity (dynamic/unlabelled) | onLongPress, onPress | Pending |

### src/components/stories/QuizStickerCard.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 43 | TouchableOpacity (dynamic/unlabelled) | onLongPress, onPress | Pending |
| 95 | Row (dynamic/unlabelled) | onPress | Pending |

### src/components/stories/SaveToHighlightSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 143 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 185 | Highlight name... | onChangeText | Pending |
| 199 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 211 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 220 | New Highlight | onPress | Pending |
| 243 | Save to Highlight | onRequestClose | Pending |
| 254 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 260 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/stories/SaveToMemorySheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 22 | Add to a memory book Done | onRequestClose | Pending |
| 22 | Close book picker | onPress | Pending |
| 24 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 25 | Retry | onPress | Pending |
| 26 | + New book | onPress | Pending |
| 26 | Book title | onChangeText | Pending |
| 26 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 26 | Create and add | onPress | Pending |
| 27 | Done | onPress | Pending |

### src/components/stories/SliderStickerCard.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 107 | Text (dynamic/unlabelled) | onPress | Pending |

### src/components/stories/StickerOverlay.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 86 | Text (dynamic/unlabelled) | onLongPress, onPress | Pending |
| 125 | CountdownStickerCard (dynamic/unlabelled) | onShare | Pending |
| 140 | StoryReshareCard (dynamic/unlabelled) | onOpen | Pending |
| 181 | SliderStickerCard (dynamic/unlabelled) | onSubmit | Pending |
| 223 | EntityStickerCard (dynamic/unlabelled) | onPress | Pending |
| 246 | StickerPill (dynamic/unlabelled) | onPress | Pending |
| 276 | MentionText (dynamic/unlabelled) | onPress | Pending |

### src/components/stories/StickerPill.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 75 | TouchableOpacity (dynamic/unlabelled) | onLongPress, onPress | Pending |

### src/components/stories/StickerResponsesSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 99 | Reply | onPress | Pending |
| 100 | Share to story | onPress | Pending |
| 115 | Share result | onPress | Pending |
| 145 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 147 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 155 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 161 | Share results | onPress | Pending |
| 169 | Retry | onPress | Pending |

### src/components/stories/StoryAudienceSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 47 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 60 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 61 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 62 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 68 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 72 | Done | onPress | Pending |
| 84 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 102 | Everyone | onPress | Pending |
| 104 | Followers | onPress | Pending |
| 106 | Close friends | onPress | Pending |
| 108 | Only share with | onPress | Pending |
| 111 | Manage close friends | onPress | Pending |
| 120 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 137 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/stories/StoryFilters.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 42 | Filters Done | onRequestClose | Pending |
| 43 | Filters Done | onPress | Pending |
| 44 | Filters Done | onPress | Pending |
| 52 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 78 | Done | onPress | Pending |

### src/components/stories/StoryOptionsSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 72 | Delete | onPress | Pending |
| 140 | Cancel | onRequestClose, onDismiss | Pending |
| 141 | Cancel | onPress | Pending |
| 148 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 154 | Cancel | onPress | Pending |

### src/components/stories/StoryPixelImage.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 57 | Retry photo | onPress | Pending |

### src/components/stories/StoryReshareCard.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 41 | TouchableOpacity (dynamic/unlabelled) | onLongPress, onPress | Pending |
| 42 | TouchableOpacity (dynamic/unlabelled) | onLongPress, onPress | Pending |

### src/components/stories/StorySettingsSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 28 | Switch (dynamic/unlabelled) | onValueChange | Pending |
| 71 | Story settings Who can interact This story | onRequestClose | Pending |
| 72 | Story settings Who can interact This story | onPress | Pending |
| 73 | Story settings Who can interact This story | onPress | Pending |
| 79 | Allow replies | onToggle | Pending |
| 80 | Allow reactions | onToggle | Pending |
| 81 | Allow sharing | onToggle | Pending |
| 84 | Save original media | onPress | Pending |

### src/components/stories/StoryStrip.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 320 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 339 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 361 | Mute | onPress | Pending |
| 378 | TouchableOpacity (dynamic/unlabelled) | onPress, onLongPress | Pending |
| 435 | 🔥 | onPress | Pending |

### src/components/stories/StoryTextEditorToolbar.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 24 | Cancel text editing | onPress | Pending |
| 28 | Save text sticker | onPress | Pending |
| 33 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 34 | Text background | onPress | Pending |
| 35 | Decrease text size | onPress | Pending |
| 36 | Increase text size | onPress | Pending |
| 37 | Duplicate text sticker | onPress | Pending |
| 38 | Delete text sticker | onPress | Pending |

### src/components/stories/StoryTimingPanel.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 64 | Back to story editing | onPress | Pending |
| 64 | Done | onPress | Pending |
| 66 | TrimStrip (dynamic/unlabelled) | onChange | Pending |
| 69 | LayerTimingRow (dynamic/unlabelled) | onChange, onSeek | Pending |

### src/components/stories/StudioRail.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 20 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 21 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 24 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/stories/StudioSheet.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 86 | TouchableOpacity (dynamic/unlabelled) | onPress, onLongPress | Pending |
| 97 | Stickers | onRequestClose, onDismiss | Pending |
| 99 | Close sticker studio | onPress | Pending |
| 103 | Close sticker studio | onPress | Pending |
| 109 | Search stickers | onChangeText | Pending |
| 114 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 134 | Recent stickers | onPress | Pending |
| 135 | Favorite stickers | onPress | Pending |
| 136 | Add emoji | onPress | Pending |
| 137 | Add GIF | onPress | Pending |
| 138 | Add photo | onPress | Pending |

### src/components/stories/SupportStickerCard.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 11 | SUPPORT | onPress | Pending |

### src/components/stories/TrimStrip.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 140 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/stories/VideoTrimmer.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 110 | Reset | onPress | Pending |
| 113 | Done | onPress | Pending |
| 147 | Split into story cards | onPress | Pending |

### src/components/stories/storyExtras.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 197 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/components/stories/storyPanels.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 190 | Cancel | onPress | Pending |
| 192 | Done | onPress | Pending |
| 199 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 202 | MiniSlider (dynamic/unlabelled) | onChange | Pending |
| 203 | Filter strength | onChange | Pending |
| 204 | Reset | onPress | Pending |
| 207 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 243 | Done | onPress | Pending |
| 249 | Blur | onPress | Pending |
| 254 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 257 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 280 | Done | onPress | Pending |
| 286 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 290 | MiniSlider (dynamic/unlabelled) | onChange | Pending |
| 297 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 301 | MiniSlider (dynamic/unlabelled) | onChange | Pending |
| 356 | Tag in your story | onRequestClose | Pending |
| 358 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 364 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 371 | Search | onChangeText | Pending |
| 377 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 425 | Exit preview | onPress | Pending |

### src/navigation/AppNavigator.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 264 | Pressable (dynamic/unlabelled) | onPress, onLongPress | Pending |

### src/screens/auth/AuthCallbackScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 304 | Back to sign in | onPress | Pending |
| 325 | New password | onChangeText | Pending |
| 337 | Confirm new password | onChangeText | Pending |
| 351 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 359 | Cancel | onPress | Pending |
| 375 | Go to sign in | onPress | Pending |
| 396 | Back to sign in | onPress | Pending |

### src/screens/auth/BusinessSignInScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 64 | ‹ Back | onPress | Pending |
| 71 | @business | onChangeText | Pending |
| 72 | Access code | onChangeText | Pending |
| 73 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 77 | New business? Apply for an account | onPress | Pending |

### src/screens/auth/LoginScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 187 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 215 | Email address | onChangeText | Pending |
| 232 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 257 | 8-digit code | onChangeText | Pending |
| 271 | New password | onChangeText | Pending |
| 283 | Confirm new password | onChangeText | Pending |
| 297 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 314 | Resend code | onPress | Pending |
| 347 | Username or email | onChangeText | Pending |
| 362 | Password | onChangeText | Pending |
| 376 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 381 | Forgot password | onPress | Pending |
| 385 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 391 | New here? Create an account | onPress | Pending |
| 394 | Business sign-in | onPress | Pending |

### src/screens/auth/SetupProfileScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 224 | Full name | onChangeText | Pending |
| 238 | username | onChangeText | Pending |
| 254 | Continue | onPress | Pending |
| 285 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 301 | First name | onChangeText | Pending |
| 304 | Last name | onChangeText | Pending |
| 314 | Degree / Program (optional) | onChangeText | Pending |
| 326 | Grad year | onChangeText | Pending |
| 329 | Semester | onChangeText | Pending |
| 335 | Fraternity / Sorority (optional) | onChangeText | Pending |
| 347 | Headline (e.g. Product Manager at Google) | onChangeText | Pending |
| 352 | Company / Organization | onChangeText | Pending |
| 360 | TextInput (dynamic/unlabelled) | onChangeText | Pending |
| 371 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 385 | Back to details | onPress | Pending |

### src/screens/auth/SignUpScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 118 | Full name | onChangeText | Pending |
| 133 | Email address | onChangeText | Pending |
| 166 | Password (8+ characters) | onChangeText | Pending |
| 179 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 190 | Confirm password | onChangeText | Pending |
| 203 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 213 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 237 | Have an account? Log in | onPress | Pending |

### src/screens/auth/VerifyEmailScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 240 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 285 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 298 | I already verified | onPress | Pending |
| 319 | Back to sign in | onPress | Pending |

### src/screens/channels/ChannelScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 303 | Attachment unavailable. Tap to retry. | onPress | Pending |
| 311 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 325 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 330 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 335 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 348 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 356 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 362 | Tap to retry. | onPress | Pending |
| 372 | FlatList (dynamic/unlabelled) | onScroll, onEndReached | Pending |
| 381 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 384 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 387 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 390 | TextInput (dynamic/unlabelled) | onChangeText | Pending |
| 391 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 398 | Join channel | onPress | Pending |
| 405 | New poll Runs for | onRequestClose | Pending |
| 411 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 414 | Ask a question | onChangeText | Pending |
| 417 | TextInput (dynamic/unlabelled) | onChangeText | Pending |
| 420 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 427 | Add option | onPress | Pending |
| 435 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 440 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 448 | Replies | onRequestClose | Pending |
| 454 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 465 | Tap to retry. | onPress | Pending |
| 465 | Load more replies | onPress | Pending |
| 486 | Write a reply | onChangeText | Pending |
| 487 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 495 | ChannelSettingsSheet (dynamic/unlabelled) | onClose | Pending |

### src/screens/channels/ChannelsScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 178 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 192 | Join | onPress | Pending |
| 200 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 219 | Accept invite | onPress | Pending |
| 227 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 237 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 241 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 247 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 255 | TextInput (dynamic/unlabelled) | onChangeText | Pending |
| 256 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 258 | StudioLoadError (dynamic/unlabelled) | onRetry | Pending |
| 284 | Cancel New channel Name Description Who can join You post the updates. Members react, and reply in threads under each message. | onRequestClose | Pending |
| 288 | Cancel | onPress | Pending |
| 290 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 297 | Channel name | onChangeText | Pending |
| 301 | What is this channel about? | onChangeText | Pending |
| 307 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 319 | Cancel New community Name Description Who can join Category Cover color Rules Every member can post inside a community. You and your moderators keep it clean. | onRequestClose | Pending |
| 323 | Cancel | onPress | Pending |
| 325 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 332 | Community name | onChangeText | Pending |
| 336 | What is this community about? | onChangeText | Pending |
| 342 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 352 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 362 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 368 | Shown to people when they join. (optional) | onChangeText | Pending |

### src/screens/channels/CommunityScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 182 | Pick people | onPress | Pending |
| 183 | Share invite link | onPress | Pending |
| 184 | New invite link (the old one stops working) | onPress | Pending |
| 185 | Pending invitations | onPress | Pending |
| 203 | Remove | onPress | Pending |
| 248 | Delete | onPress | Pending |
| 274 | Leave | onPress | Pending |
| 347 | Dynamic confirmation | onPress | Pending |
| 438 | TouchableOpacity (dynamic/unlabelled) | onPress, onLongPress | Pending |
| 455 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 472 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 476 | Comments | onPress | Pending |
| 491 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 496 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 499 | Open the community chat | onPress | Pending |
| 502 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 505 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 508 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 510 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 526 | Part of | onPress | Pending |
| 531 | Accept | onPress | Pending |
| 532 | Decline | onPress | Pending |
| 537 | Requested | onPress | Pending |
| 541 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 554 | FlatList (dynamic/unlabelled) | onEndReached | Pending |
| 558 | Community rules | onPress | Pending |
| 576 | Post an announcement | onPress | Pending |
| 579 | TouchableOpacity (dynamic/unlabelled) | onLongPress | Pending |
| 589 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 596 | Sub-group | onPress | Pending |
| 623 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 634 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 638 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 641 | Share with the community | onChangeText | Pending |
| 642 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 650 | Members | onRequestClose | Pending |
| 653 | Blocked | onPress | Pending |
| 655 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 660 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 673 | Join requests | onRequestClose | Pending |
| 678 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 690 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 691 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 697 | Cancel Settings | onRequestClose | Pending |
| 701 | Cancel | onPress | Pending |
| 703 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 709 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 718 | Name | onChangeText | Pending |
| 719 | Description | onChangeText | Pending |
| 722 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 729 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 736 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 739 | Rules shown to people when they join | onChangeText | Pending |
| 741 | Delete community | onPress | Pending |
| 749 | CommentsSheet (dynamic/unlabelled) | onClose | Pending |
| 762 | Invite to the community | onPick, onClose | Pending |
| 764 | Cancel Announcement Post Announcements go one way: every member sees them, only moderators write them. | onRequestClose | Pending |
| 768 | Cancel | onPress | Pending |
| 770 | Post | onPress | Pending |
| 774 | What should everyone know? | onChangeText | Pending |
| 780 | Cancel New sub-group A sub-group lives inside . Only its members can join, and leaving leaves the sub-group too. | onRequestClose | Pending |
| 784 | Cancel | onPress | Pending |
| 786 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 792 | Name | onChangeText | Pending |
| 793 | What is it for? | onChangeText | Pending |
| 796 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 806 | Pending invitations | onRequestClose | Pending |
| 811 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 823 | Withdraw invitation | onPress | Pending |
| 829 | Blocked from rejoining | onRequestClose | Pending |
| 834 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 846 | Allow back in | onPress | Pending |

### src/screens/feed/ArticleComposeScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 249 | ‹ Back | onPress | Pending |
| 253 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 258 | Title | onChangeText | Pending |
| 261 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 267 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 278 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 282 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 285 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 289 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 294 | Add a link Cancel Insert | onRequestClose | Pending |
| 298 | Link text | onChangeText | Pending |
| 305 | https:// | onChangeText | Pending |
| 316 | Cancel | onPress | Pending |
| 319 | Insert | onPress | Pending |
| 329 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 333 | Write the piece. Paragraphs are preserved exactly as you write them. Use the toolbar for headings, emphasis, quotes, links and images. | onChangeText | Pending |
| 351 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/feed/ArticleReaderScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 56 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 68 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/feed/FeedScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 206 | Text (dynamic/unlabelled) | onPress | Pending |
| 207 | Text (dynamic/unlabelled) | onPress | Pending |
| 400 | Everyone | onPress | Pending |
| 401 | People I follow | onPress | Pending |
| 402 | My followers | onPress | Pending |
| 403 | Mentioned only | onPress | Pending |
| 404 | Turn off comments | onPress | Pending |
| 1177 | Everyone | onPress | Pending |
| 1178 | Followers | onPress | Pending |
| 1179 | Mentioned only | onPress | Pending |
| 1180 | Verified only | onPress | Pending |
| 1272 | Block | onPress | Pending |
| 1936 | MarketplaceShelf (dynamic/unlabelled) | onOpen | Pending |
| 1943 | DiscoverTile (dynamic/unlabelled) | onPress | Pending |
| 1955 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1963 | Follow | onPress | Pending |
| 1983 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1994 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2007 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2015 | collaborators | onPress | Pending |
| 2038 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2056 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2061 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2063 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2092 | ARTICLE | onPress | Pending |
| 2126 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2146 | SharedPostCard (dynamic/unlabelled) | onPress | Pending |
| 2183 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2194 | Show this thread | onPress | Pending |
| 2199 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2204 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2209 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2209 | Repost | onPress | Pending |
| 2209 | Quote | onPress | Pending |
| 2211 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2214 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2218 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2235 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2249 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2294 | Search | onPress | Pending |
| 2303 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2321 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2335 | Retry loading the feed | onPress | Pending |
| 2348 | NewPostsPill (dynamic/unlabelled) | onPress | Pending |
| 2349 | TapTopFlatList (dynamic/unlabelled) | onScroll, onEndReached | Pending |
| 2381 | ScrollView (dynamic/unlabelled) | onScroll | Pending |
| 2383 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2404 | Retry loading the feed | onPress | Pending |
| 2419 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 2425 | Post your work | onPress | Pending |
| 2436 | Create a post | onPress | Pending |
| 2445 | Comments Collaborators Sensitive content | onRequestClose | Pending |
| 2447 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2447 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2449 | Continue browsing this feed | onPress | Pending |
| 2453 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2461 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2469 | @ | onPress | Pending |
| 2476 | Your original post and media are kept for a safe retry. | onPress | Pending |
| 2477 | Edit draft | onPress | Pending |
| 2481 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2484 | Regular post | onPress | Pending |
| 2488 | Write an article | onPress | Pending |
| 2492 | Create a listing | onPress | Pending |
| 2496 | Post to Innovation | onPress | Pending |
| 2502 | Write a caption… | onChangeText | Pending |
| 2507 | TextInput (dynamic/unlabelled) | onChangeText | Pending |
| 2509 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2513 | Add option | onPress | Pending |
| 2514 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2526 | Article title (optional) | onChangeText | Pending |
| 2546 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2555 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2565 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2578 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2583 | Edit | onPress | Pending |
| 2583 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2583 | Remove selected media | onPress | Pending |
| 2584 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2584 | Add more media | onPress | Pending |
| 2585 | PostMediaEditSheet (dynamic/unlabelled) | onCancel, onDone | Pending |
| 2586 | Music | onPress | Pending |
| 2586 | Comments | onPress | Pending |
| 2586 | Collaborators | onPress | Pending |
| 2586 | Sensitive content | onPress | Pending |
| 2588 | Media | onPress | Pending |
| 2588 | Open post camera and lenses | onPress | Pending |
| 2588 | Add music to post | onPress | Pending |
| 2588 | Products | onPress | Pending |
| 2588 | Poll | onPress | Pending |
| 2590 | SoundtrackPicker (dynamic/unlabelled) | onChange, onClose | Pending |
| 2591 | ProductPickerSheet (dynamic/unlabelled) | onClose, onSave | Pending |
| 2592 | Invite a collaborator | onClose, onPick | Pending |
| 2597 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2599 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2608 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 2609 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2617 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2628 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2639 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 2640 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2651 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2662 | Share Add to your story Share this post as a card on your story Add to thread Quote this post with your own words Send to A message, a group or a community Copy link Share via What | onRequestClose | Pending |
| 2663 | Share Add to your story Share this post as a card on your story Add to thread Quote this post with your own words Send to A message, a group or a community Copy link Share via What | onPress | Pending |
| 2668 | React to video Record your reaction and post it as a reply | onPress | Pending |
| 2673 | Add to your story Share this post as a card on your story | onPress | Pending |
| 2677 | Add to thread Quote this post with your own words | onPress | Pending |
| 2681 | Send to A message, a group or a community | onPress | Pending |
| 2685 | Copy link | onPress | Pending |
| 2689 | Share via WhatsApp, Messages and other apps | onPress | Pending |
| 2697 | Send to | onRequestClose | Pending |
| 2698 | Send to | onPress | Pending |
| 2703 | Retry | onPress | Pending |
| 2708 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2717 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2729 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2742 | PostMediaViewer (dynamic/unlabelled) | onClose | Pending |
| 2744 | DiscoverViewer (dynamic/unlabelled) | onClose, onSave, onShare | Pending |
| 2752 | CommentsSheet (dynamic/unlabelled) | onClose | Pending |
| 2767 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 2770 | VideoFeedModal (dynamic/unlabelled) | onClose, onShare, onReport | Pending |
| 2791 | FullscreenVideo (dynamic/unlabelled) | onClose | Pending |
| 2797 | ProductPickerSheet (dynamic/unlabelled) | onClose, onSave | Pending |
| 2799 | PostInsightsSheet (dynamic/unlabelled) | onClose | Pending |
| 2805 | CollaboratorsSheet (dynamic/unlabelled) | onClose | Pending |
| 2806 | Invite a collaborator | onClose, onPick | Pending |
| 2809 | Add to your story Share post Copy text Cancel | onRequestClose | Pending |
| 2810 | Add to your story Share post Copy text Cancel | onPress | Pending |
| 2817 | View insights | onPress | Pending |
| 2828 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2842 | Pin or unpin on profile | onPress | Pending |
| 2856 | Archive post | onPress | Pending |
| 2860 | Archive | onPress | Pending |
| 2873 | Stop sharing this collab | onPress | Pending |
| 2877 | Stop sharing | onPress | Pending |
| 2886 | Remove a collaborator | onPress | Pending |
| 2901 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2915 | Delete post | onPress | Pending |
| 2919 | Delete | onPress | Pending |
| 2936 | Add to thread | onPress | Pending |
| 2949 | Add to your story | onPress | Pending |
| 2958 | Share post | onPress | Pending |
| 2971 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2982 | Copy text | onPress | Pending |
| 2994 | Not interested | onPress | Pending |
| 3003 | Report post | onPress | Pending |
| 3009 | Spam | onPress | Pending |
| 3010 | Harassment | onPress | Pending |
| 3011 | False information | onPress | Pending |
| 3012 | Inappropriate content | onPress | Pending |
| 3025 | Block | onPress | Pending |
| 3033 | Cancel | onPress | Pending |

### src/screens/feed/PostScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 267 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 286 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 301 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 305 | × others | onPress | Pending |
| 346 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 379 | Like | onPress | Pending |
| 383 | Comment | onPress | Pending |
| 391 | Accept | onPress | Pending |
| 392 | Decline | onPress | Pending |
| 409 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 424 | Retry | onPress | Pending |
| 429 | CommentsPanel (dynamic/unlabelled) | onRefresh | Pending |
| 440 | CollaboratorsSheet (dynamic/unlabelled) | onClose | Pending |
| 443 | PostMediaViewer (dynamic/unlabelled) | onClose | Pending |

### src/screens/feed/SavedPostsScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 166 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 182 | Remove from saved posts | onPress | Pending |
| 196 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 198 | A photo or video could not load. Tap to retry. | onPress | Pending |
| 237 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 258 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 264 | Retry | onPress | Pending |

### src/screens/feed/SearchScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 194 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 216 | ♥ 💬 | onPress | Pending |
| 234 | A photo or video could not load. Tap to retry. | onPress | Pending |
| 244 | 💼 | onPress | Pending |
| 264 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 294 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 302 | Go back | onPress | Pending |
| 314 | Search Platinum | onChangeText | Pending |
| 328 | Clear search | onPress | Pending |
| 341 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 367 | # | onPress | Pending |
| 378 | Clear recent searches | onPress | Pending |
| 394 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 397 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 422 | Retry | onPress | Pending |

### src/screens/feed/TrendFeedScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 236 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 253 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 307 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 332 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 338 | Try again | onPress | Pending |
| 346 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 354 | FlatList (dynamic/unlabelled) | onEndReached | Pending |
| 361 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |

### src/screens/jobs/ApplicantsScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 153 | applied | onPress | Pending |
| 165 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 172 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 181 | Message | onPress | Pending |
| 185 | Profile | onPress | Pending |
| 191 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 207 | Back to jobs | onPress | Pending |
| 224 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 238 | Try again | onPress | Pending |
| 254 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 257 | Update application status Cancel | onRequestClose | Pending |
| 258 | Update application status Cancel | onPress | Pending |
| 259 | Update application status Cancel | onPress | Pending |
| 266 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 275 | Cancel | onPress | Pending |
| 282 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 283 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 284 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 302 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 329 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 336 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 343 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 356 | Cancel interview | onPress | Pending |
| 364 | Date and time, e.g. 2026-08-04 14:00 | onChangeText | Pending |
| 365 | Location or call link (optional) | onChangeText | Pending |
| 366 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 388 | Message | onPress | Pending |
| 393 | Full profile | onPress | Pending |

### src/screens/jobs/JobDetailScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 51 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 223 | Try again | onPress | Pending |
| 223 | Back to jobs | onPress | Pending |
| 242 | Back to jobs | onPress | Pending |
| 247 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 251 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 271 | Posted this role · View profile | onPress | Pending |
| 284 | Message | onPress | Pending |
| 334 | SimilarRoles (dynamic/unlabelled) | onOpen | Pending |
| 341 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 343 | Manage applicants | onPress | Pending |
| 355 | Apply on company site | onPress | Pending |
| 361 | Apply now | onPress | Pending |
| 367 | Apply to Cancel | onRequestClose | Pending |
| 372 | Add a short note (optional): why you fit this role | onChangeText | Pending |
| 382 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 388 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 393 | Phone number (optional) | onChangeText | Pending |
| 403 | Portfolio or LinkedIn link (optional) | onChangeText | Pending |
| 415 | Cancel | onPress | Pending |
| 418 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/jobs/JobsScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 390 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 397 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 441 | Apply | onPress | Pending |
| 452 | Message recruiter | onPress | Pending |
| 455 | Refer someone | onPress | Pending |
| 463 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 466 | Referrals | onPress | Pending |
| 469 | Delete | onPress | Pending |
| 473 | Delete | onPress | Pending |
| 492 | Job messages | onPress | Pending |
| 496 | Saved jobs | onPress | Pending |
| 500 | My applications | onPress | Pending |
| 504 | Post | onPress | Pending |
| 510 | Search jobs by title, keyword, or company | onChangeText | Pending |
| 521 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 534 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 551 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 558 | Try again | onPress | Pending |
| 558 | Browse all jobs | onPress | Pending |
| 562 | TapTopFlatList (dynamic/unlabelled) | onScroll | Pending |
| 586 | Post a Job | onPress | Pending |
| 591 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 596 | Recommend Someone ✕ | onRequestClose | Pending |
| 601 | ✕ | onPress | Pending |
| 616 | e.g. Sarah Kimani | onChangeText | Pending |
| 624 | Email, LinkedIn, or phone number | onChangeText | Pending |
| 631 | Brief note about their background or fit... | onChangeText | Pending |
| 638 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 656 | Recommendations ✕ 🔒 Only you can see these recommendations. | onRequestClose | Pending |
| 660 | ✕ | onPress | Pending |
| 670 | FlatList (dynamic/unlabelled) | onScroll | Pending |
| 694 | Post a Job ✕ Job Type Job Title * Company * Location Work Mode Experience Level Industry Salary Range What this role offers (one per line) Apply URL (optional) Description * ⚡ Urge | onRequestClose | Pending |
| 699 | ✕ | onPress | Pending |
| 707 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 718 | e.g. Global Strategy Analyst | onChangeText | Pending |
| 721 | Company or organization name | onChangeText | Pending |
| 724 | City, Country or Remote | onChangeText | Pending |
| 729 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 744 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 759 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 770 | e.g. $60,000 - $80,000 / year | onChangeText | Pending |
| 773 | Medical aid Transport allowance Performance bonus | onChangeText | Pending |
| 776 | https://... | onChangeText | Pending |
| 779 | Describe the role, responsibilities, and requirements... | onChangeText | Pending |
| 792 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 800 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/jobs/MyApplicationsScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 67 | Withdraw | onPress | Pending |
| 92 | Back to jobs | onPress | Pending |
| 101 | Tap to retry | onPress | Pending |
| 109 | FlatList (dynamic/unlabelled) | onRefresh | Pending |
| 121 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 131 | JobListRow (dynamic/unlabelled) | onPress | Pending |
| 141 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/jobs/SavedJobsScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 57 | Back to jobs | onPress | Pending |
| 66 | Tap to retry | onPress | Pending |
| 81 | JobListRow (dynamic/unlabelled) | onPress | Pending |
| 86 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/market/CreateListingScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 84 | Discard | onPress | Pending |
| 156 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 178 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 184 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 196 | What are you selling? | onChangeText | Pending |
| 205 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 208 | 0 | onChangeText | Pending |
| 219 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 228 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 236 | Describe your item (optional) | onChangeText | Pending |
| 248 | e.g. Avondale, Harare | onChangeText | Pending |
| 255 | Share to feed Post this listing so your followers see it in their feed. | onPress | Pending |
| 262 | Offer delivery Buyers collect by default. Turn this on if you can deliver. | onPress | Pending |
| 272 | Delivery fee (0 for free) | onChangeText | Pending |
| 275 | Delivery note, e.g. Harare CBD only | onChangeText | Pending |
| 311 | Next | onPress | Pending |
| 315 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/market/ListingDetailScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 106 | Block | onPress | Pending |
| 161 | Mark sold | onPress | Pending |
| 175 | Try again | onPress | Pending |
| 183 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 213 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 217 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 221 | Share listing | onPress | Pending |
| 261 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 284 | Report listing | onPress | Pending |
| 289 | Block seller | onPress | Pending |
| 297 | ReportListingSheet (dynamic/unlabelled) | onClose | Pending |
| 305 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 317 | Mark as sold | onPress | Pending |
| 327 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 338 | Make offer | onPress | Pending |
| 349 | Make an offer Asking | onRequestClose | Pending |
| 350 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 359 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 366 | Your amount | onChangeText | Pending |
| 369 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/market/MarketScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 139 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 157 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 197 | Marketplace orders | onPress | Pending |
| 198 | Market messages | onPress | Pending |
| 212 | Create listing | onPress | Pending |
| 224 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 236 | Filters | onPress | Pending |
| 241 | MarketFilterSheet (dynamic/unlabelled) | onClose | Pending |
| 245 | Search the market | onChangeText | Pending |
| 255 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 271 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 285 | Could not load listings. Tap to retry. | onPress | Pending |
| 298 | TapTopFlatList (dynamic/unlabelled) | onEndReached, onScroll | Pending |
| 304 | Could not load more listings. Tap to retry. | onPress | Pending |
| 313 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 318 | Close orders | onRequestClose | Pending |
| 319 | Close orders | onPress | Pending |

### src/screens/messages/CallLogScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 172 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 180 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 197 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 222 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |

### src/screens/messages/CallScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 77 | Leave call | onPress | Pending |
| 78 | End for everyone | onPress | Pending |
| 206 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 217 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 228 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 231 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 234 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 237 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 240 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 245 | MoreMenu (dynamic/unlabelled) | onClose, onMute | Pending |
| 266 | Minimize | onPress | Pending |
| 269 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 312 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 320 | Tap to add | onPress | Pending |
| 332 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 334 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 336 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 340 | Dial Pad (local only) Done | onRequestClose | Pending |
| 341 | Dial Pad (local only) Done | onPress | Pending |
| 346 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 348 | Done | onPress | Pending |
| 351 | MoreMenu (dynamic/unlabelled) | onClose, onMute | Pending |
| 370 | Call Options | onRequestClose | Pending |
| 371 | Call Options | onPress | Pending |
| 375 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/messages/ChatScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 176 | Text (dynamic/unlabelled) | onPress | Pending |
| 271 | Back | onPress | Pending |
| 283 | Search GIPHY | onChangeText | Pending |
| 290 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 310 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 375 | TouchableOpacity (dynamic/unlabelled) | onPress, onLongPress | Pending |
| 401 | ▶ Open in browser | onPress | Pending |
| 1378 | Normal | onPress | Pending |
| 1378 | View once | onPress | Pending |
| 1379 | View twice | onPress | Pending |
| 1379 | Cancel | onPress | Pending |
| 1393 | Retry | onPress | Pending |
| 1416 | Normal | onPress | Pending |
| 1416 | View once | onPress | Pending |
| 1416 | Cancel | onPress | Pending |
| 1798 | Pressable (dynamic/unlabelled) | onPress, onLongPress | Pending |
| 1806 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1807 | View story | onPress | Pending |
| 1810 | SharedPostCard (dynamic/unlabelled) | onPress | Pending |
| 1825 | AutoSizeImage (dynamic/unlabelled) | onPress, onLongPress | Pending |
| 1842 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1866 | AutoSizeImage (dynamic/unlabelled) | onPress, onLongPress | Pending |
| 1901 | Accept | onPress | Pending |
| 1904 | Counter | onPress | Pending |
| 1909 | Decline | onPress | Pending |
| 1927 | TouchableOpacity (dynamic/unlabelled) | onPress, onLongPress | Pending |
| 1937 | Tap to open | onPress | Pending |
| 1963 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1979 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2033 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2067 | · | onPress | Pending |
| 2109 | ★ | onPress | Pending |
| 2126 | Back to conversations | onPress | Pending |
| 2129 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2151 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2154 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2158 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2167 | Search in conversation... | onChangeText | Pending |
| 2170 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2178 | SendMoneySheet (dynamic/unlabelled) | onClose | Pending |
| 2219 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2240 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2249 | FlatList (dynamic/unlabelled) | onScroll | Pending |
| 2258 | Seen by | onPress | Pending |
| 2268 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2315 | Ongoing call · in call Tap to join | onPress | Pending |
| 2336 | @ | onPress | Pending |
| 2356 | Check delivery | onPress | Pending |
| 2357 | Dismiss saved copy | onPress | Pending |
| 2369 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2387 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2400 | Cancel recording | onPress | Pending |
| 2415 | Send voice message | onPress | Pending |
| 2432 | TouchableOpacity (dynamic/unlabelled) | onPress, onLongPress | Pending |
| 2433 | Remove | onPress | Pending |
| 2438 | Save current text as a reply | onPress | Pending |
| 2447 | Message | onChangeText | Pending |
| 2455 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2462 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2473 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2478 | Record a voice message | onPress | Pending |
| 2494 | Message info | onRequestClose | Pending |
| 2495 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2515 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 2517 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2522 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2528 | GifPicker (dynamic/unlabelled) | onSelect, onBack | Pending |
| 2532 | ChatImageEditor (dynamic/unlabelled) | onCancel, onDone | Pending |
| 2540 | Done | onRequestClose | Pending |
| 2543 | Done | onPress | Pending |
| 2567 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2613 | Leave | onPress | Pending |
| 2621 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2633 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2672 | See all members → | onPress | Pending |
| 2679 | ChatInfoSections (dynamic/unlabelled) | onClose | Pending |
| 2700 | Clear chat | onPress | Pending |
| 2703 | Clear | onPress | Pending |
| 2713 | Block | onPress | Pending |
| 2716 | Block | onPress | Pending |
| 2734 | Cancel Edit message Save | onRequestClose | Pending |
| 2736 | Pressable (dynamic/unlabelled) | onPress | Pending |
| 2739 | Cancel | onPress | Pending |
| 2743 | Save | onPress | Pending |
| 2753 | Edit your message... | onChangeText | Pending |
| 2760 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 2761 | Pressable (dynamic/unlabelled) | onPress | Pending |
| 2765 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2824 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2836 | ShareDetailsSheet (dynamic/unlabelled) | onClose, onSend | Pending |
| 2840 | PrivateMediaViewer (dynamic/unlabelled) | onClose | Pending |
| 2842 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 2844 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2852 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2856 | Share | onPress | Pending |
| 2865 | Cancel | onRequestClose | Pending |
| 2869 | Cancel | onPress | Pending |
| 2872 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2881 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 2883 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2889 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2893 | Share | onPress | Pending |
| 2902 | Forward to... | onRequestClose | Pending |
| 2906 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 2913 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/messages/ContextInboxScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 99 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 113 | Try again | onPress | Pending |
| 128 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 134 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/messages/ConversationsScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 431 | Delete | onPress | Pending |
| 437 | Block | onPress | Pending |
| 448 | Dynamic confirmation | onPress | Pending |
| 449 | Dynamic confirmation | onPress | Pending |
| 450 | Dynamic confirmation | onPress | Pending |
| 451 | Delete | onPress | Pending |
| 555 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 561 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 583 | TouchableOpacity (dynamic/unlabelled) | onPress, onLongPress | Pending |
| 590 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 669 | Channels | onPress | Pending |
| 672 | Call history | onPress | Pending |
| 675 | Saved messages | onPress | Pending |
| 678 | New message | onPress | Pending |
| 688 | Search messages | onChangeText | Pending |
| 694 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 700 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 709 | Retry conversations | onPress | Pending |
| 717 | Find people | onPress | Pending |
| 720 | TapTopFlatList (dynamic/unlabelled) | onScroll | Pending |
| 736 | Archived | onPress | Pending |
| 744 | Archived chats | onPress | Pending |

### src/screens/messages/CreateGroupScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 171 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 206 | Cancel new group | onPress | Pending |
| 215 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 231 | Group name | onChangeText | Pending |
| 249 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 274 | Search people | onChangeText | Pending |
| 284 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 290 | Retry | onPress | Pending |

### src/screens/messages/GroupManagementScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 287 | Save to device | onPress | Pending |
| 288 | Share link | onPress | Pending |
| 308 | Save to device | onPress | Pending |
| 309 | Open | onPress | Pending |
| 310 | Share link | onPress | Pending |
| 432 | Remove | onPress | Pending |
| 443 | Leave | onPress | Pending |
| 480 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 492 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 513 | TextInput (dynamic/unlabelled) | onChangeText | Pending |
| 519 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 522 | Cancel | onPress | Pending |
| 527 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 539 | Message | onPress | Pending |
| 544 | Invite | onPress | Pending |
| 549 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 562 | What is this group about? | onChangeText | Pending |
| 574 | Cancel | onPress | Pending |
| 577 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 583 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 600 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 610 | Search by name or username... | onChangeText | Pending |
| 620 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 658 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 676 | Dynamic confirmation | onPress | Pending |
| 677 | Remove | onPress | Pending |
| 690 | See all members | onPress | Pending |
| 703 | See all | onPress | Pending |
| 709 | Pressable (dynamic/unlabelled) | onPress | Pending |
| 727 | Shared Files | onPress | Pending |
| 742 | Starred Messages | onPress | Pending |
| 759 | Only admins can edit group info | onChange | Pending |
| 766 | Only admins can add members | onChange | Pending |
| 775 | Leave group | onPress | Pending |
| 781 | Cancel | onRequestClose | Pending |
| 782 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 789 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 794 | Unmute | onPress | Pending |
| 798 | Cancel | onPress | Pending |
| 804 | Media Docs | onRequestClose | Pending |
| 807 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 811 | Media | onPress | Pending |
| 817 | Docs | onPress | Pending |
| 841 | Pressable (dynamic/unlabelled) | onPress, onLongPress | Pending |
| 879 | Pressable (dynamic/unlabelled) | onPress, onLongPress | Pending |
| 893 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 908 | MediaViewer (dynamic/unlabelled) | onClose | Pending |
| 920 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/messages/IncomingCallScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 213 | &#x2715; Decline | onPress | Pending |
| 214 | &#x2713; Accept | onPress | Pending |

### src/screens/messages/MessageRequestsScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 122 | Decline | onPress | Pending |
| 182 | Decline | onPress | Pending |
| 190 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 211 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/messages/NewMessageScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 44 | Cancel new message | onPress | Pending |
| 48 | Search message recipients | onChangeText | Pending |
| 49 | Clear search | onPress | Pending |
| 51 | Create a group | onPress | Pending |
| 52 | Retry | onPress | Pending |
| 53 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/messages/SavedMessagesScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 91 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 105 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 119 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/messages/StarredMessagesScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 193 | ★ | onPress | Pending |
| 209 | ★ | onPress | Pending |
| 225 | ‹ Messages | onPress | Pending |
| 244 | Search saved messages | onChangeText | Pending |
| 250 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |

### src/screens/network/NetworkScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 296 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 312 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 334 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 341 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 369 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 383 | TextInput (dynamic/unlabelled) | onChangeText | Pending |
| 397 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 408 | Retry | onPress | Pending |
| 415 | FlatList (dynamic/unlabelled) | onScroll | Pending |
| 433 | Group chat | onPress | Pending |
| 439 | + Create | onPress | Pending |
| 450 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 455 | ← Back | onPress | Pending |
| 463 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 475 | FlatList (dynamic/unlabelled) | onScroll | Pending |
| 487 | Retry | onPress | Pending |
| 492 | FlatList (dynamic/unlabelled) | onScroll | Pending |
| 520 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 525 | Cancel Create Name * Description | onRequestClose | Pending |
| 529 | Cancel | onPress | Pending |
| 535 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 547 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 561 | TextInput (dynamic/unlabelled) | onChangeText | Pending |
| 575 | What is this group about? | onChangeText | Pending |

### src/screens/notifications/NotificationsScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 338 | View story | onPress | Pending |
| 339 | Add to your story | onPress | Pending |
| 458 | TouchableOpacity (dynamic/unlabelled) | onLongPress, onPress | Pending |
| 461 | Delete | onPress | Pending |
| 503 | Accept | onPress | Pending |
| 504 | Decline | onPress | Pending |
| 509 | Accept | onPress | Pending |
| 510 | Decline | onPress | Pending |
| 515 | Confirm | onPress | Pending |
| 522 | Delete | onPress | Pending |
| 540 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 562 | Go back | onPress | Pending |
| 564 | Mark all read | onPress | Pending |
| 577 | Try again | onPress | Pending |
| 590 | TapTopSectionList (dynamic/unlabelled) | onEndReached | Pending |
| 593 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 598 | Follow requests waiting for your answer › | onPress | Pending |
| 608 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |

### src/screens/profile/AboutScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 22 | ‹ Back | onPress | Pending |

### src/screens/profile/AccountStandingScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 57 | ‹ Back | onPress | Pending |
| 67 | Retry | onPress | Pending |

### src/screens/profile/ApplyVerificationScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 102 | Apply again | onPress | Pending |
| 117 | ‹ Back | onPress | Pending |
| 127 | Retry | onPress | Pending |
| 132 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 152 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 163 | e.g. Member of Parliament, Harare | onChangeText | Pending |
| 168 | TextInput (dynamic/unlabelled) | onChangeText | Pending |
| 171 | https://example.com/official-profile https://example.com/press-coverage | onChangeText | Pending |
| 175 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/profile/ArchiveScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 37 | Restore | onPress | Pending |
| 45 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 61 | Restore | onPress | Pending |

### src/screens/profile/BlockedAccountsScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 90 | Unblock | onPress | Pending |
| 116 | Go back | onPress | Pending |
| 134 | Try again | onPress | Pending |
| 164 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/profile/BusinessAccessScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 59 | Revoke | onPress | Pending |
| 75 | Remove | onPress | Pending |
| 95 | ‹ Back | onPress | Pending |
| 104 | Representative's name | onChangeText | Pending |
| 105 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 116 | Revoke | onPress | Pending |
| 130 | Approve | onPress | Pending |
| 132 | Remove | onPress | Pending |

### src/screens/profile/BusinessApplyScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 109 | ‹ Back | onPress | Pending |
| 118 | Company or business name | onChangeText | Pending |
| 119 | What industry (e.g. Fintech, Retail, Media) | onChangeText | Pending |
| 120 | What the business does, who runs it, and why it belongs on Platinum Circles | onChangeText | Pending |
| 121 | Business contact email | onChangeText | Pending |
| 122 | Business phone (optional) | onChangeText | Pending |
| 123 | Website (optional) | onChangeText | Pending |
| 124 | Registration or license details (optional) | onChangeText | Pending |
| 125 | Desired @ for the business | onChangeText | Pending |
| 127 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 141 | Open business | onPress | Pending |

### src/screens/profile/BusinessInboxScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 68 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 97 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 109 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/profile/BusinessManageScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 239 | Leave | onPress | Pending |
| 267 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 271 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 285 | View public profile | onPress | Pending |
| 293 | Open inbox Customer messages · replies send as the business › | onPress | Pending |
| 309 | Campaigns Promote posts into the feed · live reach and clicks › | onPress | Pending |
| 327 | Switch (dynamic/unlabelled) | onValueChange | Pending |
| 330 | Thanks for reaching out. We reply during business hours. | onChangeText, onBlur | Pending |
| 340 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 348 | Phone | onChangeText | Pending |
| 349 | Email | onChangeText | Pending |
| 350 | Website | onChangeText | Pending |
| 351 | Street address | onChangeText | Pending |
| 352 | City | onChangeText | Pending |
| 365 | 08:00 | onChangeText | Pending |
| 371 | 17:00 | onChangeText | Pending |
| 380 | Switch (dynamic/unlabelled) | onValueChange | Pending |
| 396 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 422 | Add by username | onChangeText | Pending |
| 429 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/profile/BusinessesScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 56 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 60 | New | onPress | Pending |
| 72 | Try again | onPress | Pending |
| 84 | Create a business | onPress | Pending |
| 94 | post | onPress | Pending |

### src/screens/profile/CampaignsScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 117 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 124 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 136 | New campaign | onPress | Pending |
| 154 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 171 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 184 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 194 | Sponsored | onChangeText | Pending |
| 198 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 204 | e.g. 5000 — blank for unlimited | onChangeText | Pending |
| 206 | Back | onPress | Pending |
| 207 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 213 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/profile/ChangeUsernameScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 74 | ‹ Back | onPress | Pending |
| 83 | New username | onChangeText | Pending |
| 85 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/profile/ContactSupportScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 80 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 97 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 107 | TextInput (dynamic/unlabelled) | onChangeText | Pending |
| 112 | TextInput (dynamic/unlabelled) | onChangeText | Pending |
| 117 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 126 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/profile/CreateBusinessScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 83 | Done | onPress | Pending |
| 102 | Cancel | onPress | Pending |
| 110 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 128 | Pearl Group | onChangeText | Pending |
| 139 | pearlgroup | onChangeText | Pending |
| 159 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/profile/EditProfileScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 179 | Cancel | onPress | Pending |
| 187 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 193 | Retry loading profile | onPress | Pending |
| 202 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 216 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 231 | Your full name | onChangeText | Pending |
| 236 | username | onChangeText | Pending |
| 241 | e.g. Software developer, Trader, Nurse | onChangeText | Pending |
| 246 | Tell people about yourself | onChangeText | Pending |
| 253 | Where you work | onChangeText | Pending |
| 258 | City, Country | onChangeText | Pending |
| 267 | Label, e.g. My shop | onChangeText | Pending |
| 269 | Remove link | onPress | Pending |
| 273 | https:// | onChangeText | Pending |
| 278 | Add a link | onPress | Pending |
| 292 | Switch (dynamic/unlabelled) | onValueChange | Pending |

### src/screens/profile/FollowListScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 84 | Remove | onPress | Pending |
| 105 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 120 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 125 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 136 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 144 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 151 | Search | onChangeText | Pending |
| 153 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 164 | FlatList (dynamic/unlabelled) | onEndReached | Pending |

### src/screens/profile/FollowRequestsScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 138 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 154 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 162 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 179 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 200 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |

### src/screens/profile/HelpSupportScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 34 | ‹ Back | onPress | Pending |
| 43 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/profile/HiddenWordsScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 44 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 51 | Add a word or phrase | onChangeText | Pending |
| 52 | Add | onPress | Pending |
| 57 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/profile/LoginActivityScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 47 | Log out others | onPress | Pending |
| 61 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 80 | Log out of all other devices | onPress | Pending |

### src/screens/profile/MemoryAlbumScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 260 | Delete | onPress | Pending |
| 291 | Retry | onPress | Pending |
| 291 | Back to profile | onPress | Pending |
| 305 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 331 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 335 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 335 | Page options | onPress | Pending |
| 336 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 343 | Soundtrack could not play. Tap to retry. | onPress | Pending |
| 347 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 351 | Open book | onPress | Pending |
| 352 | Play book automatically | onPress | Pending |
| 354 | Add memories | onPress | Pending |
| 360 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 360 | + Add memories | onPress | Pending |
| 368 | Add memories | onPress | Pending |
| 382 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 386 | View full post → | onPress | Pending |
| 388 | PageVideo (dynamic/unlabelled) | onRetry | Pending |
| 388 | Open memory video full screen | onPress | Pending |
| 389 | MemoryPageImage (dynamic/unlabelled) | onRetry | Pending |
| 399 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 407 | Next book → | onPress | Pending |
| 410 | Previous memory | onPress | Pending |
| 413 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 415 | Next memory | onPress | Pending |
| 423 | Add from your stories | onRequestClose | Pending |
| 426 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 430 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 437 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 448 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 476 | Page options | onRequestClose, onDismiss | Pending |
| 478 | Close page options | onPress | Pending |
| 480 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 485 | Book settings Cover memory Paper tint Who can open it Cover design Cancel Save | onRequestClose | Pending |
| 491 | Memories | onChangeText | Pending |
| 492 | Book subtitle | onChangeText | Pending |
| 495 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 499 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 505 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 512 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 516 | Cancel | onPress | Pending |
| 517 | Save | onPress | Pending |
| 525 | MemoryVideo (dynamic/unlabelled) | onClose | Pending |
| 528 | Caption Cancel Save | onRequestClose | Pending |
| 534 | Say something about this memory | onChangeText | Pending |
| 536 | Cancel | onPress | Pending |
| 537 | Save | onPress | Pending |
| 549 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 551 | PageVideo (dynamic/unlabelled) | onRetry | Pending |
| 554 | Message | onPress | Pending |
| 560 | Close memory video | onPress | Pending |
| 628 | Retry memory video | onPress | Pending |
| 632 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/profile/MonetizationScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 59 | Go back | onPress | Pending |
| 59 | Refresh monetization | onPress | Pending |
| 64 | Link IntoBank | onPress | Pending |
| 67 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 67 | Read the creator program terms | onPress | Pending |
| 67 | I accept the current creator program terms. | onPress | Pending |
| 67 | Submit application | onPress | Pending |
| 74 | Get help with monetization | onPress | Pending |
| 76 | LinkIntoBankSheet (dynamic/unlabelled) | onClose | Pending |

### src/screens/profile/MutedStoriesScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 57 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 86 | Unmute | onPress | Pending |

### src/screens/profile/MutedWordsScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 44 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 51 | Add a word or phrase | onChangeText | Pending |
| 52 | Add | onPress | Pending |
| 57 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/profile/PrivacyPolicyScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 30 | ‹ Back | onPress | Pending |

### src/screens/profile/ProfileScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 390 | Delete | onPress | Pending |
| 405 | Pressable (dynamic/unlabelled) | onPress | Pending |
| 410 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 412 | Delete | onPress | Pending |
| 419 | A photo or video could not load. Tap to retry. | onPress | Pending |
| 425 | Pressable (dynamic/unlabelled) | onPress | Pending |
| 489 | Retry profile | onPress | Pending |
| 498 | ScrollView (dynamic/unlabelled) | onScroll | Pending |
| 498 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 499 | ProfileHeader (dynamic/unlabelled) | onEdit | Pending |
| 517 | Retry posts | onPress | Pending |
| 520 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 527 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 529 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 530 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/profile/RestrictedAccountsScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 66 | Unrestrict | onPress | Pending |
| 85 | Go back | onPress | Pending |
| 103 | Try again | onPress | Pending |
| 122 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 138 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/profile/SettingsScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 59 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 190 | Switch (dynamic/unlabelled) | onValueChange | Pending |
| 245 | Unlink | onPress | Pending |
| 260 | Immediately | onPress | Pending |
| 261 | After 1 minute | onPress | Pending |
| 262 | After 5 minutes | onPress | Pending |
| 263 | After 15 minutes | onPress | Pending |
| 276 | 10 pm to 7 am | onPress | Pending |
| 277 | 11 pm to 8 am | onPress | Pending |
| 278 | Midnight to 9 am | onPress | Pending |
| 279 | Off | onPress | Pending |
| 285 | Follow my phone | onPress | Pending |
| 286 | Light | onPress | Pending |
| 287 | Dim | onPress | Pending |
| 288 | Lights out | onPress | Pending |
| 311 | Show | onPress | Pending |
| 312 | Blur until I tap | onPress | Pending |
| 313 | Hide | onPress | Pending |
| 444 | Sign Out | onPress | Pending |
| 455 | Switch Account | onPress | Pending |
| 466 | Deactivate | onPress | Pending |
| 516 | ‹ Back | onPress | Pending |
| 521 | Exit settings to your profile | onPress | Pending |
| 527 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 565 | Search settings | onChangeText | Pending |
| 568 | Clear settings search | onPress | Pending |
| 580 | Row (dynamic/unlabelled) | onPress | Pending |
| 592 | Cancel Change Password Your new password must be at least 8 characters. You will remain signed in after changing it. Current password New password Confirm New Password | onRequestClose | Pending |
| 596 | Cancel | onPress | Pending |
| 598 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 609 | Current password | onChangeText | Pending |
| 613 | Enter new password | onChangeText | Pending |
| 614 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 631 | Confirm new password | onChangeText | Pending |
| 632 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 635 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 647 | Cancel Account type Switch any time; nothing is deleted. Business opens the Studio on this account. Verification is applied for separately, under Verification. | onRequestClose | Pending |
| 650 | Cancel | onPress | Pending |
| 657 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 668 | Cancel Privacy Profile Visibility Control who can see your profile information on PlatinumCircles. | onRequestClose | Pending |
| 672 | Cancel | onPress | Pending |
| 674 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 685 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 710 | Cancel Delete Account This action is permanent Your account and app records will be deleted. This cannot be undone. Uploaded files are not automatically erased by this action. Cont | onRequestClose | Pending |
| 714 | Cancel | onPress | Pending |
| 727 | DELETE | onChangeText | Pending |
| 728 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 738 | LinkIntoBankSheet (dynamic/unlabelled) | onClose | Pending |

### src/screens/profile/TermsScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 30 | ‹ Back | onPress | Pending |

### src/screens/profile/TicketScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 69 | ‹ Back | onPress | Pending |
| 90 | TextInput (dynamic/unlabelled) | onChangeText | Pending |
| 91 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/profile/TwoFactorScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 100 | Back | onPress | Pending |
| 106 | Retry | onPress | Pending |
| 110 | Authenticator code | onChangeText | Pending |
| 111 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 112 | Cancel | onPress | Pending |
| 120 | 6-digit code | onChangeText | Pending |
| 121 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 122 | Cancel | onPress | Pending |
| 134 | Turn off | onPress | Pending |
| 136 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/profile/UserProfileScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 121 | Restrict | onPress | Pending |
| 127 | Report impersonation | onPress | Pending |
| 134 | Block | onPress | Pending |
| 140 | Dynamic confirmation | onPress | Pending |
| 141 | Report or block | onPress | Pending |
| 230 | Block | onPress | Pending |
| 288 | Retry profile | onPress | Pending |
| 289 | Go back | onPress | Pending |
| 300 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 309 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 312 | ProfileHeader (dynamic/unlabelled) | onEdit | Pending |
| 337 | More options | onPress | Pending |
| 338 | Message | onPress | Pending |
| 348 | Vouch for this member | onPress | Pending |
| 362 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 377 | Retry profile | onPress | Pending |
| 431 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 434 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 444 | Delete | onPress | Pending |
| 467 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 468 | A photo or video could not load. Tap to retry. | onPress | Pending |

### src/screens/profile/YourActivityScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 59 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 65 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 72 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/stories/MemoryArrangementScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 714 | Go back | onPress | Pending |
| 821 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 853 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 876 | Swap | onPress | Pending |
| 886 | Done | onPress | Pending |

### src/screens/stories/StoryBoomerangScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 28 | Go back | onPress | Pending |
| 105 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 105 | Close Boomerang | onPress | Pending |
| 112 | BoomerangWeb (dynamic/unlabelled) | onDone | Pending |
| 115 | Close Boomerang | onPress | Pending |
| 115 | Switch camera | onPress | Pending |
| 117 | Try again | onPress | Pending |
| 117 | Retake | onPress | Pending |
| 117 | Go back | onPress | Pending |
| 118 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 118 | Capture Boomerang | onPress | Pending |

### src/screens/stories/StoryCameraScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 83 | Create with text | onPress | Pending |
| 447 | Allow camera | onPress | Pending |
| 450 | Go back | onPress | Pending |
| 482 | Close story camera | onPress | Pending |
| 486 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 497 | Hands-free recording | onPress | Pending |
| 500 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 507 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 509 | Choose story photo or video | onPress | Pending |
| 541 | Switch story camera | onPress | Pending |
| 548 | TEXT | onPress | Pending |
| 555 | DUAL | onPress | Pending |
| 558 | LENSES | onPress | Pending |
| 561 | LAYOUT | onPress | Pending |
| 564 | BOOM | onPress | Pending |

### src/screens/stories/StoryComposerScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 143 | PollDragWrap (dynamic/unlabelled) | onChange | Pending |
| 146 | MediaCanvas (dynamic/unlabelled) | onRetry | Pending |
| 224 | DraggableSticker (dynamic/unlabelled) | onDragEnd, onDragStart | Pending |
| 674 | Choose from library | onPress | Pending |
| 675 | Take a photo | onPress | Pending |
| 677 | Remove cell | onPress | Pending |
| 853 | Bring forward | onPress | Pending |
| 853 | Send backward | onPress | Pending |
| 853 | Remove card | onPress | Pending |
| 1020 | SaveToMemorySheet (dynamic/unlabelled) | onClose | Pending |
| 1025 | Go back | onPress | Pending |
| 1078 | Cancel Poll Done Preview Cancel Link Add Cancel Location Cancel Mention people On the story Hidden Let them add this to their story Cancel Done Preview Type something... Viewers an | onPress | Pending |
| 1090 | ComposerStickerOverlay (dynamic/unlabelled) | onDragEnd | Pending |
| 1092 | PollDragWrap (dynamic/unlabelled) | onChange | Pending |
| 1095 | MediaCanvas (dynamic/unlabelled) | onRetry | Pending |
| 1112 | ComposerStickerOverlay (dynamic/unlabelled) | onDragEnd | Pending |
| 1114 | PollDragWrap (dynamic/unlabelled) | onChange | Pending |
| 1157 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1168 | DualArrangementOverlay (dynamic/unlabelled) | onDone | Pending |
| 1178 | Close story editor | onPress | Pending |
| 1187 | Undo story edit | onPress | Pending |
| 1190 | Redo story edit | onPress | Pending |
| 1198 | StoryAudienceSheet (dynamic/unlabelled) | onClose, onChange | Pending |
| 1202 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1206 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1207 | Add story clips | onPress | Pending |
| 1208 | Choose story audience | onPress | Pending |
| 1211 | Add story text | onPress | Pending |
| 1212 | Open story stickers | onPress | Pending |
| 1213 | Choose story music or original audio | onPress | Pending |
| 1213 | Adjust original video sound | onPress | Pending |
| 1214 | Edit story media | onPress | Pending |
| 1215 | Review story before sharing | onPress | Pending |
| 1220 | StoryTimingPanel (dynamic/unlabelled) | onClose | Pending |
| 1222 | Back to story editing | onPress | Pending |
| 1227 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1228 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1229 | More audience options | onPress | Pending |
| 1230 | Allow story replies | onValueChange | Pending |
| 1231 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1233 | Story caption | onChangeText | Pending |
| 1236 | Publish story | onPress | Pending |
| 1241 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 1244 | StoryTextEditorToolbar (dynamic/unlabelled) | onClose, onSave, onDelete | Pending |
| 1258 | Type here | onChangeText | Pending |
| 1264 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1267 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1272 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1272 | Text size | onChange | Pending |
| 1275 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1279 | % | onPress | Pending |
| 1284 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1289 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1289 | Align | onPress | Pending |
| 1296 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1298 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1302 | Always | onPress | Pending |
| 1312 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 1313 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1317 | Duplicate | onPress | Pending |
| 1318 | Remove | onPress | Pending |
| 1320 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1326 | Cancel Poll Done Preview | onRequestClose | Pending |
| 1327 | Cancel Poll Done Preview | onPress | Pending |
| 1327 | Cancel Poll Done Preview | onPress | Pending |
| 1330 | Cancel | onPress | Pending |
| 1330 | Done | onPress | Pending |
| 1341 | Ask a question... | onChangeText | Pending |
| 1342 | TextInput (dynamic/unlabelled) | onChangeText | Pending |
| 1342 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1343 | Add option | onPress | Pending |
| 1350 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1351 | MusicSheet (dynamic/unlabelled) | onClose, onSelect, onRemove | Pending |
| 1352 | FilterPickerSheet (dynamic/unlabelled) | onClose, onSelect | Pending |
| 1353 | AdjustPanel (dynamic/unlabelled) | onClose, onChange | Pending |
| 1354 | BackgroundSheet (dynamic/unlabelled) | onClose, onChange | Pending |
| 1355 | AudioMixSheet (dynamic/unlabelled) | onClose, onChange | Pending |
| 1356 | EntitySheet (dynamic/unlabelled) | onClose, onPick | Pending |
| 1357 | GifPickerLite (dynamic/unlabelled) | onClose, onSelect | Pending |
| 1359 | VideoTrimmer (dynamic/unlabelled) | onChange, onDone | Pending |
| 1362 | DrawSurface (dynamic/unlabelled) | onChange, onDone | Pending |
| 1365 | PreviewChrome (dynamic/unlabelled) | onClose | Pending |
| 1368 | StudioSheet (dynamic/unlabelled) | onClose | Pending |
| 1371 | Remove poll | onPress | Pending |
| 1382 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1395 | Cancel Link Add | onRequestClose | Pending |
| 1396 | Cancel Link Add | onPress | Pending |
| 1396 | Cancel Link Add | onPress | Pending |
| 1399 | Cancel | onPress | Pending |
| 1399 | Add | onPress | Pending |
| 1400 | Label (e.g. My website) | onChangeText | Pending |
| 1401 | https://... | onChangeText | Pending |
| 1408 | Cancel Location | onRequestClose | Pending |
| 1409 | Cancel Location | onPress | Pending |
| 1409 | Cancel Location | onPress | Pending |
| 1412 | Cancel | onPress | Pending |
| 1413 | Search a place... | onChangeText | Pending |
| 1418 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1432 | Cancel Mention people On the story Hidden Let them add this to their story | onRequestClose | Pending |
| 1433 | Cancel Mention people On the story Hidden Let them add this to their story | onPress | Pending |
| 1433 | Cancel Mention people On the story Hidden Let them add this to their story | onPress | Pending |
| 1437 | Cancel | onPress | Pending |
| 1439 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1443 | Search people... | onChangeText | Pending |
| 1447 | @ | onPress | Pending |
| 1458 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1469 | On the story | onPress | Pending |
| 1470 | Hidden | onPress | Pending |
| 1475 | Switch (dynamic/unlabelled) | onValueChange | Pending |
| 1481 | @ | onPress | Pending |
| 1495 | Cancel Done Preview Type something... Viewers answer privately. You see the answers. /120 | onRequestClose | Pending |
| 1496 | Cancel Done Preview Type something... Viewers answer privately. You see the answers. /120 | onPress | Pending |
| 1496 | Cancel Done Preview Type something... Viewers answer privately. You see the answers. /120 | onPress | Pending |
| 1499 | Cancel | onPress | Pending |
| 1499 | Done | onPress | Pending |
| 1507 | Ask me anything... | onChangeText | Pending |
| 1514 | Add to story | onRequestClose | Pending |
| 1516 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1521 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1524 | TextInput (dynamic/unlabelled) | onChangeText | Pending |
| 1526 | Link, e.g. example.org/donate | onChangeText | Pending |
| 1527 | Add to story | onPress | Pending |
| 1531 | Cancel Countdown Done Ends Quick pick Viewers can tap the sticker to get a reminder when it ends. | onRequestClose | Pending |
| 1532 | Cancel Countdown Done Ends Quick pick Viewers can tap the sticker to get a reminder when it ends. | onPress | Pending |
| 1532 | Cancel Countdown Done Ends Quick pick Viewers can tap the sticker to get a reminder when it ends. | onPress | Pending |
| 1535 | Cancel | onPress | Pending |
| 1535 | Done | onPress | Pending |
| 1536 | What are you counting down to? | onChangeText | Pending |
| 1542 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1549 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1558 | Cancel Hashtag Done Preview Letters, numbers and underscores. Viewers tap it to see the tag. | onRequestClose | Pending |
| 1559 | Cancel Hashtag Done Preview Letters, numbers and underscores. Viewers tap it to see the tag. | onPress | Pending |
| 1559 | Cancel Hashtag Done Preview Letters, numbers and underscores. Viewers tap it to see the tag. | onPress | Pending |
| 1562 | Cancel | onPress | Pending |
| 1562 | Done | onPress | Pending |
| 1567 | #harare | onChangeText | Pending |
| 1573 | Cancel Done Preview Emoji | onRequestClose | Pending |
| 1574 | Cancel Done Preview Emoji | onPress | Pending |
| 1574 | Cancel Done Preview Emoji | onPress | Pending |
| 1577 | Cancel | onPress | Pending |
| 1577 | Done | onPress | Pending |
| 1588 | How much do you love...? | onChangeText | Pending |
| 1592 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1594 | + | onChangeText | Pending |
| 1601 | Cancel Done Tap the circle to mark the correct answer | onRequestClose | Pending |
| 1602 | Cancel Done Tap the circle to mark the correct answer | onPress | Pending |
| 1602 | Cancel Done Tap the circle to mark the correct answer | onPress | Pending |
| 1605 | Cancel | onPress | Pending |
| 1605 | Done | onPress | Pending |
| 1607 | Quiz question... | onChangeText | Pending |
| 1610 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1611 | TextInput (dynamic/unlabelled) | onChangeText | Pending |
| 1612 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1615 | Add option | onPress | Pending |

### src/screens/stories/StoryCreationMenuScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 52 | Pressable (dynamic/unlabelled) | onPress | Pending |
| 241 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 253 | Text | onPress | Pending |
| 256 | Photo | onPress | Pending |
| 259 | Video | onPress | Pending |
| 262 | Camera | onPress | Pending |
| 265 | Dual | onPress | Pending |
| 268 | Layout | onPress | Pending |

### src/screens/stories/StoryDualCaptureScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 149 | Open settings | onPress | Pending |
| 419 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 422 | Go Back | onPress | Pending |
| 517 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 538 | Photo | onPress | Pending |
| 541 | Video | onPress | Pending |
| 548 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 560 | Try again | onPress | Pending |
| 561 | Go back | onPress | Pending |

### src/screens/stories/StoryFunCameraScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 72 | Go back | onPress | Pending |
| 401 | Allow camera | onPress | Pending |
| 449 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 453 | Flip camera | onPress | Pending |
| 458 | Platinum effects | onPress | Pending |
| 461 | Snapchat lenses | onPress | Pending |
| 470 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 472 | All effects | onPress | Pending |
| 479 | Retry lenses | onPress | Pending |
| 479 | Use effects | onPress | Pending |
| 482 | Search available Snapchat lenses | onChangeText | Pending |
| 482 | Clear lens search | onPress | Pending |
| 483 | None | onPress | Pending |
| 490 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 504 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 522 | FilterPickerSheet (dynamic/unlabelled) | onClose, onSelect | Pending |

### src/screens/stories/StoryLayoutScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 95 | Change | onPress | Pending |
| 118 | Open settings | onPress | Pending |
| 144 | Take a photo | onPress | Pending |
| 145 | Dynamic confirmation | onPress | Pending |
| 173 | Close | onPress | Pending |
| 175 | Continue | onPress | Pending |
| 201 | Take a photo into the next slot | onPress | Pending |
| 204 | Choose photos from the library | onPress | Pending |
| 213 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |

### src/screens/stories/StoryViewerScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 180 | Close | onPress | Pending |
| 537 | Delete | onPress | Pending |
| 690 | Text on a colour | onPress | Pending |
| 691 | Choose a photo | onPress | Pending |
| 692 | Take a photo | onPress | Pending |
| 693 | Cancel | onPress | Pending |
| 816 | Return | onPress | Pending |
| 835 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 846 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 880 | Media unavailable. Tap to retry. | onPress | Pending |
| 888 | Responses could not load. Tap to retry. | onPress | Pending |
| 891 | IdentityPresence (dynamic/unlabelled) | onDelete, onClose | Pending |
| 896 | Story options | onPress | Pending |
| 907 | StoryOptionsSheet (dynamic/unlabelled) | onClose | Pending |
| 920 | ImmersiveReplyField (dynamic/unlabelled) | onChangeText | Pending |
| 925 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 925 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 928 | StorySettingsSheet (dynamic/unlabelled) | onClose, onChange | Pending |
| 940 | Story activity Views Reactions Audience Story settings | onRequestClose, onDismiss | Pending |
| 941 | Story activity Views Reactions Audience Story settings | onPress | Pending |
| 944 | Close story activity | onPress | Pending |
| 950 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 951 | Retry | onPress | Pending |
| 953 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 958 | Story settings | onPress | Pending |
| 963 | Modal (dynamic/unlabelled) | onRequestClose | Pending |
| 964 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 967 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 970 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 980 | All caught up You've seen every moment | onPress | Pending |
| 986 | SaveToMemorySheet (dynamic/unlabelled) | onClose | Pending |
| 987 | ManageMentionsSheet (dynamic/unlabelled) | onClose | Pending |
| 988 | QUESTION | onRequestClose | Pending |
| 990 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 994 | Type your answer | onChangeText | Pending |
| 996 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 1000 | AddYoursThreadSheet (dynamic/unlabelled) | onClose, onOpen | Pending |
| 1001 | StickerResponsesSheet (dynamic/unlabelled) | onClose | Pending |

### src/screens/studio/StudioHiringAdsSegs.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 59 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 72 | Cancel | onRequestClose | Pending |
| 75 | Cancel | onPress | Pending |
| 77 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 188 | Dynamic confirmation | onPress | Pending |
| 201 | Confirm | onPress | Pending |
| 205 | More | onBack | Pending |
| 211 | Jobs | onBack | Pending |
| 213 | All | onPress | Pending |
| 215 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 220 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 221 | Try again | onPress | Pending |
| 223 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 225 | Applied | onPress | Pending |
| 239 | Sheet (dynamic/unlabelled) | onClose | Pending |
| 251 | Move stage | onPress | Pending |
| 252 | Profile | onPress | Pending |
| 253 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 254 | Portfolio | onPress | Pending |
| 255 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 257 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 262 | YYYY-MM-DD HH:mm | onChangeText | Pending |
| 263 | Location or link | onChangeText | Pending |
| 265 | Schedule | onPress | Pending |
| 266 | Clear | onPress | Pending |
| 270 | senior, remote, shortlist | onChangeText | Pending |
| 271 | Save tags | onPress | Pending |
| 277 | Add a note for the team | onChangeText | Pending |
| 278 | Add note | onPress | Pending |
| 288 | More | onBack | Pending |
| 291 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 292 | Try again | onPress | Pending |
| 295 | total | onPress, onLongPress | Pending |
| 381 | End | onPress | Pending |
| 382 | Delete | onPress | Pending |
| 397 | Remove | onPress | Pending |
| 401 | More | onBack | Pending |
| 405 | More | onBack | Pending |
| 405 | Create campaign | onPress | Pending |
| 406 | Could not refresh campaigns. Tap to retry. | onPress | Pending |
| 409 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 419 | · views · clicks · ad | onPress | Pending |
| 428 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 437 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 438 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 445 | Name Objective Budget Paid with Schedule Add ads after saving. Submit for review once the campaign has a budget, a payment method and at least one ad. | onClose, onSave | Pending |
| 447 | Spring launch | onChangeText | Pending |
| 450 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 454 | TextInput (dynamic/unlabelled) | onChangeText | Pending |
| 455 | 0 | onChangeText | Pending |
| 459 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 462 | Start YYYY-MM-DD HH:mm | onChangeText | Pending |
| 463 | End YYYY-MM-DD HH:mm | onChangeText | Pending |
| 467 | Sheet (dynamic/unlabelled) | onClose | Pending |
| 468 | StudioLoadError (dynamic/unlabelled) | onRetry | Pending |
| 472 | likes | onPress | Pending |

### src/screens/studio/StudioMoreSegs.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 43 | More | onPress | Pending |
| 67 | Monetization Eligibility, earnings and payout status | onPress | Pending |
| 70 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 106 | Reviews | onBack | Pending |
| 106 | StudioLoadError (dynamic/unlabelled) | onRetry | Pending |
| 111 | Reviews | onBack | Pending |
| 112 | StudioLoadError (dynamic/unlabelled) | onRetry | Pending |
| 116 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 157 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 164 | Cancel Reply to Send | onRequestClose | Pending |
| 167 | Cancel | onPress | Pending |
| 169 | Send | onPress | Pending |
| 173 | Write a public reply | onChangeText | Pending |
| 174 | Remove reply | onPress | Pending |
| 224 | Audience | onBack | Pending |
| 225 | StudioLoadError (dynamic/unlabelled) | onRetry | Pending |
| 243 | Search followers | onChangeText | Pending |
| 244 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 247 | All | onPress | Pending |
| 249 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 258 | TouchableOpacity (dynamic/unlabelled) | onPress, onLongPress | Pending |
| 268 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 306 | Remove | onPress | Pending |
| 325 | Commerce | onBack | Pending |
| 326 | StudioLoadError (dynamic/unlabelled) | onRetry | Pending |
| 329 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 337 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 342 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 360 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 364 | · sold · in post | onPress | Pending |

### src/screens/studio/StudioScreen.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 84 | StudioLoadError (dynamic/unlabelled) | onRetry | Pending |
| 93 | Open Settings | onPress | Pending |
| 94 | Part of a team? Sign in to the business | onPress | Pending |
| 107 | ACCESS CODE | onChangeText | Pending |
| 108 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 129 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 135 | ReviewsSeg (dynamic/unlabelled) | onBack | Pending |
| 135 | AudienceSeg (dynamic/unlabelled) | onBack | Pending |
| 135 | CommerceSeg (dynamic/unlabelled) | onBack | Pending |
| 135 | RecruiterSeg (dynamic/unlabelled) | onBack | Pending |
| 135 | AdsSeg (dynamic/unlabelled) | onBack | Pending |
| 145 | StudioLoadError (dynamic/unlabelled) | onRetry | Pending |
| 162 | RefreshControl (dynamic/unlabelled) | onRefresh | Pending |
| 163 | StudioLoadError (dynamic/unlabelled) | onRetry | Pending |
| 169 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 189 | views · likes · comments · reposts | onPress | Pending |
| 235 | Dynamic confirmation | onPress | Pending |
| 259 | StudioLoadError (dynamic/unlabelled) | onRetry | Pending |
| 263 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 267 | Done | onPress | Pending |
| 273 | TouchableOpacity (dynamic/unlabelled) | onPress, onLongPress | Pending |
| 285 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 411 | Delete | onPress | Pending |
| 426 | StudioLoadError (dynamic/unlabelled) | onRetry | Pending |
| 430 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 433 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 437 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 439 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 453 | Cancel Save draft Media Products Category Schedule Schedule | onRequestClose | Pending |
| 457 | Cancel | onPress | Pending |
| 459 | Save draft | onPress | Pending |
| 462 | What do you want to say? | onChangeText | Pending |
| 468 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 474 | Media | onPress | Pending |
| 475 | Products | onPress | Pending |
| 479 | StudioLoadError (dynamic/unlabelled) | onRetry | Pending |
| 482 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 494 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 501 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 503 | YYYY-MM-DD HH:MM | onChangeText | Pending |
| 506 | Schedule | onPress | Pending |
| 507 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 525 | StudioLoadError (dynamic/unlabelled) | onRetry | Pending |
| 537 | StudioLoadError (dynamic/unlabelled) | onRetry | Pending |
| 539 | days | onPress | Pending |
| 579 | views · likes · comments · reposts | onPress | Pending |
| 629 | Dynamic confirmation | onPress | Pending |
| 644 | StudioLoadError (dynamic/unlabelled) | onRetry | Pending |
| 649 | StudioLoadError (dynamic/unlabelled) | onRetry | Pending |
| 651 | What you do, in two lines | onChangeText | Pending |
| 653 | TextInput (dynamic/unlabelled) | onChangeText | Pending |
| 656 | Save details | onPress | Pending |
| 660 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 670 | Person's name | onChangeText | Pending |
| 671 | Issue code | onPress | Pending |
| 678 | Dismiss | onPress | Pending |
| 690 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 691 | TouchableOpacity (dynamic/unlabelled) | onPress | Pending |
| 691 | Remove | onPress | Pending |

### web/app/[username]/follows/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 137 | Back to profile | href | Pending |
| 142 | button (dynamic/unlabelled) | onClick | Pending |
| 150 | Search loaded connections | onChange | Pending |
| 152 | Clear search | onClick | Pending |
| 156 | Try again | onClick | Pending |
| 169 | Link (dynamic/unlabelled) | href | Pending |
| 186 | Remove follower | onClick | Pending |
| 193 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/[username]/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 54 | Open Platinum Circles | href | Pending |
| 80 | Back to Platinum Circles | href | Pending |
| 135 | a (dynamic/unlabelled) | href | Pending |
| 146 | Followers | href | Pending |
| 154 | Following | href | Pending |

### web/app/about/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 12 | Settings | href | Pending |

### web/app/ads/new/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 138 | Back to Ads | href | Pending |
| 151 | button (dynamic/unlabelled) | onClick | Pending |
| 171 | Link (dynamic/unlabelled) | href | Pending |
| 182 | Write the ad text | onChange, onFocus | Pending |
| 196 | button (dynamic/unlabelled) | onClick | Pending |
| 207 | Load more posts | onClick | Pending |
| 215 | button (dynamic/unlabelled) | onClick | Pending |
| 231 | Load more products | onClick | Pending |
| 237 | button (dynamic/unlabelled) | onClick | Pending |
| 252 | Load more jobs | onClick | Pending |
| 269 | button (dynamic/unlabelled) | onClick | Pending |
| 277 | e.g. 5000, the promotion stops itself there | onChange | Pending |
| 320 | Back | onClick | Pending |
| 323 | Continue | onClick | Pending |
| 327 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/ads/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 163 | Try again | onClick | Pending |
| 188 | button (dynamic/unlabelled) | onClick | Pending |
| 189 | Create an ad | href | Pending |
| 192 | Campaigns with budgets, in Studio | href | Pending |
| 199 | Back to the feed | href | Pending |
| 203 | Create a promotion | href | Pending |
| 205 | Try again | onClick | Pending |
| 210 | No campaigns yet | action | Pending |
| 245 | Open the promoted post | href | Pending |
| 250 | Stop showing this ad, keep its numbers | onClick | Pending |
| 252 | Start showing this ad again | onClick | Pending |
| 255 | Finish this ad for good | onClick | Pending |

### web/app/archive/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 74 | Back | onClick | Pending |
| 76 | New story | href | Pending |
| 79 | Retry | onClick | Pending |
| 86 | Link (dynamic/unlabelled) | href | Pending |
| 95 | Delete draft | onClick | Pending |
| 111 | button (dynamic/unlabelled) | onClick | Pending |
| 123 | Add to memory album | onClick | Pending |
| 127 | Delete story | onClick | Pending |
| 137 | div (dynamic/unlabelled) | onClick | Pending |
| 139 | div (dynamic/unlabelled) | onClick | Pending |

### web/app/business-login/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 73 | Business handle | onChange | Pending |
| 79 | Your access code | onChange, onKeyDown | Pending |
| 87 | button (dynamic/unlabelled) | onClick | Pending |
| 99 | Sign in here | href | Pending |

### web/app/businesses/apply/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 105 | Settings | href | Pending |
| 109 | Company or business name | onChange | Pending |
| 110 | What industry (e.g. Fintech, Retail, Media) | onChange | Pending |
| 111 | What the business does, who runs it, and why it belongs on Platinum Circles | onChange | Pending |
| 112 | Business contact email | onChange | Pending |
| 113 | Business phone (optional) | onChange | Pending |
| 114 | Website (optional) | onChange | Pending |
| 115 | Registration or license details (optional) | onChange | Pending |
| 116 | Desired @ for the business | onChange | Pending |
| 119 | button (dynamic/unlabelled) | onClick | Pending |
| 128 | Open business | onClick | Pending |

### web/app/businesses/new/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 61 | Businesses | href | Pending |
| 62 | button (dynamic/unlabelled) | onClick | Pending |
| 68 | Pearl Group | onChange | Pending |
| 73 | pearlgroup | onChange | Pending |
| 81 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/businesses/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 28 | New | href | Pending |
| 38 | Create a business | href | Pending |
| 41 | · team · posts | href | Pending |

### web/app/calls/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 77 | Back to Messages | href | Pending |
| 104 | Voice call | onClick | Pending |
| 105 | Video call | onClick | Pending |

### web/app/channels/[id]/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 412 | Back | href | Pending |
| 424 | Channel settings | onClick | Pending |
| 429 | ErrorState (dynamic/unlabelled) | onRetry | Pending |
| 430 | button (dynamic/unlabelled) | onClick | Pending |
| 464 | Attachment unavailable. Retry | onClick | Pending |
| 472 | button (dynamic/unlabelled) | onClick | Pending |
| 488 | button (dynamic/unlabelled) | onClick | Pending |
| 494 | button (dynamic/unlabelled) | onClick | Pending |
| 497 | button (dynamic/unlabelled) | onClick | Pending |
| 512 | More replies | onClick | Pending |
| 515 | Reply | onChange, onKeyDown | Pending |
| 518 | Send reply | onClick | Pending |
| 536 | Post a prompt | onClick | Pending |
| 537 | Create a poll | onClick | Pending |
| 538 | Attach a photo or video | onClick | Pending |
| 539 | input (dynamic/unlabelled) | onChange | Pending |
| 540 | input (dynamic/unlabelled) | onChange, onKeyDown | Pending |
| 544 | Post | onClick | Pending |
| 550 | Join channel | onClick | Pending |
| 557 | New poll Runs for | onClick | Pending |
| 558 | New poll Runs for | onClick | Pending |
| 561 | Close | onClick | Pending |
| 563 | Ask a question | onChange | Pending |
| 567 | input (dynamic/unlabelled) | onChange | Pending |
| 571 | Remove option | onClick | Pending |
| 576 | Add option | onClick | Pending |
| 581 | button (dynamic/unlabelled) | onClick | Pending |
| 587 | button (dynamic/unlabelled) | onClick | Pending |
| 596 | ChannelSettings (dynamic/unlabelled) | onClose | Pending |
| 751 | Channel settings | onClick | Pending |
| 752 | Channel settings | onClick | Pending |
| 755 | Close | onClick | Pending |
| 757 | Could not load channel settings | onRetry | Pending |
| 764 | Change the channel icon | onClick | Pending |
| 775 | input (dynamic/unlabelled) | onChange | Pending |
| 779 | input (dynamic/unlabelled) | onChange | Pending |
| 782 | What is it about? | onChange | Pending |
| 787 | button (dynamic/unlabelled) | onClick | Pending |
| 798 | input (dynamic/unlabelled) | onChange | Pending |
| 800 | button (dynamic/unlabelled) | onClick | Pending |
| 810 | button (dynamic/unlabelled) | onClick | Pending |
| 822 | Search people | onChange | Pending |
| 835 | Invite | onClick | Pending |
| 854 | Change role | onChange | Pending |

### web/app/channels/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 88 | New channel | onClick | Pending |
| 93 | Communities | href | Pending |
| 97 | Search channels | onChange | Pending |
| 99 | button (dynamic/unlabelled) | onClick | Pending |
| 110 | Link (dynamic/unlabelled) | href | Pending |
| 126 | Join | onClick | Pending |
| 136 | New channel | onClick | Pending |
| 137 | New channel | onClick | Pending |
| 140 | Close | onClick | Pending |
| 142 | Channel name | onChange | Pending |
| 144 | What is it about? (optional) | onChange | Pending |
| 148 | button (dynamic/unlabelled) | onClick | Pending |
| 155 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/communities/[id]/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 323 | Back | href | Pending |
| 326 | Join requests | onClick | Pending |
| 329 | Community chat | onClick | Pending |
| 332 | Invite people | onClick | Pending |
| 335 | Members | onClick | Pending |
| 338 | Settings | onClick | Pending |
| 340 | Leave | onClick | Pending |
| 355 | Part of | href | Pending |
| 360 | Accept | onClick | Pending |
| 361 | Decline | onClick | Pending |
| 366 | Requested | onClick | Pending |
| 370 | button (dynamic/unlabelled) | onClick | Pending |
| 378 | Community rules | onClick | Pending |
| 384 | Could not load this community | onRetry | Pending |
| 397 | Post an announcement | onClick | Pending |
| 401 | What should everyone know? | onChange, onKeyDown | Pending |
| 403 | Post | onClick | Pending |
| 409 | Remove | onClick | Pending |
| 419 | Link (dynamic/unlabelled) | href | Pending |
| 424 | Sub-group | onClick | Pending |
| 432 | Name | onChange | Pending |
| 433 | What is it for? | onChange | Pending |
| 436 | button (dynamic/unlabelled) | onClick | Pending |
| 439 | Create sub-group | onClick | Pending |
| 449 | Remove attachment | onClick | Pending |
| 453 | Attach a photo | onClick | Pending |
| 454 | input (dynamic/unlabelled) | onChange | Pending |
| 455 | Share with the community | onChange, onKeyDown | Pending |
| 459 | Post | onClick | Pending |
| 473 | Post actions | onClick | Pending |
| 480 | button (dynamic/unlabelled) | onClick | Pending |
| 482 | button (dynamic/unlabelled) | onClick | Pending |
| 494 | Members | onClick | Pending |
| 495 | Members | onClick | Pending |
| 497 | Blocked | onClick | Pending |
| 498 | Close | onClick | Pending |
| 513 | Member actions | onChange | Pending |
| 530 | Join requests | onClick | Pending |
| 531 | Join requests | onClick | Pending |
| 534 | Close | onClick | Pending |
| 546 | Approve | onClick | Pending |
| 547 | Deny | onClick | Pending |
| 556 | Invite people An invitation always admits, even when the community is invite only. Copy invite link New link | onClick | Pending |
| 557 | Invite people An invitation always admits, even when the community is invite only. Copy invite link New link | onClick | Pending |
| 560 | Close | onClick | Pending |
| 564 | Copy invite link | onClick | Pending |
| 565 | New link | onClick | Pending |
| 568 | Search people | onChange | Pending |
| 580 | Invite | onClick | Pending |
| 594 | Withdraw invitation | onClick | Pending |
| 603 | Blocked from rejoining | onClick | Pending |
| 604 | Blocked from rejoining | onClick | Pending |
| 607 | Close | onClick | Pending |
| 619 | Allow back | onClick | Pending |
| 628 | CommunitySettings (dynamic/unlabelled) | onClose | Pending |
| 681 | Community settings Delete community | onClick | Pending |
| 682 | Community settings Delete community | onClick | Pending |
| 685 | Close | onClick | Pending |
| 688 | Change the community icon | onClick | Pending |
| 699 | input (dynamic/unlabelled) | onChange | Pending |
| 701 | input (dynamic/unlabelled) | onChange | Pending |
| 703 | Description | onChange | Pending |
| 707 | button (dynamic/unlabelled) | onClick | Pending |
| 715 | button (dynamic/unlabelled) | onClick | Pending |
| 723 | button (dynamic/unlabelled) | onClick | Pending |
| 727 | Rules shown to people when they join | onChange | Pending |
| 729 | button (dynamic/unlabelled) | onClick | Pending |
| 733 | Delete community | onClick | Pending |

### web/app/communities/join/[token]/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 34 | Browse communities | href | Pending |
| 40 | Log in | href | Pending |

### web/app/communities/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 92 | New community | onClick | Pending |
| 96 | Channels | href | Pending |
| 101 | Search communities | onChange | Pending |
| 103 | button (dynamic/unlabelled) | onClick | Pending |
| 114 | Link (dynamic/unlabelled) | href | Pending |
| 133 | Accept invite | onClick | Pending |
| 139 | button (dynamic/unlabelled) | onClick | Pending |
| 147 | New community Who can join Category Cover color | onClick | Pending |
| 148 | New community Who can join Category Cover color | onClick | Pending |
| 151 | Close | onClick | Pending |
| 153 | Community name | onChange | Pending |
| 155 | What is it about? (optional) | onChange | Pending |
| 160 | button (dynamic/unlabelled) | onClick | Pending |
| 169 | button (dynamic/unlabelled) | onClick | Pending |
| 178 | button (dynamic/unlabelled) | onClick | Pending |
| 182 | Rules shown to people when they join (optional) | onChange | Pending |
| 185 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/discover/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 50 | Could not load trending creators | onRetry | Pending |
| 56 | Trending creators | action | Pending |
| 61 | Link (dynamic/unlabelled) | href | Pending |
| 93 | form (dynamic/unlabelled) | onSubmit | Pending |
| 98 | Search Discover | onChange | Pending |

### web/app/error.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 24 | Try again | onClick | Pending |
| 30 | Back to home | href | Pending |

### web/app/explore/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 91 | · | href | Pending |
| 107 | Link (dynamic/unlabelled) | href | Pending |
| 120 | See all | href | Pending |
| 129 | See all | href | Pending |
| 131 | Link (dynamic/unlabelled) | href | Pending |

### web/app/forgot-password/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 41 | Enter the email address for your account. Email address | onSubmit | Pending |
| 44 | input (dynamic/unlabelled) | onChange | Pending |
| 48 | button (dynamic/unlabelled) | submit | Pending |
| 54 | Back to sign in | href | Pending |

### web/app/global-error.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 9 | Try again | onClick | Pending |

### web/app/jobs/[id]/applicants/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 126 | Back to jobs | href | Pending |
| 133 | ← | href | Pending |
| 138 | button (dynamic/unlabelled) | onClick | Pending |
| 147 | Retry | onClick | Pending |
| 159 | Link (dynamic/unlabelled) | href | Pending |
| 170 | Link (dynamic/unlabelled) | href | Pending |
| 175 | select (dynamic/unlabelled) | onChange | Pending |
| 192 | Message | onClick | Pending |
| 202 | Portfolio | href | Pending |
| 215 | Reschedule interview | onClick | Pending |
| 216 | Cancel interview | onClick | Pending |
| 226 | input (dynamic/unlabelled) | onChange | Pending |
| 227 | Location or link | onChange | Pending |
| 229 | Schedule interview | onClick | Pending |
| 238 | Cancel | onClick | Pending |
| 247 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/jobs/[id]/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 64 | Browse jobs | href | Pending |
| 89 | Back to Jobs | href | Pending |
| 120 | Manage applicants | href | Pending |
| 145 | Posted this role · @ | href | Pending |
| 169 | Link (dynamic/unlabelled) | href | Pending |

### web/app/jobs/applications/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 101 | ← Jobs | href | Pending |
| 103 | Filter applications by status | onChange | Pending |
| 107 | Refresh | onClick | Pending |
| 109 | Retry | onClick | Pending |
| 111 | Sign in | href | Pending |
| 121 | Applied | href | Pending |
| 133 | button (dynamic/unlabelled) | onClick | Pending |
| 134 | Keep application | onClick | Pending |
| 136 | Withdraw application | onClick | Pending |
| 142 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/jobs/error.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 10 | Try again | onClick | Pending |
| 11 | Back to jobs | href | Pending |

### web/app/jobs/new/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 87 | ← Jobs | href | Pending |
| 91 | Job title | onChange | Pending |
| 92 | Company | onChange | Pending |
| 93 | Location (city) | onChange | Pending |
| 94 | Job description | onChange | Pending |
| 96 | Job type | onChange | Pending |
| 99 | Work mode | onChange | Pending |
| 104 | Experience level | onChange | Pending |
| 111 | Salary range | onChange | Pending |
| 112 | Industry (optional) | onChange | Pending |
| 113 | Benefits (optional) | onChange | Pending |
| 114 | External apply URL (optional) | onChange | Pending |
| 117 | input (dynamic/unlabelled) | onChange | Pending |
| 121 | input (dynamic/unlabelled) | onChange | Pending |
| 124 | input (dynamic/unlabelled) | onChange | Pending |
| 128 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/jobs/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 129 | Job messages | href | Pending |
| 130 | My applications | href | Pending |
| 131 | Saved jobs | href | Pending |
| 132 | Post a job | href | Pending |
| 138 | Search jobs | onChange | Pending |
| 148 | button (dynamic/unlabelled) | onClick | Pending |
| 155 | Sort jobs | onChange | Pending |
| 167 | button (dynamic/unlabelled) | onClick | Pending |
| 179 | Try again | onClick | Pending |
| 181 | Browse all jobs | onClick | Pending |

### web/app/jobs/saved/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 48 | ← Jobs | href | Pending |
| 54 | Try again | onClick | Pending |

### web/app/login/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 58 | Forgot password New here? Create an account Business sign-in | onSubmit | Pending |
| 61 | Username or email | onChange | Pending |
| 70 | Password | onChange | Pending |
| 80 | Forgot password | href | Pending |
| 81 | button (dynamic/unlabelled) | submit | Pending |
| 91 | Create an account | href | Pending |
| 92 | Business sign-in | href | Pending |

### web/app/market/[id]/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 119 | Retry | onClick | Pending |
| 125 | Back to Market | href | Pending |
| 136 | Back to Market | href | Pending |
| 155 | img (dynamic/unlabelled) | onClick | Pending |
| 174 | Mark as sold | onClick | Pending |
| 180 | button (dynamic/unlabelled) | onClick | Pending |
| 183 | Share | onClick | Pending |
| 191 | Message seller | onClick | Pending |
| 194 | Make offer | onClick | Pending |
| 199 | button (dynamic/unlabelled) | onClick | Pending |
| 202 | Share | onClick | Pending |
| 210 | input (dynamic/unlabelled) | onChange | Pending |
| 216 | button (dynamic/unlabelled) | onClick | Pending |
| 229 | Link (dynamic/unlabelled) | href | Pending |
| 246 | Report listing | onClick | Pending |
| 247 | Block seller | onClick | Pending |
| 250 | MarketReportForm (dynamic/unlabelled) | onClose | Pending |

### web/app/market/new/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 136 | Back to Market | href | Pending |
| 144 | ← Market | href | Pending |
| 153 | button (dynamic/unlabelled) | onClick | Pending |
| 159 | Add photos | onClick | Pending |
| 164 | input (dynamic/unlabelled) | onChange | Pending |
| 168 | Title | onChange | Pending |
| 169 | Describe the item, its condition, what is included | onChange | Pending |
| 171 | button (dynamic/unlabelled) | onClick | Pending |
| 174 | Price. Use 0 for free | onChange | Pending |
| 177 | select (dynamic/unlabelled) | onChange | Pending |
| 180 | City | onChange | Pending |
| 184 | button (dynamic/unlabelled) | onClick | Pending |
| 194 | input (dynamic/unlabelled) | onChange | Pending |
| 198 | input (dynamic/unlabelled) | onChange | Pending |
| 199 | Delivery note, e.g. Harare CBD only | onChange | Pending |
| 204 | input (dynamic/unlabelled) | onChange | Pending |
| 208 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/market/orders/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 4 | Back to Market | href | Pending |

### web/app/market/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 92 | Orders | href | Pending |
| 93 | Market messages | href | Pending |
| 94 | Sell | href | Pending |
| 99 | button (dynamic/unlabelled) | onClick | Pending |
| 110 | MarketAlerts (dynamic/unlabelled) | onClose | Pending |
| 114 | Search the market | onChange, onKeyDown | Pending |
| 122 | Market alerts | onClick | Pending |
| 125 | Filters | onClick | Pending |
| 135 | Minimum price | onChange | Pending |
| 136 | Maximum price | onChange | Pending |
| 137 | City | onChange | Pending |
| 141 | button (dynamic/unlabelled) | onClick | Pending |
| 148 | Sort listings | onChange | Pending |
| 159 | Apply | onClick | Pending |
| 160 | Clear all | onClick | Pending |
| 167 | button (dynamic/unlabelled) | onClick | Pending |
| 178 | Retry | onClick | Pending |

### web/app/market/saved/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 40 | ← Market | href | Pending |
| 43 | Retry | onClick | Pending |

### web/app/messages/requests/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 52 | Messages | href | Pending |
| 76 | Decline | onClick | Pending |
| 77 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/monetization/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 74 | button (dynamic/unlabelled) | onClick | Pending |
| 77 | Sign in | href | Pending |
| 79 | Manage account settings | href | Pending |
| 82 | button (dynamic/unlabelled) | onClick | Pending |
| 82 | Read the creator program terms | href | Pending |
| 82 | input (dynamic/unlabelled) | onChange | Pending |
| 82 | Submit application | onClick | Pending |
| 89 | Get help with monetization | href | Pending |

### web/app/music/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 17 | AppleMusicPicker (dynamic/unlabelled) | onSelect | Pending |

### web/app/not-found.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 17 | Back to home | href | Pending |
| 23 | Discover | href | Pending |

### web/app/notifications/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 351 | Mark all read | onClick | Pending |
| 362 | button (dynamic/unlabelled) | onClick | Pending |
| 381 | Could not load notifications | onRetry | Pending |
| 407 | Link (dynamic/unlabelled) | onClick, href | Pending |
| 426 | Confirm Delete | onClick | Pending |
| 427 | Confirm | onClick | Pending |
| 428 | Delete | onClick | Pending |
| 432 | Accept Decline | onClick | Pending |
| 433 | Accept | onClick | Pending |
| 434 | Decline | onClick | Pending |
| 438 | span (dynamic/unlabelled) | onClick | Pending |
| 452 | Could not refresh notifications | onRetry | Pending |
| 454 | StoryViewer (dynamic/unlabelled) | onClose | Pending |

### web/app/post/[id]/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 73 | Open Platinum Circles | href | Pending |
| 155 | Back to Platinum Circles | href | Pending |

### web/app/privacy/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 18 | Settings | href | Pending |

### web/app/reset-password/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 60 | Request a new reset link | href | Pending |
| 63 | New password Confirm new password | onSubmit | Pending |
| 65 | input (dynamic/unlabelled) | onChange | Pending |
| 69 | input (dynamic/unlabelled) | onChange | Pending |
| 73 | button (dynamic/unlabelled) | submit | Pending |
| 79 | Back to sign in | href | Pending |

### web/app/saved/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 162 | New collection | onClick | Pending |
| 167 | All | onClick | Pending |
| 169 | button (dynamic/unlabelled) | onClick | Pending |
| 174 | Could not load your saved items | onRetry | Pending |
| 178 | EmptyState (dynamic/unlabelled) | action | Pending |
| 190 | This collection is empty | action | Pending |
| 206 | @ · No folder Unsave | href | Pending |
| 225 | No folder Unsave | onClick | Pending |
| 226 | File into folder | onChange | Pending |
| 230 | Unsave | onClick | Pending |
| 241 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/search/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 245 | Back | onClick | Pending |
| 248 | Search Platinum Circles | onChange, onKeyDown | Pending |
| 262 | button (dynamic/unlabelled) | onClick | Pending |
| 279 | · | href | Pending |
| 291 | Clear | onClick | Pending |
| 296 | button (dynamic/unlabelled) | onClick | Pending |
| 297 | Remove | onClick | Pending |
| 304 | Could not complete your search | onRetry | Pending |
| 321 | Link (dynamic/unlabelled) | onClick, href | Pending |
| 334 | button (dynamic/unlabelled) | onClick | Pending |
| 336 | div (dynamic/unlabelled) | onKeyDown, onClick | Pending |
| 355 | Link (dynamic/unlabelled) | onClick, href | Pending |
| 372 | Link (dynamic/unlabelled) | onClick, href | Pending |
| 387 | Link (dynamic/unlabelled) | onClick, href | Pending |
| 402 | Link (dynamic/unlabelled) | onClick, href | Pending |
| 422 | button (dynamic/unlabelled) | onClick | Pending |
| 435 | members | onClick, href | Pending |
| 444 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/settings/account-type/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 55 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/settings/activity/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 31 | button (dynamic/unlabelled) | onClick | Pending |
| 34 | Link (dynamic/unlabelled) | href | Pending |

### web/app/settings/archive/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 29 | Restore | onClick | Pending |

### web/app/settings/blocked/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 64 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/settings/download/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 64 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/settings/follow-requests/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 58 | Link (dynamic/unlabelled) | href | Pending |
| 68 | Accept | onClick | Pending |
| 69 | Decline | onClick | Pending |

### web/app/settings/help/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 29 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/settings/hidden-words/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 38 | Add a word or phrase | onChange, onKeyDown | Pending |
| 39 | Add | onClick | Pending |
| 46 | Remove | onClick | Pending |

### web/app/settings/login-activity/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 39 | Log out of all other devices | onClick | Pending |

### web/app/settings/muted-words/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 38 | Add a word or phrase | onChange, onKeyDown | Pending |
| 39 | Add | onClick | Pending |
| 46 | Remove | onClick | Pending |

### web/app/settings/muted/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 55 | Unmute | onClick | Pending |

### web/app/settings/notifications/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 57 | button (dynamic/unlabelled) | onClick | Pending |
| 78 | Toggle (dynamic/unlabelled) | onChange | Pending |

### web/app/settings/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 22 | button (dynamic/unlabelled) | onClick | Pending |
| 29 | Link (dynamic/unlabelled) | href | Pending |
| 56 | a (dynamic/unlabelled) | href | Pending |
| 121 | Toggle (dynamic/unlabelled) | onChange | Pending |
| 128 | Toggle (dynamic/unlabelled) | onChange | Pending |

### web/app/settings/restricted/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 50 | Link (dynamic/unlabelled) | href | Pending |
| 60 | Unrestrict | onClick | Pending |

### web/app/settings/support/[id]/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 79 | Write a reply | onChange, onKeyDown | Pending |
| 80 | Send | onClick | Pending |

### web/app/settings/support/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 72 | Subject | onChange | Pending |
| 73 | textarea (dynamic/unlabelled) | onChange | Pending |
| 74 | button (dynamic/unlabelled) | onClick | Pending |
| 78 | Link (dynamic/unlabelled) | href | Pending |

### web/app/settings/two-factor/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 64 | 6-digit code | onChange | Pending |
| 65 | Confirm and turn on | onClick | Pending |
| 66 | Cancel | onClick | Pending |
| 73 | Turn off | onClick | Pending |
| 73 | Turn on | onClick | Pending |

### web/app/settings/username/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 104 | New username | onChange | Pending |
| 106 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/settings/verification/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 96 | Retry | onClick | Pending |
| 109 | button (dynamic/unlabelled) | onClick | Pending |
| 119 | button (dynamic/unlabelled) | onClick | Pending |
| 127 | e.g. Member of Parliament, Harare | onChange | Pending |
| 132 | textarea (dynamic/unlabelled) | onChange | Pending |
| 136 | https://example.com/official-profile https://example.com/press-coverage | onChange | Pending |
| 140 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/signup/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 67 | Go to sign in | href | Pending |
| 84 | Full name | onChange | Pending |
| 85 | Email | onChange | Pending |
| 86 | Password, at least 6 characters | onChange, onKeyDown | Pending |
| 88 | button (dynamic/unlabelled) | onClick | Pending |
| 96 | Sign in | href | Pending |
| 99 | Business sign-in | href | Pending |

### web/app/studio/LoadError.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 7 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/studio/ads/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 109 | Quick promotions | href | Pending |
| 110 | New campaign | onClick | Pending |
| 132 | Edit | onClick | Pending |
| 133 | Add ad | onClick | Pending |
| 134 | Submit for review | onClick | Pending |
| 135 | Set live | onClick | Pending |
| 136 | Pause | onClick | Pending |
| 137 | End | onClick | Pending |
| 138 | Delete | onClick | Pending |
| 148 | Link (dynamic/unlabelled) | href | Pending |
| 151 | Remove | onClick | Pending |
| 158 | Objective Budget and payment USD ZWG Schedule Leave the end empty for a campaign that runs until you end it. Payment is settled with the review team on Crisp or IntoBank before the | onClick | Pending |
| 159 | Objective Budget and payment USD ZWG Schedule Leave the end empty for a campaign that runs until you end it. Payment is settled with the review team on Crisp or IntoBank before the | onClick | Pending |
| 162 | Close | onClick | Pending |
| 164 | Campaign name, for example Spring counter kit | onChange | Pending |
| 167 | button (dynamic/unlabelled) | onClick | Pending |
| 171 | USD ZWG | onChange | Pending |
| 172 | Budget | onChange | Pending |
| 174 | button (dynamic/unlabelled) | onClick | Pending |
| 179 | input (dynamic/unlabelled) | onChange | Pending |
| 180 | input (dynamic/unlabelled) | onChange | Pending |
| 183 | button (dynamic/unlabelled) | onClick | Pending |
| 189 | Add an ad to Pick one of your posts. Posts with product cards become carousel ads automatically. | onClick | Pending |
| 190 | Add an ad to Pick one of your posts. Posts with product cards become carousel ads automatically. | onClick | Pending |
| 193 | Close | onClick | Pending |
| 196 | Label | onChange | Pending |
| 197 | Impression cap (optional) | onChange | Pending |
| 203 | · likes | onClick | Pending |

### web/app/studio/audience/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 117 | button (dynamic/unlabelled) | onClick | Pending |
| 131 | Leads | action | Pending |
| 175 | Search followers | onChange | Pending |
| 176 | All labels | onChange | Pending |
| 178 | New lead | onClick | Pending |
| 179 | Export loaded rows | onClick | Pending |
| 191 | Link (dynamic/unlabelled) | href | Pending |
| 194 | Label | onChange | Pending |
| 195 | Make lead | onClick | Pending |
| 209 | Status | onChange | Pending |
| 210 | Edit | onClick | Pending |
| 211 | Delete | onClick | Pending |
| 217 | div (dynamic/unlabelled) | onClick | Pending |
| 218 | div (dynamic/unlabelled) | onClick | Pending |
| 219 | Close | onClick | Pending |
| 221 | input (dynamic/unlabelled) | onChange | Pending |
| 223 | button (dynamic/unlabelled) | onClick | Pending |
| 224 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/studio/commerce/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 160 | button (dynamic/unlabelled) | onClick | Pending |
| 175 | button (dynamic/unlabelled) | onClick | Pending |
| 177 | New listing | href | Pending |
| 179 | Carousel caption | onChange | Pending |
| 179 | Publish selected products | onClick | Pending |
| 183 | input (dynamic/unlabelled) | onChange | Pending |
| 190 | Link (dynamic/unlabelled) | href | Pending |
| 197 | input (dynamic/unlabelled) | onChange, onKeyDown | Pending |
| 198 | button (dynamic/unlabelled) | onClick | Pending |
| 200 | button (dynamic/unlabelled) | onClick | Pending |
| 206 | Stock: | onClick | Pending |
| 207 | Mark sold | onClick | Pending |
| 208 | Relist | onClick | Pending |
| 209 | button (dynamic/unlabelled) | onClick | Pending |
| 210 | Share to feed | onClick | Pending |
| 211 | button (dynamic/unlabelled) | onClick | Pending |
| 218 | Load more catalog items | onClick | Pending |
| 228 | Export loaded receipts | onClick | Pending |
| 247 | Load earlier receipts | onClick | Pending |
| 254 | Quality hardware, fair prices, same-day collection in Harare | onChange | Pending |
| 262 | button (dynamic/unlabelled) | onClick | Pending |
| 268 | input (dynamic/unlabelled) | onChange | Pending |
| 270 | Fee | onChange | Pending |
| 271 | Delivery note, for example Harare CBD only | onChange | Pending |
| 274 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/studio/content/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 112 | Retry | onClick | Pending |
| 118 | Create content | href | Pending |
| 146 | PillTabs (dynamic/unlabelled) | onSelect | Pending |
| 153 | Search your content | onChange | Pending |
| 167 | EmptyState (dynamic/unlabelled) | action | Pending |
| 223 | Link (dynamic/unlabelled) | href | Pending |

### web/app/studio/inbox/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 173 | button (dynamic/unlabelled) | onClick | Pending |
| 184 | button (dynamic/unlabelled) | onClick | Pending |
| 188 | input (dynamic/unlabelled) | onChange | Pending |
| 215 | Open | href | Pending |
| 218 | Accept | onClick | Pending |
| 219 | Decline | onClick | Pending |
| 222 | Label | onChange | Pending |
| 227 | Assign | onChange | Pending |
| 232 | Note | onClick | Pending |
| 233 | button (dynamic/unlabelled) | onClick | Pending |
| 237 | Internal note, only your team sees it | onChange | Pending |
| 238 | Save | onClick | Pending |
| 252 | /hours | onChange | Pending |
| 253 | Title | onChange | Pending |
| 255 | Reply text | onChange | Pending |
| 256 | Save reply | onClick | Pending |
| 262 | Delete | onClick | Pending |
| 269 | input (dynamic/unlabelled) | onChange | Pending |
| 271 | Thanks for reaching out to us. How can we help today? | onChange | Pending |
| 274 | input (dynamic/unlabelled) | onChange | Pending |
| 276 | We are closed right now and reply during opening hours. | onChange | Pending |
| 283 | Question | onChange | Pending |
| 284 | Answer | onChange | Pending |
| 285 | Remove | onClick | Pending |
| 288 | Add question | onClick | Pending |
| 290 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/studio/insights/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 73 | Selling | action | Pending |
| 90 | Hiring | action | Pending |
| 107 | Best performing | action | Pending |
| 138 | days | onClick | Pending |
| 200 | · views · likes · comments · reposts | href | Pending |

### web/app/studio/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 115 | Link (dynamic/unlabelled) | href | Pending |
| 180 | Plan the first one. | href | Pending |
| 182 | · views · likes · comments · reposts | href | Pending |

### web/app/studio/planner/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 222 | Retry | onClick | Pending |
| 271 | New post | onClick | Pending |
| 276 | Previous | onClick | Pending |
| 284 | button (dynamic/unlabelled) | onClick | Pending |
| 290 | Today | onClick | Pending |
| 296 | Next | onClick | Pending |
| 310 | button (dynamic/unlabelled) | onClick | Pending |
| 328 | button (dynamic/unlabelled) | onClick | Pending |
| 353 | View the live post | href | Pending |
| 357 | Edit | onClick | Pending |
| 358 | Unschedule | onClick | Pending |
| 359 | button (dynamic/unlabelled) | onClick | Pending |
| 366 | Media Products Category Schedule Save draft Schedule | onClick | Pending |
| 367 | Post planner | onClick | Pending |
| 370 | Close | onClick | Pending |
| 373 | What do you want to say? | onChange | Pending |
| 375 | Longer text (optional) | onChange | Pending |
| 384 | Remove | onClick | Pending |
| 390 | Media | onClick | Pending |
| 391 | input (dynamic/unlabelled) | onChange | Pending |
| 392 | Products | onClick | Pending |
| 394 | Main feed | onChange | Pending |
| 411 | button (dynamic/unlabelled) | onClick | Pending |
| 426 | button (dynamic/unlabelled) | onClick | Pending |
| 431 | input (dynamic/unlabelled) | onChange | Pending |
| 435 | Save draft | onClick | Pending |
| 436 | Schedule | onClick | Pending |
| 437 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/studio/recruiter/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 203 | Post a job | href | Pending |
| 213 | applicants · interviewing · hired | onClick | Pending |
| 225 | View listing | href | Pending |
| 226 | button (dynamic/unlabelled) | onClick | Pending |
| 237 | Filter application status | onChange | Pending |
| 237 | Load more applicants | onClick | Pending |
| 251 | button (dynamic/unlabelled) | onClick | Pending |
| 280 | Close | onClick | Pending |
| 289 | Message | onClick | Pending |
| 297 | View profile | href | Pending |
| 301 | Profile | href | Pending |
| 302 | Message | onClick | Pending |
| 307 | Portfolio | href | Pending |
| 308 | a (dynamic/unlabelled) | href | Pending |
| 320 | button (dynamic/unlabelled) | onClick | Pending |
| 326 | Interview date and time | onChange | Pending |
| 327 | Interview location or video link | onChange | Pending |
| 328 | button (dynamic/unlabelled) | onClick | Pending |
| 332 | Applicant tags | onChange, onBlur | Pending |
| 343 | Team note | onChange, onKeyDown | Pending |
| 344 | Add | onClick | Pending |

### web/app/studio/reviews/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 73 | button (dynamic/unlabelled) | onClick | Pending |
| 85 | Link (dynamic/unlabelled) | href | Pending |
| 98 | Thank them, address the point, say what happens next. | onChange | Pending |
| 100 | button (dynamic/unlabelled) | onClick | Pending |
| 101 | Remove reply | onClick | Pending |
| 102 | Cancel | onClick | Pending |
| 105 | button (dynamic/unlabelled) | onClick | Pending |

### web/app/studio/settings/organization/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 135 | Could not load your organization | onRetry | Pending |
| 140 | Back to settings | href | Pending |
| 151 | PillTabs (dynamic/unlabelled) | onSelect | Pending |
| 179 | Make owner | onClick | Pending |
| 182 | Remove | onClick | Pending |
| 196 | @username | onChange | Pending |
| 197 | select (dynamic/unlabelled) | onChange | Pending |
| 200 | Access ends on this date, optional | onChange | Pending |
| 201 | Add | onClick | Pending |
| 233 | Brand Location | onChange | Pending |
| 237 | input (dynamic/unlabelled) | onChange | Pending |
| 238 | Add | onClick | Pending |
| 256 | input (dynamic/unlabelled) | onChange | Pending |
| 278 | Revoke | onClick | Pending |
| 302 | Agency's @username | onChange | Pending |
| 307 | button (dynamic/unlabelled) | onClick | Pending |
| 313 | Access ends on this date, optional | onChange | Pending |
| 314 | Grant | onClick | Pending |

### web/app/studio/settings/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 82 | Organization Team, brands and locations, desks, agencies, history &rarr; | href | Pending |
| 149 | Organization Team and roles, brands and locations, which desks are on, agencies, history &rarr; | href | Pending |
| 171 | What you do, in two lines | onChange | Pending |
| 173 | select (dynamic/unlabelled) | onChange | Pending |
| 174 | City | onChange | Pending |
| 175 | Street address | onChange | Pending |
| 176 | Phone | onChange | Pending |
| 177 | Email | onChange | Pending |
| 178 | Website | onChange | Pending |
| 183 | input (dynamic/unlabelled) | onChange | Pending |
| 186 | input (dynamic/unlabelled) | onChange | Pending |
| 187 | input (dynamic/unlabelled) | onChange | Pending |
| 192 | button (dynamic/unlabelled) | onClick | Pending |
| 206 | select (dynamic/unlabelled) | onChange | Pending |
| 207 | button (dynamic/unlabelled) | onClick | Pending |
| 214 | Person's name | onChange | Pending |
| 215 | select (dynamic/unlabelled) | onChange | Pending |
| 216 | Issue access code | onClick | Pending |
| 222 | Copy | onClick | Pending |
| 223 | Dismiss | onClick | Pending |
| 237 | Approve | onClick | Pending |
| 238 | Remove | onClick | Pending |

### web/app/terms/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 18 | Settings | href | Pending |

### web/app/topic/[tag]/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 56 | @ · | href | Pending |

### web/app/write/page.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 314 | Back | onClick | Pending |
| 315 | button (dynamic/unlabelled) | onClick | Pending |
| 319 | Title | onChange | Pending |
| 324 | button (dynamic/unlabelled) | onClick | Pending |
| 333 | button (dynamic/unlabelled) | onClick | Pending |
| 338 | input (dynamic/unlabelled) | onChange | Pending |
| 352 | button (dynamic/unlabelled) | onClick | Pending |
| 355 | Link | onClick | Pending |
| 359 | input (dynamic/unlabelled) | onChange | Pending |
| 362 | button (dynamic/unlabelled) | onClick | Pending |
| 370 | Retry | onClick | Pending |
| 373 | Write the piece. Paragraphs are preserved exactly as you write them. Use the toolbar for headings, emphasis, quotes, links and images. | onChange | Pending |
| 378 | View article | href | Pending |
| 381 | Add a link Cancel Insert | onClick | Pending |
| 382 | Add a link Cancel Insert | onClick | Pending |
| 384 | Link text | onChange | Pending |
| 386 | https:// | onChange | Pending |
| 389 | Cancel | onClick | Pending |
| 390 | Insert | onClick | Pending |

### web/components/AccountStatus.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 85 | Apply for verification | href | Pending |
| 109 | Link (dynamic/unlabelled) | href | Pending |

### web/components/AnnouncementBanner.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 42 | Dismiss | onClick | Pending |

### web/components/AppShell.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 29 | Skip to content | href | Pending |
| 31 | Platinum Circles | href | Pending |
| 35 | Sign in | href | Pending |
| 52 | Skip to content | href | Pending |

### web/components/AppleMusicPicker.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 37 | Catalog country | onSubmit | Pending |
| 38 | Song, artist or Apple Music song link | onChange | Pending |
| 39 | Two-letter catalog country | onChange | Pending |
| 43 | Share this song link | onClick | Pending |
| 50 | Listen | onClick | Pending |
| 51 | Share | onClick | Pending |
| 53 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/AppleMusicPlayer.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 101 | button (dynamic/unlabelled) | onClick | Pending |
| 102 | Open in Apple Music | href | Pending |
| 104 | Retry connection | onClick | Pending |

### web/components/ApplicationCvLink.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 32 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/ApplyPanel.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 152 | Apply on company site | href | Pending |
| 161 | Apply | onClick | Pending |
| 164 | Retry | onClick | Pending |
| 173 | Cover note (optional) | onChange | Pending |
| 180 | Phone (optional) | onChange | Pending |
| 186 | Portfolio URL (optional) | onChange | Pending |
| 192 | input (dynamic/unlabelled) | onChange | Pending |
| 200 | Remove CV | onClick | Pending |
| 203 | button (dynamic/unlabelled) | onClick | Pending |
| 206 | Cancel | onClick | Pending |

### web/components/ArticleBody.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 40 | button (dynamic/unlabelled) | onClick | Pending |
| 42 | button (dynamic/unlabelled) | onClick | Pending |
| 51 | Link (dynamic/unlabelled) | href | Pending |
| 52 | a (dynamic/unlabelled) | href | Pending |

### web/components/BusinessProfile.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 62 | button (dynamic/unlabelled) | onClick | Pending |
| 71 | · | onClick | Pending |
| 93 | a (dynamic/unlabelled) | href | Pending |
| 94 | Website | href | Pending |
| 127 | Link (dynamic/unlabelled) | href | Pending |
| 129 | a (dynamic/unlabelled) | href | Pending |
| 141 | button (dynamic/unlabelled) | onClick | Pending |
| 146 | How was this business? | onChange | Pending |
| 148 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/CallButtons.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 11 | Voice call | onClick | Pending |
| 14 | Video call | onClick | Pending |

### web/components/CommentComposer.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 41 | Add a comment | onChange, onKeyDown | Pending |
| 48 | Comment | onClick | Pending |

### web/components/Comments.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 298 | Link (dynamic/unlabelled) | href | Pending |
| 307 | Like comment | onClick | Pending |
| 310 | Dislike comment | onClick | Pending |
| 313 | Reply | onClick | Pending |
| 317 | Comment actions | onClick | Pending |
| 322 | button (dynamic/unlabelled) | onClick | Pending |
| 323 | Copy text | onClick | Pending |
| 326 | button (dynamic/unlabelled) | onClick | Pending |
| 327 | button (dynamic/unlabelled) | onClick | Pending |
| 328 | Restrict | onClick | Pending |
| 332 | Delete | onClick | Pending |
| 339 | button (dynamic/unlabelled) | onClick | Pending |
| 356 | Accept | onClick | Pending |
| 356 | Decline | onClick | Pending |
| 357 | Try again | onClick | Pending |
| 361 | may be spam | onClick | Pending |
| 372 | Cancel | onClick | Pending |
| 376 | textarea (dynamic/unlabelled) | onChange, onKeyDown | Pending |
| 384 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/CommerceOverview.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 172 | still pending payment | href | Pending |

### web/components/Composer.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 471 | button (dynamic/unlabelled) | onClick | Pending |
| 483 | Dismiss post confirmation | onClick | Pending |
| 484 | What&apos;s on your mind? | onClick | Pending |
| 492 | Photo | onClick | Pending |
| 493 | Open post camera and lenses | onClick | Pending |
| 494 | Article | onClick | Pending |
| 495 | Poll | onClick | Pending |
| 496 | Post | onClick | Pending |
| 503 | Category Comments: everyone Comments: people I follow Comments: my followers Comments: mentioned only Comments off | onClick | Pending |
| 504 | Category Comments: everyone Comments: people I follow Comments: my followers Comments: mentioned only Comments off | onDrop | Pending |
| 509 | button (dynamic/unlabelled) | onClick | Pending |
| 509 | button (dynamic/unlabelled) | onClick | Pending |
| 510 | Continue browsing this feed | onClick | Pending |
| 526 | a (dynamic/unlabelled) | href | Pending |
| 528 | button (dynamic/unlabelled) | onClick | Pending |
| 536 | button (dynamic/unlabelled) | onClick | Pending |
| 541 | Sell an item | href | Pending |
| 557 | Post audience | onChange | Pending |
| 558 | Article title (optional) | onChange | Pending |
| 559 | textarea (dynamic/unlabelled) | onChange | Pending |
| 563 | @ | onClick | Pending |
| 582 | button (dynamic/unlabelled) | onClick | Pending |
| 586 | button (dynamic/unlabelled) | onClick | Pending |
| 590 | Edit | onClick | Pending |
| 590 | Tag people | onClick | Pending |
| 590 | Move media earlier | onClick | Pending |
| 590 | Move media later | onClick | Pending |
| 590 | Remove selected media | onClick | Pending |
| 590 | button (dynamic/unlabelled) | onClick | Pending |
| 590 | Add more media | onClick | Pending |
| 591 | Music | onClick | Pending |
| 592 | PostMediaEditor (dynamic/unlabelled) | onClose, onSave | Pending |
| 594 | div (dynamic/unlabelled) | onClick | Pending |
| 595 | div (dynamic/unlabelled) | onClick | Pending |
| 597 | img (dynamic/unlabelled) | onClick | Pending |
| 604 | button (dynamic/unlabelled) | onClick | Pending |
| 610 | Search by name or handle | onChange | Pending |
| 613 | button (dynamic/unlabelled) | onClick | Pending |
| 621 | button (dynamic/unlabelled) | onClick | Pending |
| 631 | Describe this image, helps people using screen readers | onChange | Pending |
| 644 | input (dynamic/unlabelled) | onChange | Pending |
| 653 | Add option | onClick | Pending |
| 655 | 1 day 3 days 7 days | onChange | Pending |
| 660 | Remove poll | onClick | Pending |
| 667 | Cancel | onClick | Pending |
| 680 | Remove preview | onClick | Pending |
| 683 | ProductPicker (dynamic/unlabelled) | onChange, onClose | Pending |
| 689 | button (dynamic/unlabelled) | onClick | Pending |
| 694 | Edit draft | onClick | Pending |
| 695 | View post | href | Pending |
| 697 | Media | onClick | Pending |
| 697 | Open post camera and lenses | onClick | Pending |
| 697 | Music | onClick | Pending |
| 697 | Products | onClick | Pending |
| 697 | button (dynamic/unlabelled) | onClick | Pending |
| 697 | input (dynamic/unlabelled) | onChange | Pending |
| 699 | StoryCapture (dynamic/unlabelled) | onClose | Pending |
| 700 | SoundtrackPicker (dynamic/unlabelled) | onChange, onClose | Pending |
| 702 | Category | onChange | Pending |
| 708 | select (dynamic/unlabelled) | onChange | Pending |
| 716 | Who can comment | onChange | Pending |

### web/components/ConnectionBanner.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 81 | Reload | onClick | Pending |

### web/components/CreatorCommercePanel.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 43 | Refresh | onClick | Pending |
| 50 | Prepare a product Type Prepaid subscription Genuine tip Digital gift Name Price in USD | onSubmit | Pending |
| 52 | Prepaid subscription Genuine tip Digital gift | onChange | Pending |
| 53 | input (dynamic/unlabelled) | onChange | Pending |
| 54 | input (dynamic/unlabelled) | onChange | Pending |
| 55 | input (dynamic/unlabelled) | onChange | Pending |
| 58 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/DiscoverFeed.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 55 | button (dynamic/unlabelled) | onClick | Pending |
| 67 | Could not load Discover | onRetry | Pending |
| 74 | EmptyState (dynamic/unlabelled) | action | Pending |
| 83 | DiscoverTile (dynamic/unlabelled) | onOpen | Pending |
| 87 | DiscoverTile (dynamic/unlabelled) | onOpen | Pending |
| 93 | DiscoverViewer (dynamic/unlabelled) | onClose | Pending |

### web/components/DiscoverSections.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 38 | Featured channels | action | Pending |
| 41 | Link (dynamic/unlabelled) | href | Pending |
| 89 | # | href | Pending |
| 126 | Top articles | action | Pending |
| 132 | Link (dynamic/unlabelled) | href | Pending |

### web/components/DiscoverTile.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 64 | Hide this post | onClick | Pending |
| 79 | Link (dynamic/unlabelled) | onClick, href | Pending |
| 116 | Article | onClick, href | Pending |
| 136 | Link (dynamic/unlabelled) | onClick, href | Pending |
| 153 | Link (dynamic/unlabelled) | onClick, href | Pending |

### web/components/DiscoverViewer.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 43 | Sensitive content. Tap to view. | onClick | Pending |
| 47 | Previous photo | onClick | Pending |
| 47 | Next photo | onClick | Pending |
| 48 | button (dynamic/unlabelled) | onClick | Pending |
| 50 | Link (dynamic/unlabelled) | href | Pending |
| 50 | button (dynamic/unlabelled) | onClick | Pending |
| 50 | Open comments | onClick | Pending |
| 50 | button (dynamic/unlabelled) | onClick | Pending |
| 50 | Open post | href | Pending |
| 50 | Retry | onClick | Pending |
| 77 | Discover viewer | onKeyDown | Pending |
| 78 | Close Discover | onClick | Pending |
| 78 | button (dynamic/unlabelled) | onClick | Pending |
| 79 | div (dynamic/unlabelled) | onScroll | Pending |
| 82 | Could not load more. Retry | onClick | Pending |
| 83 | Close comments | onClick | Pending |

### web/components/DiscoveryRail.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 53 | Trending now | action | Pending |
| 72 | Suggested for you | action | Pending |
| 77 | Link (dynamic/unlabelled) | href | Pending |
| 88 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/EditPost.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 29 | Edit post The post will carry an Edited label. | onClick | Pending |
| 30 | Edit post The post will carry an Edited label. | onClick | Pending |
| 33 | Close | onClick | Pending |
| 36 | textarea (dynamic/unlabelled) | onChange | Pending |
| 40 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/ErrorState.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 31 | Try again | onClick | Pending |

### web/components/FactCheck.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 45 | a (dynamic/unlabelled) | href | Pending |
| 54 | Yes | onClick | Pending |
| 55 | No | onClick | Pending |
| 95 | Add a fact check Add missing context with sources. It shows on the post once at least 3 readers rate it helpful. Minimum 20 characters. | onClick | Pending |
| 96 | Add a fact check Add missing context with sources. It shows on the post once at least 3 readers rate it helpful. Minimum 20 characters. | onClick | Pending |
| 99 | Close | onClick | Pending |
| 102 | What context is missing, and what do the sources actually say? | onChange | Pending |
| 106 | Source link, https:// | onChange | Pending |
| 107 | Second source, optional | onChange | Pending |
| 109 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/FollowButton.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 31 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/GifPicker.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 44 | Powered by GIPHY | onClick, onKeyDown | Pending |
| 45 | Powered by GIPHY | onClick | Pending |
| 49 | input (dynamic/unlabelled) | onChange | Pending |
| 52 | Close | onClick | Pending |
| 59 | Try again | onClick | Pending |
| 66 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/GlobalBack.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 24 | Go back | onClick | Pending |

### web/components/GlobalMediaLightbox.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 107 | Media viewer | onClick | Pending |
| 108 | Close | onClick | Pending |
| 110 | img (dynamic/unlabelled) | onClick, onDoubleClick | Pending |

### web/components/GroupCallBar.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 49 | Join | onClick | Pending |
| 50 | Reject | onClick | Pending |
| 58 | Start group voice call | onClick | Pending |
| 59 | Start group video call | onClick | Pending |

### web/components/HomeFeed.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 249 | button (dynamic/unlabelled) | onClick | Pending |
| 274 | button (dynamic/unlabelled) | onClick | Pending |
| 280 | Retry | onClick | Pending |
| 292 | Try again | onClick | Pending |

### web/components/HomeRail.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 62 | Your activity | action | Pending |

### web/components/InsightsModal.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 51 | Post insights | onClick | Pending |
| 52 | Post insights | onClick | Pending |
| 55 | Close | onClick | Pending |
| 93 | @ | href | Pending |

### web/components/IntoBankConnectionForm.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 15 | Link IntoBank | onClick | Pending |
| 33 | In IntoBank, open Profile, Connected apps, then Platinum Circles. Review the wallet access and payment permissions. Generate a connection code and enter it here. IntoBank approval  | onSubmit | Pending |
| 36 | 8-character code | onChange | Pending |
| 41 | button (dynamic/unlabelled) | submit | Pending |
| 42 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/JobActions.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 65 | button (dynamic/unlabelled) | onClick | Pending |
| 68 | Share | onClick | Pending |
| 72 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/JobCard.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 45 | Link (dynamic/unlabelled) | href | Pending |
| 62 | button (dynamic/unlabelled) | onClick | Pending |
| 65 | Share | onClick | Pending |

### web/components/LikesModal.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 31 | div (dynamic/unlabelled) | onClick | Pending |
| 32 | div (dynamic/unlabelled) | onClick | Pending |
| 35 | Close | onClick | Pending |
| 45 | @ | href | Pending |

### web/components/ListingCard.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 32 | Link (dynamic/unlabelled) | href | Pending |
| 42 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/MarketAlerts.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 47 | Market alerts The moment a matching listing appears, you get notified. | onClick | Pending |
| 48 | Market alerts The moment a matching listing appears, you get notified. | onClick | Pending |
| 51 | Close | onClick | Pending |
| 54 | What are you looking for, iPhone, Toyota Aqua, apartment | onChange | Pending |
| 57 | Max price, optional | onChange | Pending |
| 59 | City, optional | onChange | Pending |
| 63 | button (dynamic/unlabelled) | onClick | Pending |
| 76 | Delete alert | onClick | Pending |

### web/components/MarketOrders.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 77 | Refresh | onClick | Pending |
| 78 | Sign in to request and manage orders | href | Pending |
| 79 | Request an order at the listing price. The seller confirms stock before payment. Quantity Fulfilment Pickup Payment uses IntoBank on your phone. Delivery is arranged with the selle | onSubmit | Pending |
| 81 | Quantity | onChange | Pending |
| 82 | Pickup | onChange | Pending |
| 83 | textarea (dynamic/unlabelled) | onChange | Pending |
| 84 | button (dynamic/unlabelled) | submit | Pending |
| 91 | × | href | Pending |
| 97 | Message | href | Pending |
| 98 | button (dynamic/unlabelled) | onClick | Pending |
| 99 | History | onClick | Pending |
| 102 | Load more orders | onClick | Pending |

### web/components/MarketReportForm.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 42 | Report Your identity is hidden from the reported person. Staff can review your report. | onSubmit | Pending |
| 83 | Choose a reason | onChange | Pending |
| 100 | textarea (dynamic/unlabelled) | onChange | Pending |
| 114 | button (dynamic/unlabelled) | submit | Pending |
| 123 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/MarketplaceShelf.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 14 | Explore | href | Pending |
| 19 | Link (dynamic/unlabelled) | href | Pending |
| 35 | Previous marketplace listings | onClick | Pending |
| 36 | Next marketplace listings | onClick | Pending |

### web/components/MediaGallery.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 75 | Link (dynamic/unlabelled) | onClick, href | Pending |
| 85 | Link (dynamic/unlabelled) | onClick, href | Pending |
| 92 | button (dynamic/unlabelled) | onClick | Pending |
| 457 | Post media | onDoubleClick | Pending |
| 480 | img (dynamic/unlabelled) | onClick, onKeyDown | Pending |
| 504 | Sensitive content The author flagged this media. Tap to show. | onClick | Pending |
| 515 | Previous media | onClick | Pending |
| 518 | Next media | onClick | Pending |
| 523 | button (dynamic/unlabelled) | onClick | Pending |
| 537 | Media viewer | onClick | Pending |
| 543 | Platinum Circles / | onClick | Pending |
| 550 | @ | href | Pending |
| 561 | button (dynamic/unlabelled) | onClick | Pending |
| 566 | button (dynamic/unlabelled) | onClick | Pending |
| 570 | Close viewer | onClick | Pending |
| 576 | Previous media | onClick | Pending |
| 579 | Next media | onClick | Pending |
| 582 | div (dynamic/unlabelled) | onClick | Pending |
| 592 | img (dynamic/unlabelled) | onClick, onDoubleClick | Pending |
| 607 | Sensitive content The author flagged this media. Tap to show. | onClick | Pending |
| 614 | - % + | onClick | Pending |
| 615 | Zoom out | onClick | Pending |
| 616 | Reset zoom | onClick | Pending |
| 617 | Zoom in | onClick | Pending |
| 632 | @ Open the full post | onClick | Pending |
| 649 | button (dynamic/unlabelled) | onClick | Pending |
| 652 | Link (dynamic/unlabelled) | href | Pending |
| 656 | button (dynamic/unlabelled) | onClick | Pending |
| 664 | Check status | onClick | Pending |
| 668 | Open the full post | href | Pending |
| 674 | div (dynamic/unlabelled) | onClick | Pending |

### web/components/MemoryAlbum.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 76 | Retry memory video | onClick | Pending |
| 79 | video (dynamic/unlabelled) | onPlay | Pending |
| 81 | button (dynamic/unlabelled) | onClick | Pending |
| 190 | Retry | onClick | Pending |
| 195 | Back home | href | Pending |
| 203 | Back | onClick | Pending |
| 205 | button (dynamic/unlabelled) | onClick | Pending |
| 210 | Add memories | onClick | Pending |
| 211 | Album settings | onClick | Pending |
| 220 | button (dynamic/unlabelled) | onClick | Pending |
| 223 | Open book | onClick | Pending |
| 224 | Play book | onClick | Pending |
| 225 | + Add memories | onClick | Pending |
| 231 | Add memories | onClick | Pending |
| 237 | button (dynamic/unlabelled) | onClick | Pending |
| 253 | MemoryVideo (dynamic/unlabelled) | onRetry | Pending |
| 255 | MemoryPageImage (dynamic/unlabelled) | onRetry | Pending |
| 265 | View full post | href | Pending |
| 279 | Previous page | onClick | Pending |
| 280 | button (dynamic/unlabelled) | onClick | Pending |
| 282 | Love this memory | onClick | Pending |
| 283 | Next page | onClick | Pending |
| 287 | Move earlier | onClick | Pending |
| 288 | Move later | onClick | Pending |
| 289 | Switch page style | onClick | Pending |
| 290 | Remove page | onClick | Pending |
| 296 | Next book: | href | Pending |
| 297 | AddMemories (dynamic/unlabelled) | onClose | Pending |
| 298 | ManageAlbum (dynamic/unlabelled) | onClose | Pending |
| 311 | Write a caption | onChange | Pending |
| 314 | Save caption | onClick | Pending |
| 323 | Edit caption | onClick | Pending |
| 343 | Book editor | onClick | Pending |
| 344 | Add memories Every story you have ever posted. Pick the ones worth keeping. Refresh previews | onClick | Pending |
| 347 | Close | onClick | Pending |
| 350 | Refresh previews | onClick | Pending |
| 351 | button (dynamic/unlabelled) | onClick | Pending |
| 359 | button (dynamic/unlabelled) | onClick | Pending |
| 369 | button (dynamic/unlabelled) | onClick | Pending |
| 405 | Book editor | onClick | Pending |
| 406 | Design your book Title Subtitle Cover memory Paper tint Cover design Who can open it People Hidden from Chosen people | onClick | Pending |
| 409 | Close | onClick | Pending |
| 413 | input (dynamic/unlabelled) | onChange | Pending |
| 416 | A small line to remember it by | onChange | Pending |
| 419 | button (dynamic/unlabelled) | onClick | Pending |
| 423 | button (dynamic/unlabelled) | onClick | Pending |
| 432 | button (dynamic/unlabelled) | onClick | Pending |
| 436 | button (dynamic/unlabelled) | onClick | Pending |
| 446 | Hidden from | onClick | Pending |
| 447 | Chosen people | onClick | Pending |
| 450 | Search people | onChange | Pending |
| 455 | @ | onClick | Pending |
| 474 | Remove | onClick | Pending |
| 479 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/MemoryAlbumBook.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 22 | Link (dynamic/unlabelled) | onClick, href | Pending |
| 23 | View all | onClick | Pending |
| 23 | button (dynamic/unlabelled) | onClick | Pending |
| 23 | Create memory book | onClick | Pending |
| 24 | Your memory books | onKeyDown | Pending |
| 24 | Close memory books | onClick | Pending |
| 24 | Search memory books | onChange | Pending |
| 24 | button (dynamic/unlabelled) | onClick | Pending |
| 24 | New book | onClick | Pending |
| 25 | MemoryBookDesigner (dynamic/unlabelled) | onClose | Pending |

### web/components/MessageButton.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 33 | Message | onClick | Pending |

### web/components/MessagesApp.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 654 | Link (dynamic/unlabelled) | href | Pending |
| 711 | div (dynamic/unlabelled) | onKeyDown, onClick | Pending |
| 734 | GifPicker (dynamic/unlabelled) | onClose, onPick | Pending |
| 740 | ShareDetails (dynamic/unlabelled) | onClose, onSend | Pending |
| 744 | PrivateMediaViewer (dynamic/unlabelled) | onClose | Pending |
| 746 | Retry attachment | onClick | Pending |
| 748 | Cancel | onClick | Pending |
| 749 | Cancel | onClick | Pending |
| 749 | button (dynamic/unlabelled) | onClick | Pending |
| 751 | Attach a file | onClick | Pending |
| 754 | Camera | onClick | Pending |
| 755 | input (dynamic/unlabelled) | onChange | Pending |
| 756 | GIFs | onClick | Pending |
| 756 | Stickers | onClick | Pending |
| 756 | Contact | onClick | Pending |
| 756 | Location | onClick | Pending |
| 757 | input (dynamic/unlabelled) | onChange | Pending |
| 761 | Cancel | onClick | Pending |
| 762 | Send voice note | onClick | Pending |
| 765 | Record a voice message | onClick | Pending |
| 767 | textarea (dynamic/unlabelled) | onChange, onKeyDown, onBlur | Pending |
| 775 | Send | onClick | Pending |
| 782 | button (dynamic/unlabelled) | onClick | Pending |
| 783 | Unpin | onClick | Pending |
| 784 | Try again | onClick | Pending |
| 805 | Back to conversations | onClick | Pending |
| 810 | Community chat · open the community | href | Pending |
| 838 | Message requests | href | Pending |
| 840 | Calls | href | Pending |
| 845 | Search | onChange | Pending |
| 854 | button (dynamic/unlabelled) | onClick | Pending |
| 887 | Community chat · open the community | href | Pending |
| 933 | Counter amount | onChange | Pending |
| 935 | Send counter | onClick | Pending |
| 936 | Cancel | onClick | Pending |
| 941 | Accept | onClick | Pending |
| 942 | Counter | onClick | Pending |
| 943 | Decline | onClick | Pending |
| 967 | button (dynamic/unlabelled) | onClick | Pending |
| 968 | a (dynamic/unlabelled) | href | Pending |
| 970 | View story | href | Pending |
| 974 | img (dynamic/unlabelled) | onClick, onKeyDown | Pending |
| 980 | Voice message | href | Pending |
| 983 | a (dynamic/unlabelled) | href | Pending |
| 989 | Retry delivery | onClick | Pending |
| 990 | Attachment unavailable · Retry | onClick | Pending |
| 991 | button (dynamic/unlabelled) | onClick | Pending |
| 993 | Reply | onClick | Pending |
| 994 | Edit | onClick | Pending |
| 995 | button (dynamic/unlabelled) | onClick | Pending |
| 996 | Forward | onClick | Pending |
| 997 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/MobileTabBar.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 29 | Link (dynamic/unlabelled) | href | Pending |
| 35 | Your profile | href | Pending |

### web/components/Nav.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 102 | Platinum Circles home | href | Pending |
| 110 | button (dynamic/unlabelled) | onClick | Pending |
| 124 | Link (dynamic/unlabelled) | onClick, href | Pending |
| 161 | Your profile | href | Pending |
| 171 | Sign out | onClick | Pending |

### web/components/NotificationsRail.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 54 | Link (dynamic/unlabelled) | href | Pending |

### web/components/PinnedMedia.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 44 | Media could not be loaded. Retry | onClick | Pending |

### web/components/PollCard.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 38 | · | onClick | Pending |
| 51 | button (dynamic/unlabelled) | onClick | Pending |
| 59 | See votes | onClick | Pending |
| 61 | PollVoters (dynamic/unlabelled) | onClose | Pending |
| 72 | Votes | onClick | Pending |
| 73 | Votes | onClick | Pending |
| 79 | a (dynamic/unlabelled) | href | Pending |

### web/components/PostCard.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 105 | · | onClick, href | Pending |
| 244 | reposted | onClick, href | Pending |
| 248 | LikesModal (dynamic/unlabelled) | onClose | Pending |
| 265 | Link (dynamic/unlabelled) | href | Pending |
| 273 | Link (dynamic/unlabelled) | onClick, href | Pending |
| 280 | collaborators | onClick, onKeyDown | Pending |
| 282 | Link (dynamic/unlabelled) | onClick, href | Pending |
| 288 | @ | href | Pending |
| 290 | Link (dynamic/unlabelled) | href | Pending |
| 302 | Article | href | Pending |
| 313 | div (dynamic/unlabelled) | onClick, onDoubleClick | Pending |
| 323 | button (dynamic/unlabelled) | onClick | Pending |
| 349 | MediaGallery (dynamic/unlabelled) | onDoubleClick | Pending |
| 356 | Part of a thread · view previous | onClick, href | Pending |
| 359 | Fact check added | onClick, href | Pending |
| 367 | a (dynamic/unlabelled) | href | Pending |
| 413 | Link (dynamic/unlabelled) | onClick, href | Pending |
| 415 | a (dynamic/unlabelled) | onClick, href | Pending |
| 423 | button (dynamic/unlabelled) | onClick | Pending |
| 428 | Link (dynamic/unlabelled) | href | Pending |
| 434 | button (dynamic/unlabelled) | onClick | Pending |
| 436 | See who reposted | onClick | Pending |
| 440 | Repost | onClick | Pending |
| 441 | Quote | onClick | Pending |
| 446 | button (dynamic/unlabelled) | onClick | Pending |
| 450 | See who liked this | onClick | Pending |
| 455 | button (dynamic/unlabelled) | onClick | Pending |
| 464 | Check status | onClick | Pending |
| 466 | div (dynamic/unlabelled) | onClick | Pending |

### web/components/PostMediaEditor.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 37 | video (dynamic/unlabelled) | onPlay, onPause | Pending |
| 118 | Cancel · of Apply | onKeyDown | Pending |
| 120 | Cancel | onClick | Pending |
| 120 | Apply | onClick | Pending |
| 126 | video (dynamic/unlabelled) | onPlay, onPause | Pending |
| 131 | button (dynamic/unlabelled) | onKeyDown, onKeyUp, onBlur | Pending |
| 135 | button (dynamic/unlabelled) | onClick | Pending |
| 136 | Straighten | onChange | Pending |
| 136 | Zoom | onChange | Pending |
| 137 | Rotate | onClick | Pending |
| 137 | Flip | onClick | Pending |
| 137 | button (dynamic/unlabelled) | onClick | Pending |
| 138 | Reset crop | onClick | Pending |
| 140 | button (dynamic/unlabelled) | onClick | Pending |
| 140 | Strength | onChange | Pending |
| 140 | Reset filter | onClick | Pending |
| 141 | button (dynamic/unlabelled) | onClick | Pending |
| 141 | Slider (dynamic/unlabelled) | onChange | Pending |
| 141 | Reset adjustments | onClick | Pending |
| 142 | input (dynamic/unlabelled) | onChange | Pending |
| 143 | button (dynamic/unlabelled) | onClick | Pending |
| 143 | Trim start | onChange | Pending |
| 143 | Trim end | onChange | Pending |
| 143 | Original audio | onClick | Pending |
| 143 | Video speed | onChange | Pending |
| 144 | button (dynamic/unlabelled) | onClick | Pending |
| 144 | button (dynamic/unlabelled) | onClick | Pending |
| 145 | Selected frame | onChange | Pending |
| 145 | Video frame | onClick | Pending |
| 145 | Upload cover | onClick | Pending |
| 145 | input (dynamic/unlabelled) | onChange | Pending |
| 145 | Adjust crop › | onClick | Pending |
| 146 | Video caption | onChange | Pending |
| 146 | Aa | onClick | Pending |
| 146 | Caption start in seconds | onChange, onBlur | Pending |
| 146 | Caption end in seconds | onChange, onBlur | Pending |
| 146 | button (dynamic/unlabelled) | onClick | Pending |
| 146 | · | onClick | Pending |
| 146 | button (dynamic/unlabelled) | onClick | Pending |
| 146 | Add another caption + | onClick | Pending |
| 149 | button (dynamic/unlabelled) | onClick | Pending |
| 155 | input (dynamic/unlabelled) | onChange | Pending |

### web/components/PostMenu.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 122 | InsightsModal (dynamic/unlabelled) | onClose | Pending |
| 123 | PromoteModal (dynamic/unlabelled) | onClose | Pending |
| 124 | FactCheckModal (dynamic/unlabelled) | onClose | Pending |
| 125 | EditPostModal (dynamic/unlabelled) | onClose | Pending |
| 126 | More | onClick | Pending |
| 137 | button (dynamic/unlabelled) | onClick | Pending |
| 143 | Copy post text | onClick | Pending |
| 148 | Not interested | onClick | Pending |
| 149 | Show less from this author | onClick | Pending |
| 150 | Report post | onClick | Pending |
| 151 | Add fact check | onClick | Pending |
| 152 | Block author | onClick | Pending |
| 156 | Edit post | onClick | Pending |
| 157 | View insights | onClick | Pending |
| 158 | Promote post | onClick | Pending |
| 159 | Add to thread | onClick | Pending |
| 160 | Toggle sensitive media | onClick | Pending |
| 161 | Pin or unpin on profile | onClick | Pending |
| 162 | Turn comments off or on | onClick | Pending |
| 163 | Archive post | onClick | Pending |
| 164 | Delete post | onClick | Pending |

### web/components/PostSoundtrack.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 36 | Retry | onClick | Pending |
| 37 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/PrivateMediaViewer.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 21 | video (dynamic/unlabelled) | onPlay, onPause | Pending |
| 35 | video | onClick | Pending |
| 266 | Close | onClick | Pending |
| 285 | input (dynamic/unlabelled) | onChange | Pending |
| 301 | button (dynamic/unlabelled) | onClick | Pending |
| 315 | div (dynamic/unlabelled) | onDragStart | Pending |
| 352 | Return to chat | onClick | Pending |

### web/components/ProductPicker.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 144 | Done | onClick | Pending |
| 156 | button (dynamic/unlabelled) | onClick | Pending |
| 174 | Product name | onChange | Pending |
| 176 | button (dynamic/unlabelled) | onClick | Pending |
| 177 | Price, optional | onChange | Pending |
| 179 | Product link, https:// | onChange | Pending |
| 180 | Image link, optional | onChange | Pending |
| 182 | Add product | onClick | Pending |
| 183 | Cancel | onClick | Pending |
| 187 | Add an external product | onClick | Pending |
| 195 | shop.intobank.app | onChange, onKeyDown | Pending |
| 196 | button (dynamic/unlabelled) | onClick | Pending |
| 197 | Close | onClick | Pending |
| 204 | Add all | onClick | Pending |
| 210 | button (dynamic/unlabelled) | onClick | Pending |
| 228 | Import from your shop feed | onClick | Pending |

### web/components/ProfileContext.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 55 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/ProfileMoreMenu.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 59 | div (dynamic/unlabelled) | onKeyDown | Pending |
| 60 | More options | onClick | Pending |
| 65 | button (dynamic/unlabelled) | onClick | Pending |
| 67 | Report account | onSubmit | Pending |
| 75 | select (dynamic/unlabelled) | onChange | Pending |
| 76 | For impersonation, include a link to the real person or organisation. | onChange | Pending |
| 79 | Close | onClick | Pending |
| 81 | button (dynamic/unlabelled) | onClick | Pending |
| 84 | Report account | onClick | Pending |
| 85 | Block | onClick | Pending |

### web/components/ProfilePosts.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 88 | Posts | onClick | Pending |
| 89 | Media | onClick | Pending |

### web/components/PromoteModal.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 32 | Promote this post | onClick | Pending |
| 33 | Promote this post | onClick | Pending |
| 36 | Close | onClick | Pending |
| 44 | input (dynamic/unlabelled) | onChange | Pending |
| 48 | 1 day 7 days 30 days Until I stop it | onChange | Pending |
| 57 | e.g. 5000 | onChange | Pending |
| 60 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/RichText.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 12 | Link (dynamic/unlabelled) | onClick, href | Pending |
| 19 | Link (dynamic/unlabelled) | onClick, href | Pending |

### web/components/SaveToMemory.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 26 | Choose memory book | onClick | Pending |
| 26 | Close | onClick | Pending |
| 26 | Retry | onClick | Pending |
| 26 | button (dynamic/unlabelled) | onClick | Pending |
| 26 | Happy moments | onChange | Pending |
| 26 | Book design | onChange | Pending |
| 26 | Create and add | onClick | Pending |
| 28 | button (dynamic/unlabelled) | onClick | Pending |
| 28 | Save to memory book | onClick | Pending |

### web/components/SellerReviews.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 117 | Retry | onClick | Pending |
| 132 | Completed purchase Choose a completed order | onSubmit | Pending |
| 166 | Choose a completed order | onChange | Pending |
| 197 | button (dynamic/unlabelled) | onClick | Pending |
| 216 | textarea (dynamic/unlabelled) | onChange | Pending |
| 265 | Report review | onClick | Pending |
| 273 | MarketReportForm (dynamic/unlabelled) | onClose | Pending |
| 283 | Load older reviews | onClick | Pending |

### web/components/SettingsNavigation.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 15 | Link (dynamic/unlabelled) | href | Pending |
| 18 | Exit settings to Home | href | Pending |

### web/components/ShareDetails.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 12 | Cancel | onCancel | Pending |
| 14 | input (dynamic/unlabelled) | onChange | Pending |
| 14 | input (dynamic/unlabelled) | onChange | Pending |
| 14 | input (dynamic/unlabelled) | onChange | Pending |
| 14 | Use my current location | onClick | Pending |
| 15 | Cancel | onClick | Pending |
| 15 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/ShareMenu.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 135 | Share post | onClick | Pending |
| 145 | Back | onClick | Pending |
| 146 | Cancel | onClick | Pending |
| 148 | Retry loading | onClick | Pending |
| 156 | button (dynamic/unlabelled) | onClick | Pending |
| 163 | button (dynamic/unlabelled) | onClick | Pending |
| 170 | button (dynamic/unlabelled) | onClick | Pending |
| 179 | Add to story | onClick, href | Pending |
| 180 | Copy link | onClick | Pending |
| 183 | Share via… | onClick | Pending |
| 184 | Send to… | onClick | Pending |

### web/components/SharedPostCard.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 33 | Link (dynamic/unlabelled) | href | Pending |

### web/components/SharedPostStory.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 47 | Link (dynamic/unlabelled) | href | Pending |
| 52 | Open shared post | href | Pending |
| 58 | button (dynamic/unlabelled) | onClick | Pending |
| 61 | Link (dynamic/unlabelled) | href | Pending |
| 62 | View post | href | Pending |

### web/components/SocialPageFooter.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 9 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/SoundtrackPicker.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 30 | input (dynamic/unlabelled) | onChange | Pending |
| 36 | Music Music unavailable Back to editing | onKeyDown, onClick | Pending |
| 36 | Close music | onClick | Pending |
| 36 | Remove selected music | onClick | Pending |
| 36 | Back to editing | onClick | Pending |
| 37 | div (dynamic/unlabelled) | onClick, onKeyDown | Pending |
| 38 | button (dynamic/unlabelled) | onClick | Pending |
| 38 | button (dynamic/unlabelled) | onClick | Pending |
| 40 | Search music | onChange | Pending |
| 40 | Clear music search | onClick | Pending |
| 40 | button (dynamic/unlabelled) | onClick | Pending |
| 42 | button (dynamic/unlabelled) | onClick | Pending |
| 44 | · | onClick | Pending |
| 44 | button (dynamic/unlabelled) | onClick | Pending |
| 44 | button (dynamic/unlabelled) | onClick | Pending |
| 47 | Replace | onClick | Pending |
| 51 | button (dynamic/unlabelled) | onClick | Pending |
| 51 | Remove music | onClick | Pending |
| 53 | button (dynamic/unlabelled) | onClick | Pending |
| 54 | button (dynamic/unlabelled) | onClick | Pending |
| 57 | button (dynamic/unlabelled) | onClick | Pending |
| 57 | Use track | onClick | Pending |

### web/components/StoryAudioEditor.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 17 | Video sound volume | onChange | Pending |
| 77 | Search story sounds | onChange | Pending |
| 78 | button (dynamic/unlabelled) | onClick | Pending |
| 79 | Remove | onClick | Pending |
| 80 | audio (dynamic/unlabelled) | onPlay, onPause | Pending |
| 82 | button (dynamic/unlabelled) | onClick | Pending |
| 82 | button (dynamic/unlabelled) | onClick | Pending |
| 82 | button (dynamic/unlabelled) | onClick | Pending |
| 85 | Your original audio | onClick | Pending |
| 86 | input (dynamic/unlabelled) | onChange | Pending |
| 86 | input (dynamic/unlabelled) | onChange | Pending |
| 86 | button (dynamic/unlabelled) | onClick | Pending |
| 87 | input (dynamic/unlabelled) | onChange | Pending |
| 88 | Video sound volume | onChange | Pending |
| 88 | Added sound volume | onChange | Pending |
| 89 | Retry | onClick | Pending |

### web/components/StoryAvatar.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 50 | View story | onClick | Pending |
| 54 | StoryViewer (dynamic/unlabelled) | onClose | Pending |
| 64 | Link (dynamic/unlabelled) | onClick, href | Pending |

### web/components/StoryCapture.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 11 | button (dynamic/unlabelled) | onClick | Pending |
| 58 | StoryLensesCapture (dynamic/unlabelled) | onClose, onBack | Pending |
| 61 | section (dynamic/unlabelled) | onKeyDown | Pending |
| 63 | button (dynamic/unlabelled) | onClick | Pending |
| 63 | button (dynamic/unlabelled) | onClick | Pending |
| 64 | Retake scene | onClick | Pending |
| 65 | Cancel capture | onClick | Pending |
| 66 | Retry Boomerang | onClick | Pending |
| 66 | Retake | onClick | Pending |
| 66 | Try camera again | onClick | Pending |
| 66 | button (dynamic/unlabelled) | onClick | Pending |
| 68 | button (dynamic/unlabelled) | onClick | Pending |
| 68 | PhotoSlot (dynamic/unlabelled) | onRemove | Pending |
| 68 | Create layout | onClick | Pending |
| 69 | button (dynamic/unlabelled) | onClick | Pending |
| 70 | button (dynamic/unlabelled) | onClick | Pending |
| 71 | button (dynamic/unlabelled) | onClick | Pending |
| 71 | button (dynamic/unlabelled) | onClick | Pending |
| 74 | Layout photo files | onChange | Pending |

### web/components/StoryComposer.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 538 | video (dynamic/unlabelled) | onPause, onPlay | Pending |
| 546 | button (dynamic/unlabelled) | onClick | Pending |
| 548 | Search people | onChange | Pending |
| 549 | @ | onClick | Pending |
| 550 | button (dynamic/unlabelled) | onClick | Pending |
| 555 | StoryCapture (dynamic/unlabelled) | onClose | Pending |
| 557 | Back to story editing | onClick | Pending |
| 557 | Back to home | href | Pending |
| 559 | Archive | href | Pending |
| 561 | Done | href | Pending |
| 564 | Retry loading post | onClick | Pending |
| 567 | Continue saved story | onClick | Pending |
| 569 | Delete draft | onClick | Pending |
| 570 | Open camera | onClick | Pending |
| 570 | button (dynamic/unlabelled) | onClick | Pending |
| 570 | Create with text | onClick | Pending |
| 572 | StoryEditor (dynamic/unlabelled) | onChange, onNext, onClose | Pending |
| 578 | button (dynamic/unlabelled) | onClick | Pending |
| 580 | button (dynamic/unlabelled) | onClick | Pending |
| 581 | More audience options | onClick | Pending |
| 582 | Allow story replies | onChange | Pending |
| 583 | Add a caption… | onChange | Pending |
| 587 | input (dynamic/unlabelled) | onChange | Pending |
| 588 | Who can see this? Done Choose the audience for this story. | onClick | Pending |
| 588 | Done | onClick | Pending |
| 589 | Cancel Done | onClick | Pending |
| 589 | Cancel | onClick | Pending |
| 589 | Done | onClick | Pending |
| 590 | button (dynamic/unlabelled) | onClick | Pending |
| 591 | Timing & layers | onClick | Pending |
| 592 | button (dynamic/unlabelled) | onClick | Pending |
| 593 | button (dynamic/unlabelled) | onClick | Pending |
| 593 | Filter intensity | onChange | Pending |
| 594 | button (dynamic/unlabelled) | onClick | Pending |
| 594 | input (dynamic/unlabelled) | onChange | Pending |
| 594 | Hold to compare | onBlur, onKeyDown, onKeyUp | Pending |
| 594 | Reset | onClick | Pending |
| 595 | Fit full image | onClick | Pending |
| 595 | Fill canvas | onClick | Pending |
| 595 | Media zoom | onChange | Pending |
| 595 | input (dynamic/unlabelled) | onChange | Pending |
| 596 | input (dynamic/unlabelled) | onChange | Pending |
| 596 | input (dynamic/unlabelled) | onChange | Pending |
| 596 | select (dynamic/unlabelled) | onChange | Pending |
| 597 | Reset frame | onClick | Pending |
| 602 | StoryDrawStudio (dynamic/unlabelled) | onCancel | Pending |
| 605 | div (dynamic/unlabelled) | onClick | Pending |
| 605 | Close sound controls | onClick | Pending |
| 605 | StoryAudioEditor (dynamic/unlabelled) | onChange | Pending |
| 606 | StoryTiming (dynamic/unlabelled) | onClose, onToggle, onSeek, onChange | Pending |
| 610 | Retry remaining uploads | onClick | Pending |
| 612 | button (dynamic/unlabelled) | onClick | Pending |
| 613 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/StoryDrawStudio.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 37 | Draw on story | onKeyDown | Pending |
| 38 | Cancel | onClick | Pending |
| 38 | Done | onClick | Pending |
| 40 | button (dynamic/unlabelled) | onClick | Pending |
| 40 | button (dynamic/unlabelled) | onClick | Pending |
| 40 | Custom pen color | onChange | Pending |
| 40 | Pen width | onChange | Pending |
| 40 | Undo drawing | onClick | Pending |
| 40 | Redo drawing | onClick | Pending |
| 40 | Clear drawing | onClick | Pending |

### web/components/StoryEditor.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 175 | button (dynamic/unlabelled) | onClick, onKeyDown | Pending |
| 188 | Remove current story media | onClick | Pending |
| 190 | Add story text | onClick | Pending |
| 191 | Open story stickers | onClick | Pending |
| 192 | button (dynamic/unlabelled) | onClick | Pending |
| 193 | Edit story media | onClick | Pending |
| 195 | button (dynamic/unlabelled) | onClick | Pending |
| 196 | Undo story edit | onClick | Pending |
| 196 | Redo story edit | onClick | Pending |
| 198 | button (dynamic/unlabelled) | onClick | Pending |
| 198 | button (dynamic/unlabelled) | onClick | Pending |
| 198 | Add story clips | onClick | Pending |
| 198 | button (dynamic/unlabelled) | onClick | Pending |
| 200 | Text | onClick | Pending |
| 201 | Stickers | onClick | Pending |
| 202 | button (dynamic/unlabelled) | onClick | Pending |
| 203 | Draw on story | onClick | Pending |
| 204 | Edit | onClick | Pending |
| 205 | Next | onClick | Pending |
| 211 | Cancel | onClick | Pending |
| 211 | Done editing sticker | onClick | Pending |
| 212 | Story text | onChange | Pending |
| 214 | button (dynamic/unlabelled) | onClick | Pending |
| 215 | button (dynamic/unlabelled) | onClick | Pending |
| 215 | ☰ | onClick | Pending |
| 215 | Text size | onChange | Pending |
| 216 | button (dynamic/unlabelled) | onClick | Pending |
| 216 | Sticker colour | onChange | Pending |
| 216 | Text opacity | onChange | Pending |
| 217 | Readable background | onClick | Pending |
| 217 | Align | onClick | Pending |
| 217 | Sticker rotation | onChange | Pending |
| 218 | button (dynamic/unlabelled) | onClick | Pending |
| 219 | Timing & layers | onClick | Pending |
| 219 | Remove text | onClick | Pending |
| 225 | button (dynamic/unlabelled) | onClick | Pending |
| 227 | Search stickers | onChange | Pending |
| 228 | button (dynamic/unlabelled) | onClick | Pending |
| 229 | button (dynamic/unlabelled) | onClick | Pending |
| 229 | button (dynamic/unlabelled) | onClick | Pending |
| 233 | textarea (dynamic/unlabelled) | onChange | Pending |
| 234 | https:// | onChange | Pending |
| 235 | textarea (dynamic/unlabelled) | onChange | Pending |
| 235 | select (dynamic/unlabelled) | onChange | Pending |
| 236 | input (dynamic/unlabelled) | onChange | Pending |
| 237 | · @ | onClick | Pending |
| 237 | Add to story | onClick | Pending |
| 240 | textarea (dynamic/unlabelled) | onChange | Pending |
| 241 | button (dynamic/unlabelled) | onClick | Pending |
| 242 | button (dynamic/unlabelled) | onClick | Pending |
| 242 | Sticker size | onChange | Pending |
| 243 | button (dynamic/unlabelled) | onClick | Pending |
| 243 | Sticker colour | onChange | Pending |
| 243 | Text opacity | onChange | Pending |
| 244 | Readable background | onClick | Pending |
| 244 | Align | onClick | Pending |
| 244 | Sticker rotation | onChange | Pending |
| 245 | button (dynamic/unlabelled) | onClick | Pending |
| 246 | Sticker size | onChange | Pending |
| 246 | Sticker rotation | onChange | Pending |
| 247 | Centre | onClick | Pending |
| 247 | Bring to front | onClick | Pending |
| 247 | Send to back | onClick | Pending |
| 247 | Remove sticker | onClick | Pending |

### web/components/StoryEngageCards.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 40 | Retry | onClick | Pending |
| 58 | Your answer | onChange, onKeyDown | Pending |
| 59 | Send | onClick | Pending |
| 86 | button (dynamic/unlabelled) | onClick | Pending |
| 118 | input (dynamic/unlabelled) | onChange, onKeyUp | Pending |
| 150 | Add your story | href | Pending |
| 160 | button (dynamic/unlabelled) | onClick | Pending |
| 171 | ♥ SUPPORT | href | Pending |

### web/components/StoryEngine.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 203 | › | href | Pending |

### web/components/StoryLensesCapture.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 121 | Snapchat Lens camera | onKeyDown | Pending |
| 131 | Back to capture modes | onClick | Pending |
| 131 | Close Lens camera | onClick | Pending |
| 132 | Back to camera | onClick | Pending |
| 132 | Try lenses again | onClick | Pending |
| 132 | Other capture modes | onClick | Pending |
| 134 | Search available Snapchat lenses | onChange | Pending |
| 134 | Clear lens search | onClick | Pending |
| 135 | Original | onClick | Pending |
| 135 | button (dynamic/unlabelled) | onClick | Pending |
| 137 | button (dynamic/unlabelled) | onClick | Pending |
| 138 | Switch Lens camera | onClick | Pending |
| 138 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/StoryLink.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 35 | StoryViewer (dynamic/unlabelled) | onClose | Pending |
| 36 | Link (dynamic/unlabelled) | href | Pending |

### web/components/StoryPollCard.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 29 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/StoryRings.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 129 | View your story | onClick | Pending |
| 132 | Add to your story | href | Pending |
| 136 | Create a story | href | Pending |
| 141 | button (dynamic/unlabelled) | onClick | Pending |
| 164 | StoryViewer (dynamic/unlabelled) | onClose | Pending |

### web/components/StoryTiming.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 51 | button (dynamic/unlabelled) | onKeyDown | Pending |
| 68 | Back to story editing | onClick | Pending |
| 68 | Done | onClick | Pending |
| 70 | button (dynamic/unlabelled) | onClick | Pending |
| 70 | Preview time | onChange | Pending |
| 73 | Video | onChange, onSeek | Pending |
| 74 | LayerRange (dynamic/unlabelled) | onSeek, onChange | Pending |

### web/components/StoryViewer.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 54 | @ | href | Pending |
| 78 | a (dynamic/unlabelled) | onClick, href | Pending |
| 96 | 🔗 | href | Pending |
| 102 | # | href | Pending |
| 105 | 📍 | href | Pending |
| 112 | @ Mentioned you | href | Pending |
| 631 | Close story viewer | onClick | Pending |
| 635 | Previous | onClick | Pending |
| 639 | Next | onClick | Pending |
| 669 | button (dynamic/unlabelled) | onClick | Pending |
| 670 | button (dynamic/unlabelled) | onClick | Pending |
| 671 | Close story | onClick | Pending |
| 687 | video (dynamic/unlabelled) | onPlay | Pending |
| 718 | Retry | onClick | Pending |
| 726 | audio (dynamic/unlabelled) | onPlay | Pending |
| 751 | a (dynamic/unlabelled) | onClick, href | Pending |
| 764 | Try again | onClick | Pending |
| 768 | Previous | onClick | Pending |
| 769 | div (dynamic/unlabelled) | onDoubleClick | Pending |
| 770 | Next | onClick | Pending |
| 776 | input (dynamic/unlabelled) | onChange, onFocus, onBlur, onKeyDown | Pending |
| 786 | Send reply | onClick | Pending |
| 792 | Love | onClick | Pending |
| 795 | React | onClick | Pending |
| 805 | button (dynamic/unlabelled) | onClick | Pending |
| 814 | Story views | onClick | Pending |
| 816 | Story activity | onClick | Pending |
| 818 | Story options | onClick | Pending |
| 821 | Story settings View story activity Delete story | onClick | Pending |
| 821 | Story settings | onClick | Pending |
| 822 | Close story settings | onClick | Pending |
| 823 | button (dynamic/unlabelled) | onClick | Pending |
| 824 | View story activity | onClick | Pending |
| 825 | Delete story | onClick | Pending |
| 828 | ViewersSheet (dynamic/unlabelled) | onClose | Pending |
| 858 | Story activity Story settings | onClick | Pending |
| 859 | Story activity | onClick | Pending |
| 860 | Close story activity | onClick | Pending |
| 862 | button (dynamic/unlabelled) | onClick | Pending |
| 863 | Try again | onClick | Pending |
| 867 | a (dynamic/unlabelled) | href | Pending |
| 869 | Story settings | onClick | Pending |

### web/components/StudioShell.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 95 | Business sign in | href | Pending |
| 106 | ACCESS CODE | onChange, onKeyDown | Pending |
| 109 | button (dynamic/unlabelled) | onClick | Pending |
| 132 | View public profile | href | Pending |
| 146 | Link (dynamic/unlabelled) | href | Pending |
| 182 | Link (dynamic/unlabelled) | href | Pending |

### web/components/StudioSideRail.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 75 | Link (dynamic/unlabelled) | href | Pending |
| 91 | Link (dynamic/unlabelled) | href | Pending |
| 104 | Reviews | action | Pending |
| 122 | @ | href | Pending |

### web/components/ThemeToggle.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 25 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/TopBar.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 58 | Platinum Circles home | href | Pending |
| 64 | Create a post | href | Pending |
| 67 | Discover | href | Pending |
| 70 | Link (dynamic/unlabelled) | href | Pending |
| 80 | Account menu | onClick | Pending |
| 97 | Your profile | onClick, href | Pending |
| 100 | Sign out | onClick | Pending |

### web/components/VideoPlayer.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 246 | Video player | onKeyDown | Pending |
| 250 | video (dynamic/unlabelled) | onClick, onDoubleClick, onPlay, onPause | Pending |
| 287 | Play video | onClick | Pending |
| 290 | Retry video | onClick | Pending |
| 293 | / | onClick | Pending |
| 294 | Video position | onChange | Pending |
| 297 | button (dynamic/unlabelled) | onClick | Pending |
| 298 | Back 10 seconds | onClick | Pending |
| 299 | Forward 10 seconds | onClick | Pending |
| 300 | Mute or unmute (M) | onClick | Pending |
| 302 | Playback speed | onChange | Pending |
| 303 | button (dynamic/unlabelled) | onClick | Pending |
| 304 | Open theater view | onClick | Pending |
| 305 | Picture in picture (P) | onClick | Pending |
| 306 | Fullscreen (F) | onClick | Pending |

### web/components/WebCallLayer.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 357 | Dismiss | onClick | Pending |
| 367 | Decline | onClick | Pending |
| 368 | Answer | onClick | Pending |
| 373 | End call | onClick | Pending |
| 380 | Close | onClick | Pending |

### web/components/memory/MemoryBookDesigner.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 18 | New memory book | onKeyDown | Pending |
| 19 | button (dynamic/unlabelled) | onClick | Pending |
| 19 | button (dynamic/unlabelled) | onClick | Pending |
| 21 | Retry stories | onClick | Pending |
| 22 | Postcards | onChange | Pending |
| 22 | A weekend away | onChange | Pending |
| 24 | button (dynamic/unlabelled) | onClick | Pending |
| 25 | button (dynamic/unlabelled) | onClick | Pending |
| 26 | button (dynamic/unlabelled) | onClick | Pending |
| 28 | button (dynamic/unlabelled) | onClick | Pending |
| 29 | button (dynamic/unlabelled) | onClick | Pending |

### web/components/memory/MemoryPageImage.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 23 | Retry memory image | onClick | Pending |

### web/components/memory/MemoryPageTurn.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 40 | Previous page | onClick | Pending |
| 41 | Next page | onClick | Pending |

### web/components/ui.tsx

| Source line | Control or label | Interaction | Runtime result |
| ---: | --- | --- | --- |
| 60 | Link (dynamic/unlabelled) | href | Pending |
| 76 | Link (dynamic/unlabelled) | href | Pending |
| 120 | Link (dynamic/unlabelled) | href | Pending |
| 134 | Link (dynamic/unlabelled) | href | Pending |
| 157 | button (dynamic/unlabelled) | onClick | Pending |

## Files with no directly inventoried bindings

These files may delegate actions to shared components, use dynamic handlers outside this scan, or display content without direct controls. A zero count does not certify that a screen has no actions.

- admin-web/app/audit/page.tsx
- admin-web/app/calls/page.tsx
- admin-web/app/content/page.tsx
- admin-web/app/jobs/page.tsx
- admin-web/app/layout.tsx
- admin-web/app/present/page.tsx
- admin-web/app/queue/page.tsx
- admin-web/app/signin/page.tsx
- admin-web/app/stories/page.tsx
- admin-web/components/AuthPanel.tsx
- admin-web/components/ClientDiagnostics.tsx
- admin-web/components/PermissionGate.tsx
- admin-web/components/Seal.tsx
- admin-web/components/StoryAdjustOverlay.tsx
- admin-web/components/Workspace.tsx
- src/components/AdaptiveTabBar.tsx
- src/components/BuiltInZimbabweStrip.tsx
- src/components/CallEventBubble.tsx
- src/components/EmptyState.tsx
- src/components/KeyboardDebugOverlay.tsx
- src/components/KeyboardSafe.tsx
- src/components/LaunchVeil.tsx
- src/components/OfflineBanner.tsx
- src/components/PaymentBubble.tsx
- src/components/PlatinumCirclesLogo.tsx
- src/components/PostCaption.tsx
- src/components/ProfileTabAvatar.tsx
- src/components/SafeArea.tsx
- src/components/SafeImage.tsx
- src/components/Skeleton.tsx
- src/components/SplashLoader.tsx
- src/components/TapTopList.tsx
- src/components/TierName.tsx
- src/components/VerifiedBadge.tsx
- src/components/VideoThumb.tsx
- src/components/brand/PearlMark.tsx
- src/components/common/Avatar.tsx
- src/components/layout/AppScreen.tsx
- src/components/memory/MemoryBookCover.tsx
- src/components/memory/MemoryStoryFrame.tsx
- src/components/messages/PrivateCameraGuard.tsx
- src/components/skeletons/index.tsx
- src/components/stories/ConfettiBurst.tsx
- src/components/stories/DraggableSticker.tsx
- src/components/stories/EnvironmentLayer.tsx
- src/components/stories/MemoryCaption.tsx
- src/components/stories/MemoryProgressArc.tsx
- src/components/stories/PlatinumRing.tsx
- src/components/stories/PollDragWrap.tsx
- src/components/stories/ResultsStickerCard.tsx
- src/components/stories/StickerGalleryPreview.tsx
- src/components/stories/StickerIcons.tsx
- src/components/stories/StoryProgressBar.tsx
- src/components/stories/ZoomableMedia.tsx
- src/contexts/CallContext.tsx
- src/screens/stories/BoomerangWeb.tsx
- src/screens/stories/CameraKitLensView.tsx
- web/app/[username]/layout.tsx
- web/app/[username]/loading.tsx
- web/app/ads/layout.tsx
- web/app/album/[id]/loading.tsx
- web/app/album/[id]/page.tsx
- web/app/album/layout.tsx
- web/app/archive/layout.tsx
- web/app/archive/loading.tsx
- web/app/businesses/layout.tsx
- web/app/channels/layout.tsx
- web/app/communities/layout.tsx
- web/app/discover/layout.tsx
- web/app/discover/loading.tsx
- web/app/explore/layout.tsx
- web/app/home/layout.tsx
- web/app/home/page.tsx
- web/app/jobs/[id]/loading.tsx
- web/app/jobs/layout.tsx
- web/app/jobs/messages/loading.tsx
- web/app/jobs/messages/page.tsx
- web/app/layout.tsx
- web/app/loading.tsx
- web/app/market/layout.tsx
- web/app/market/messages/loading.tsx
- web/app/market/messages/page.tsx
- web/app/messages/layout.tsx
- web/app/messages/loading.tsx
- web/app/messages/page.tsx
- web/app/monetization/layout.tsx
- web/app/notifications/layout.tsx
- web/app/opengraph-image.tsx
- web/app/page.tsx
- web/app/post/[id]/loading.tsx
- web/app/saved/layout.tsx
- web/app/search/layout.tsx
- web/app/settings/layout.tsx
- web/app/settings/standing/page.tsx
- web/app/story/[id]/page.tsx
- web/app/story/new/page.tsx
- web/app/studio/layout.tsx
- web/app/topic/layout.tsx
- web/components/AudienceBreakdown.tsx
- web/components/BootSplash.tsx
- web/components/Charts.tsx
- web/components/ClientDiagnostics.tsx
- web/components/MarketUnreadDot.tsx
- web/components/PersonName.tsx
- web/components/PostCaption.tsx
- web/components/PrivateCameraGuard.tsx
- web/components/RecruiterFunnel.tsx
- web/components/RelativeTime.tsx
- web/components/ScrollMemory.tsx
- web/components/SellerTrust.tsx
- web/components/SponsoredCard.tsx
- web/components/StoryAdjustOverlay.tsx
- web/components/StoryPixelGrade.tsx
- web/components/StoryStickerPreview.tsx
- web/components/StudioRailPortal.tsx
- web/components/ThemeProvider.tsx
- web/components/VerifiedBadge.tsx
- web/components/Wordmark.tsx
- web/components/memory/MemoryBookCover.tsx
- web/components/memory/MemoryStoryFrame.tsx
- web/components/memory/MemoryStoryPreview.tsx
