# Projekthistorie

Diese Übersicht dokumentiert die Entwicklung von Respawn aus der verifizierten Git- und
GitHub-Historie. Gemergte Pull Requests erhalten eine Datei unter `docs/changelog/pr/`; die
zugehörigen Arbeitsbranches sind unter `docs/changelog/branches/` erfasst.

Stand: 2026-07-21 · Basis: `main` auf `cfc1aac` · Ab PR #214 vollständig: alle 33 tatsächlich
gemergten PRs sind dokumentiert. #214–#225, #249 und #254 wurden nicht gemergt und erhalten daher
keinen Eintrag. Beim Vollabgleich fielen neun ältere, nicht zu R5 gehörende Lücken auf:
#90, #93, #94, #96, #97, #99, #197, #204 und #205.

## Übersicht

- Gemergte PRs dokumentiert: 176
- Branch-Seiten dokumentiert: 136
- Gemergte PRs ab #214: 33 von 33 dokumentiert
- Technische Synchronisations-Merges ohne eigenen PR sind nicht als eigene Feature-Einträge aufgeführt.

## Chronologie

| Datum | PR | Änderung | Branch |
|---|---:|---|---|
| 2026-07-21 | [#260](https://github.com/blorbeer-cmd/LAN_2026/pull/260) | [R3: Mehrgruppen-Kommentare auf Ein-Gruppen-Modell ausrichten](pr/pr-260-align-multi-group-comments-with-single-group-model.md) | `codex/reset-plan-r3` |
| 2026-07-21 | [#259](https://github.com/blorbeer-cmd/LAN_2026/pull/259) | [Fix broken main (semantic conflict #253×#257) + record PR #257 changelog](pr/pr-259-fix-broken-main-semantic-conflict-and-record-pr-257-changelog.md) | `claude/reset-plan-r4-migrations-v0zond` |
| 2026-07-21 | [#258](https://github.com/blorbeer-cmd/LAN_2026/pull/258) | [R2: remove multi-group surface, keep single-group model](pr/pr-258-remove-multi-group-surface-keep-single-group-model.md) | `claude/reset-phase-r2-multigroup-removal-u8s7j6` |
| 2026-07-21 | [#257](https://github.com/blorbeer-cmd/LAN_2026/pull/257) | [R4: Run DB migrations in version order and guard v44 schema changes (F7 + F8)](pr/pr-257-run-db-migrations-in-version-order-and-guard-v44-schema-changes.md) | `claude/reset-plan-r4-migrations-v0zond` |
| 2026-07-21 | [#256](https://github.com/blorbeer-cmd/LAN_2026/pull/256) | [docs: add changelog entry for merged PR #255](pr/pr-256-add-changelog-entry-for-merged-pr-255.md) | `claude/konzept-rev5-single-group-k78eou` |
| 2026-07-21 | [#255](https://github.com/blorbeer-cmd/LAN_2026/pull/255) | [R0: rewrite user-management concept as Rev. 5 single-group model](pr/pr-255-rewrite-user-management-concept-as-rev-5-single-group-model.md) | `claude/konzept-rev5-single-group-k78eou` |
| 2026-07-21 | [#253](https://github.com/blorbeer-cmd/LAN_2026/pull/253) | [Packliste: To-Do-System (Konzept + Umsetzung)](pr/pr-253-packliste-to-do-system-concept-and-implementation.md) | `claude/packliste-ticket-concept-40kaqe` |
| 2026-07-21 | [#252](https://github.com/blorbeer-cmd/LAN_2026/pull/252) | [Rename Anreise to Ankunft and sync it with carpool plans](pr/pr-252-rename-anreise-to-ankunft-and-sync-it-with-carpool-plans.md) | `claude/ankunft-abreise-adjustments-cb8tvs` |
| 2026-07-20 | [#251](https://github.com/blorbeer-cmd/LAN_2026/pull/251) | [Stabilize the two remaining flows-E2E flakes at their root causes](pr/pr-251-stabilize-the-two-remaining-flows-e2e-flakes-at-their-root-causes.md) | `claude/search-palette-keyboard-flake` |
| 2026-07-20 | [#250](https://github.com/blorbeer-cmd/LAN_2026/pull/250) | [Add single-group reset plan for user management](pr/pr-250-add-single-group-reset-plan-for-user-management.md) | `claude/session-6x1p4s` |
| 2026-07-20 | [#248](https://github.com/blorbeer-cmd/LAN_2026/pull/248) | [Warn before discarding unsaved entries on modal close/cancel](pr/pr-248-warn-before-discarding-unsaved-entries-on-modal-close-cancel.md) | `claude/delete-confirmation-dialogs-n55op3` |
| 2026-07-20 | [#247](https://github.com/blorbeer-cmd/LAN_2026/pull/247) | [Stop mouse-wheel scroll from changing number-field values](pr/pr-247-stop-mouse-wheel-scroll-from-changing-number-field-values.md) | `claude/zahlenfeld-mausrad-fix-9iwfbb` |
| 2026-07-20 | [#246](https://github.com/blorbeer-cmd/LAN_2026/pull/246) | [Let claimers leave a short comment on packing tasks](pr/pr-246-let-claimers-leave-a-short-comment-on-packing-tasks.md) | `claude/packliste-push-notifications-ri4b3u` |
| 2026-07-20 | [#245](https://github.com/blorbeer-cmd/LAN_2026/pull/245) | [Avoid reload flicker when toggling checklist items and paid status](pr/pr-245-avoid-reload-flicker-when-toggling-checklist-items-and-paid-status.md) | `claude/packliste-abhaken-ruckler-44nl8m` |
| 2026-07-20 | [#244](https://github.com/blorbeer-cmd/LAN_2026/pull/244) | [Teams: ask game and mode first, unify draw/draft readiness feedback](pr/pr-244-teams-ask-game-and-mode-first-unify-draw-draft-readiness-feedback.md) | `claude/teams-section-cleanup-6tg1so` |
| 2026-07-20 | [#243](https://github.com/blorbeer-cmd/LAN_2026/pull/243) | [Sammelzahlung-Summe kopieren, Positionspreis neben Trinkgeld anzeigen](pr/pr-243-sammelzahlung-summe-kopieren-positionspreis-neben-trinkgeld-anzeigen.md) | `claude/sammelbezahlung-summe-kopieren-umx8sd` |
| 2026-07-20 | [#238](https://github.com/blorbeer-cmd/LAN_2026/pull/238) | [Enforce group- and event-scoped realtime delivery](pr/pr-238-enforce-group-and-event-scoped-realtime-delivery.md) | `claude/multigroup-realtime-delivery-pschci` |
| 2026-07-20 | [#236](https://github.com/blorbeer-cmd/LAN_2026/pull/236) | [Stop a viewport-size leak from cascading between e2e tests](pr/pr-236-stop-a-viewport-size-leak-from-cascading-between-e2e-tests.md) | `claude/mobile-skill-slider-jank-i5osw2` |
| 2026-07-19 | [#242](https://github.com/blorbeer-cmd/LAN_2026/pull/242) | [Accept a PayPal email address for food order payment links](pr/pr-242-accept-a-paypal-email-address-for-food-order-payment-links.md) | `claude/paypal-link-eingabe-vereinfachen-9yilwk` |
| 2026-07-19 | [#241](https://github.com/blorbeer-cmd/LAN_2026/pull/241) | [Add order deletion at any lifecycle stage and clarify item checkboxes](pr/pr-241-add-order-deletion-at-any-lifecycle-stage-and-clarify-item-checkboxes.md) | `claude/order-delete-checkboxes-qyqa6a` |
| 2026-07-19 | [#240](https://github.com/blorbeer-cmd/LAN_2026/pull/240) | [Fix checklist event-scope leak and remaining PR #237 review findings](pr/pr-240-fix-checklist-event-scope-leak-and-remaining-pr-237-review-findings.md) | `claude/lan-packing-checklist-tasks-ijg5cp` |
| 2026-07-19 | [#239](https://github.com/blorbeer-cmd/LAN_2026/pull/239) | [Accept a bare PayPal.me name for food order payment links](pr/pr-239-accept-a-bare-paypal-me-name-for-food-order-payment-links.md) | `claude/paypal-link-eingabe-vereinfachen-9yilwk` |
| 2026-07-19 | [#237](https://github.com/blorbeer-cmd/LAN_2026/pull/237) | [Add packing checklist, organizer tasks, and mitbringen requests](pr/pr-237-add-packing-checklist-organizer-tasks-and-mitbringen-requests.md) | `claude/lan-packing-checklist-tasks-ijg5cp` |
| 2026-07-19 | [#235](https://github.com/blorbeer-cmd/LAN_2026/pull/235) | [Fix generic Android push notification icon](pr/pr-235-fix-generic-android-push-notification-icon.md) | `claude/mobile-push-respawn-icon-t82eex` |
| 2026-07-19 | [#234](https://github.com/blorbeer-cmd/LAN_2026/pull/234) | [Fix sticky action bar resting too high above the bottom nav](pr/pr-234-fix-sticky-action-bar-resting-too-high-above-the-bottom-nav.md) | `claude/sticky-buttons-positioning-bx9d2g` |
| 2026-07-19 | [#233](https://github.com/blorbeer-cmd/LAN_2026/pull/233) | [Fix team-draw select buttons wrapping on mobile](pr/pr-233-fix-team-draw-select-buttons-wrapping-on-mobile.md) | `claude/teams-auslosung-button-layout-fheukt` |
| 2026-07-19 | [#232](https://github.com/blorbeer-cmd/LAN_2026/pull/232) | [Implement phase 5d tracking fan-out and consent history](pr/pr-232-implement-phase-5d-tracking-fan-out-and-consent-history.md) | `agent/notification-banner-lifecycle` |
| 2026-07-19 | [#231](https://github.com/blorbeer-cmd/LAN_2026/pull/231) | [Keep vote and team-formation actions reachable without scrolling](pr/pr-231-keep-vote-and-team-formation-actions-reachable-without-scrolling.md) | `claude/sticky-voting-buttons-relyd6` |
| 2026-07-19 | [#230](https://github.com/blorbeer-cmd/LAN_2026/pull/230) | [Phase 5c: Organisation und Kommunikation gruppenbezogen speichern](pr/pr-230-phase-5c-organisation-und-kommunikation-gruppenbezogen-speichern.md) | `agent/phase5c-organization-communication` |
| 2026-07-19 | [#229](https://github.com/blorbeer-cmd/LAN_2026/pull/229) | [Reopen/finalize food orders, PayPal link + tip, paid checkbox](pr/pr-229-reopen-finalize-food-orders-paypal-link-tip-paid-checkbox.md) | `claude/order-item-paid-marking-cuanwi` |
| 2026-07-19 | [#228](https://github.com/blorbeer-cmd/LAN_2026/pull/228) | [Fix Vote page select-all/deselect-all and unify with the two-button pattern](pr/pr-228-fix-vote-page-select-all-deselect-all-and-unify-with-the-two-button-pattern.md) | `claude/select-deselect-all-unify-wdmuf6` |
| 2026-07-19 | [#227](https://github.com/blorbeer-cmd/LAN_2026/pull/227) | [Fix skill slider jank on release in Spiele view](pr/pr-227-fix-skill-slider-jank-on-release-in-spiele-view.md) | `claude/mobile-skill-slider-jank-i5osw2` |
| 2026-07-19 | [#226](https://github.com/blorbeer-cmd/LAN_2026/pull/226) | [fix: keep every seating-plan seat reachable by scroll on phones](pr/pr-226-keep-every-seating-plan-seat-reachable-by-scroll-on-phones.md) | `claude/sitzplan-mobile-cutoff-7yn0m9` |
| 2026-07-18 | main | [Mobile-Layout-Fixes und Info-Popover-Scroll-Race behoben](pr/main-2026-07-18-mobile-layout-and-tooltip-scroll-fixes.md) | `main` |
| 2026-07-18 | [#213](https://github.com/blorbeer-cmd/LAN_2026/pull/213) | [fix flaky admin-count height assertion in E2E flows test](pr/pr-213-fix-flaky-admin-count-height-assertion-in-e2e-flows-test.md) | `fix/e2e-admin-count-height-flake` |
| 2026-07-18 | [#212](https://github.com/blorbeer-cmd/LAN_2026/pull/212) | [fix migration 34 crash on drafts referencing deleted players](pr/pr-212-fix-migration-34-crash-on-drafts-referencing-deleted-players.md) | `claude/mystifying-proskuriakova-a45f34` |
| 2026-07-18 | [#211](https://github.com/blorbeer-cmd/LAN_2026/pull/211) | [ops-disk-cleanup: run nightly too, 24h retention, share deploy's lock](pr/pr-211-ops-disk-cleanup-run-nightly-too-24h-retention-share-deploy-s-lock.md) | `fix-disk-full-image-prune` |
| 2026-07-16 | [#210](https://github.com/blorbeer-cmd/LAN_2026/pull/210) | [fix cloudflared disconnected after rename: pin the compose project name](pr/pr-210-fix-cloudflared-disconnected-after-rename-pin-the-compose-project-name.md) | `fix-cloudflared-network-split` |
| 2026-07-16 | [#209](https://github.com/blorbeer-cmd/LAN_2026/pull/209) | [General UI polish pass with user-management merge integration](pr/pr-209-general-ui-polish-pass-with-user-management-merge-integration.md) | `codex/feedback-general-ui-polish` |
| 2026-07-16 | [#208](https://github.com/blorbeer-cmd/LAN_2026/pull/208) | [scope seating and pings to groups](pr/pr-208-scope-seating-and-pings-to-groups.md) | `codex/phase5c-seating-pings` |
| 2026-07-16 | [#207](https://github.com/blorbeer-cmd/LAN_2026/pull/207) | [scope votes and drafts to groups](pr/pr-207-scope-votes-and-drafts-to-groups.md) | `agent/phase5c-votes-drafts` |
| 2026-07-16 | [#206](https://github.com/blorbeer-cmd/LAN_2026/pull/206) | [harden competition tenant boundaries](pr/pr-206-harden-competition-tenant-boundaries.md) | `codex/pr201-hardening` |
| 2026-07-16 | [#203](https://github.com/blorbeer-cmd/LAN_2026/pull/203) | [Add session hygiene guidance](pr/pr-203-add-session-hygiene-guidance.md) | `agent/session-hygiene-guidance` |
| 2026-07-16 | [#202](https://github.com/blorbeer-cmd/LAN_2026/pull/202) | [Split agent guidelines by scope](pr/pr-202-split-agent-guidelines-by-scope.md) | `agent/split-agent-guidelines` |
| 2026-07-16 | [#200](https://github.com/blorbeer-cmd/LAN_2026/pull/200) | [harden group-scoped catalog presence](pr/pr-200-harden-group-scoped-catalog-presence.md) | `claude/group-scoping-catalog-presence` |
| 2026-07-16 | [#199](https://github.com/blorbeer-cmd/LAN_2026/pull/199) | [harden group lifecycle invariants](pr/pr-199-harden-group-lifecycle-invariants.md) | `codex/group-management` |
| 2026-07-16 | [#198](https://github.com/blorbeer-cmd/LAN_2026/pull/198) | [rebuild multi-group user management concept](pr/pr-198-rebuild-multi-group-user-management-concept.md) | `claude/user-management-concept-xbro77` |
| 2026-07-14 | [#196](https://github.com/blorbeer-cmd/LAN_2026/pull/196) | [Rework Scribble voting: continuous thumbs-up, no round-gallery pause](pr/pr-196-rework-scribble-voting-continuous-thumbs-up-no-round-gallery-pause.md) | `claude/arcade-mode-adjustments-eq29ci` |
| 2026-07-14 | [#195](https://github.com/blorbeer-cmd/LAN_2026/pull/195) | [retrigger CI after transient Docker Hub 502](pr/pr-195-retrigger-ci-after-transient-docker-hub-502.md) | `claude/user-management-concept-xbro77` |
| 2026-07-14 | [#194](https://github.com/blorbeer-cmd/LAN_2026/pull/194) | [Fix expanded arcade overflow, Scribble leave, and rework drawing votes](pr/pr-194-fix-expanded-arcade-overflow-scribble-leave-and-rework-drawing-votes.md) | `claude/arcade-mode-adjustments-eq29ci` |
| 2026-07-14 | [#193](https://github.com/blorbeer-cmd/LAN_2026/pull/193) | [add changelog entry for PR #180](pr/pr-193-add-changelog-entry-for-pr-180.md) | `claude/auto-resume-token-reset-0jl2dt` |
| 2026-07-14 | [#192](https://github.com/blorbeer-cmd/LAN_2026/pull/192) | [link Ergebnis eintragen results back to their draw regardless of shape](pr/pr-192-link-ergebnis-eintragen-results-back-to-their-draw-regardless-of-shape.md) | `claude/rematch-results-winner-display-7qg5hr` |
| 2026-07-14 | [#191](https://github.com/blorbeer-cmd/LAN_2026/pull/191) | [Show skill level in the captain-draft player pool and teams](pr/pr-191-show-skill-level-in-the-captain-draft-player-pool-and-teams.md) | `claude/captain-draft-skill-level-pj2i5b` |
| 2026-07-14 | [#190](https://github.com/blorbeer-cmd/LAN_2026/pull/190) | [keep team-draw cards readable instead of overflowing with many teams](pr/pr-190-keep-team-draw-cards-readable-instead-of-overflowing-with-many-teams.md) | `claude/team-draw-display-bug-gacxhe` |
| 2026-07-14 | [#189](https://github.com/blorbeer-cmd/LAN_2026/pull/189) | [close review findings on the arcade leave feature and votes payload](pr/pr-189-close-review-findings-on-the-arcade-leave-feature-and-votes-payload.md) | `claude/arcade-pause-exit-options-d9kd54` |
| 2026-07-13 | [#188](https://github.com/blorbeer-cmd/LAN_2026/pull/188) | [show Unentschieden badge for drawn matchmaking results](pr/pr-188-show-unentschieden-badge-for-drawn-matchmaking-results.md) | `claude/game-results-draw-display-opzvah` |
| 2026-07-13 | [#187](https://github.com/blorbeer-cmd/LAN_2026/pull/187) | [let a non-host arcade participant leave a running match](pr/pr-187-let-a-non-host-arcade-participant-leave-a-running-match.md) | `claude/arcade-pause-exit-options-d9kd54` |
| 2026-07-13 | [#186](https://github.com/blorbeer-cmd/LAN_2026/pull/186) | [Add an arcade-specific tab to Auswertungen](pr/pr-186-add-an-arcade-specific-tab-to-auswertungen.md) | `claude/arcade-games-reports-hwafva` |
| 2026-07-13 | [#185](https://github.com/blorbeer-cmd/LAN_2026/pull/185) | [restore arcade tile icon/text size and spacing](pr/pr-185-restore-arcade-tile-icon-text-size-and-spacing.md) | `claude/arcade-game-tiles-width-izo34m` |
| 2026-07-13 | [#184](https://github.com/blorbeer-cmd/LAN_2026/pull/184) | [stop Bock/Skill sliders snapping back to the old value mid-save](pr/pr-184-stop-bock-skill-sliders-snapping-back-to-the-old-value-mid-save.md) | `claude/bock-skill-slider-bug-hp7fce` |
| 2026-07-13 | [#182](https://github.com/blorbeer-cmd/LAN_2026/pull/182) | [bump last_seen when setting the Home pause note](pr/pr-182-bump-last-seen-when-setting-the-home-pause-note.md) | `claude/home-pause-button-bug-xhapiv` |
| 2026-07-13 | [#181](https://github.com/blorbeer-cmd/LAN_2026/pull/181) | [fit all six arcade game tiles into one row](pr/pr-181-fit-all-six-arcade-game-tiles-into-one-row.md) | `claude/arcade-game-tiles-width-izo34m` |
| 2026-07-13 | [#180](https://github.com/blorbeer-cmd/LAN_2026/pull/180) | [docs: add concept for auto-resuming agent sessions after usage-limit reset](pr/pr-180-add-concept-for-auto-resuming-agent-sessions-after-usage-limit-reset.md) | `claude/auto-resume-token-reset-0jl2dt` |
| 2026-07-13 | [#178](https://github.com/blorbeer-cmd/LAN_2026/pull/178) | [align tournament team-draw button with matchmaking's style and label](pr/pr-178-align-tournament-team-draw-button-with-matchmaking-s-style-and-label.md) | `claude/tournament-teams-consistency-lkkns1` |
| 2026-07-13 | [#176](https://github.com/blorbeer-cmd/LAN_2026/pull/176) | [expire and dismiss notification banners](pr/pr-176-expire-and-dismiss-notification-banners.md) | `agent/notification-banner-lifecycle` |
| 2026-07-13 | [#175](https://github.com/blorbeer-cmd/LAN_2026/pull/175) | [keep a client-side mirror of confirmed scribble ops for canvas rebuilds](pr/pr-175-keep-a-client-side-mirror-of-confirmed-scribble-ops-for-canvas-rebuilds.md) | `claude/arcade-e2e-testing-gn96bz` |
| 2026-07-13 | [#174](https://github.com/blorbeer-cmd/LAN_2026/pull/174) | [Arcade: fix open Codex review findings, add spectator/rapid-fire E2E coverage, parallelize CI](pr/pr-174-arcade-review-follow-up-e2e-coverage-and-ci-parallelization.md) | `claude/arcade-e2e-testing-gn96bz` |
| 2026-07-13 | [#173](https://github.com/blorbeer-cmd/LAN_2026/pull/173) | [add immediate notification and human review-override options on limit delays](pr/pr-173-add-immediate-notification-and-human-review-override-options-on-limit-de.md) | `claude/automated-deployment-pipeline-jw2zf1` |
| 2026-07-13 | [#172](https://github.com/blorbeer-cmd/LAN_2026/pull/172) | [record deployment hardening changes](pr/pr-172-record-deployment-hardening-changes.md) | `codex/changelog-deploy-hardening` |
| 2026-07-13 | [#171](https://github.com/blorbeer-cmd/LAN_2026/pull/171) | [Fix prepare hook in container build](pr/pr-171-fix-prepare-hook-in-container-build.md) | `codex/docker-prepare-fix` |
| 2026-07-13 | [#169](https://github.com/blorbeer-cmd/LAN_2026/pull/169) | [Harden and optimize production deployments](pr/pr-169-harden-and-optimize-production-deployments.md) | `codex/deploy-optimizations` |
| 2026-07-13 | [#168](https://github.com/blorbeer-cmd/LAN_2026/pull/168) | [Document arcade spectator and Scribble gallery PRs](pr/pr-168-document-arcade-spectator-and-scribble-gallery-prs.md) | `codex/update-arcade-changelog` |
| 2026-07-13 | [#167](https://github.com/blorbeer-cmd/LAN_2026/pull/167) | [Add Scribble gallery voting](pr/pr-167-add-scribble-gallery-voting.md) | `codex/fix-scribble-watch-rerender` |
| 2026-07-13 | [#166](https://github.com/blorbeer-cmd/LAN_2026/pull/166) | [Fix arcade spectator rendering](pr/pr-166-fix-arcade-spectator-rendering.md) | `codex/fix-arcade-spectator-views` |
| 2026-07-13 | [#165](https://github.com/blorbeer-cmd/LAN_2026/pull/165) | [synchronize scribble fill undo](pr/pr-165-synchronize-scribble-fill-undo.md) | `codex/fix-scribble-watch-rerender` |
| 2026-07-13 | [#164](https://github.com/blorbeer-cmd/LAN_2026/pull/164) | [guard arcade watch redirect to active view](pr/pr-164-guard-arcade-watch-redirect-to-active-view.md) | `codex/arcade-tetris-navigation-fix` |
| 2026-07-13 | [#163](https://github.com/blorbeer-cmd/LAN_2026/pull/163) | [fix arcade watch cleanup on match end](pr/pr-163-fix-arcade-watch-cleanup-on-match-end.md) | `codex/arcade-tetris-navigation-fix` |
| 2026-07-13 | [#162](https://github.com/blorbeer-cmd/LAN_2026/pull/162) | [keep arcade navigation stable during live games](pr/pr-162-keep-arcade-navigation-stable-during-live-games.md) | `codex/arcade-tetris-navigation-fix` |
| 2026-07-13 | [#161](https://github.com/blorbeer-cmd/LAN_2026/pull/161) | [clarify seat-neighbor draw labels](pr/pr-161-clarify-seat-neighbor-draw-labels.md) | `codex/update-seat-neighbor-labels` |
| 2026-07-13 | [#160](https://github.com/blorbeer-cmd/LAN_2026/pull/160) | [preserve arcade aspect ratios when scaling](pr/pr-160-preserve-arcade-aspect-ratios-when-scaling.md) | `codex/arcade-viewport-aspect-ratio` |
| 2026-07-13 | [#158](https://github.com/blorbeer-cmd/LAN_2026/pull/158) | [fit expanded arcade boards to viewport](pr/pr-158-fit-expanded-arcade-boards-to-viewport.md) | `codex/arcade-viewport-fix` |
| 2026-07-12 | main | [ESLint/Prettier und Log-Rotation](pr/main-2026-07-12-tooling-and-operations.md) | `main` |
| 2026-07-12 | [#157](https://github.com/blorbeer-cmd/LAN_2026/pull/157) | [avoid flaky host canvas wait in Scribble test](pr/pr-157-avoid-flaky-host-canvas-wait-in-scribble-test.md) | `agent/arcade-single-lobby` |
| 2026-07-12 | [#156](https://github.com/blorbeer-cmd/LAN_2026/pull/156) | [stabilize Scribble undo e2e synchronization](pr/pr-156-stabilize-scribble-undo-e2e-synchronization.md) | `agent/arcade-single-lobby` |
| 2026-07-12 | [#155](https://github.com/blorbeer-cmd/LAN_2026/pull/155) | [restrict arcade AI matches to admins](pr/pr-155-restrict-arcade-ai-matches-to-admins.md) | `agent/arcade-watch-stream` |
| 2026-07-12 | [#154](https://github.com/blorbeer-cmd/LAN_2026/pull/154) | [keep expanded arcade boards within viewport](pr/pr-154-keep-expanded-arcade-boards-within-viewport.md) | `agent/arcade-watch-stream` |
| 2026-07-12 | [#153](https://github.com/blorbeer-cmd/LAN_2026/pull/153) | [stabilize Scribble close-guess test](pr/pr-153-stabilize-scribble-close-guess-test.md) | `agent/arcade-single-lobby` |
| 2026-07-12 | [#152](https://github.com/blorbeer-cmd/LAN_2026/pull/152) | [add arcade spectator streaming](pr/pr-152-add-arcade-spectator-streaming.md) | `agent/arcade-watch-stream` |
| 2026-07-12 | [#151](https://github.com/blorbeer-cmd/LAN_2026/pull/151) | [complete changelog for merged PRs](pr/pr-151-complete-changelog-for-merged-prs.md) | `fix/topbar-wordmark` |
| 2026-07-12 | [#150](https://github.com/blorbeer-cmd/LAN_2026/pull/150) | [stabilize Scribble undo test](pr/pr-150-stabilize-scribble-undo-test.md) | `agent/fix-scribble-undo-e2e` |
| 2026-07-12 | [#148](https://github.com/blorbeer-cmd/LAN_2026/pull/148) | [expand arcade play areas](pr/pr-148-expand-arcade-play-areas.md) | `agent/arcade-kiosk-stream` |
| 2026-07-12 | [#147](https://github.com/blorbeer-cmd/LAN_2026/pull/147) | [make agent integration test platform-safe](pr/pr-147-make-agent-integration-test-platform-safe.md) | `agent/unify-guidelines-and-ci` |
| 2026-07-12 | [#146](https://github.com/blorbeer-cmd/LAN_2026/pull/146) | [Pin project runtime to Node 24](pr/pr-146-pin-project-runtime-to-node-24.md) | `chore/node-24-pin` |
| 2026-07-12 | [#145](https://github.com/blorbeer-cmd/LAN_2026/pull/145) | [Fix stale live status and agent proxy URLs](pr/pr-145-fix-stale-live-status-and-agent-proxy-urls.md) | `fix/live-status-agent-url` |
| 2026-07-12 | [#144](https://github.com/blorbeer-cmd/LAN_2026/pull/144) | [Fix invite token handling, JSON limits and Playwright docs](pr/pr-144-fix-invite-token-handling-json-limits-and-playwright-docs.md) | `fix/issues-31-19-25` |
| 2026-07-12 | [#143](https://github.com/blorbeer-cmd/LAN_2026/pull/143) | [Fix seat-conflict icon spacing and show the neighbor's name in its tooltip](pr/pr-143-fix-seat-conflict-icon-spacing-and-show-the-neighbor-s-name-in-its-too.md) | `claude/team-draw-seat-neighbors-2wfji2` |
| 2026-07-12 | [#141](https://github.com/blorbeer-cmd/LAN_2026/pull/141) | [Show lobby host/player counts in the arcade overview and tile badges](pr/pr-141-show-lobby-host-player-counts-in-the-arcade-overview-and-tile-badges.md) | `claude/arcade-all-open-lobbies-tptts0` |
| 2026-07-12 | [#140](https://github.com/blorbeer-cmd/LAN_2026/pull/140) | [Fix remaining Home tile height jump on pause](pr/pr-140-fix-remaining-home-tile-height-jump-on-pause.md) | `claude/home-tiles-games-display-c6uua7` |
| 2026-07-12 | [#139](https://github.com/blorbeer-cmd/LAN_2026/pull/139) | [address second review round and sync concept with current main](pr/pr-139-address-second-review-round-and-sync-concept-with-current-main.md) | `claude/user-management-concept-xbro77` |
| 2026-07-11 | [#138](https://github.com/blorbeer-cmd/LAN_2026/pull/138) | [Show Aktuell items as chips in the always-on header banner](pr/pr-138-show-aktuell-items-as-chips-in-the-always-on-header-banner.md) | `claude/live-page-home-redesign-ailuxo` |
| 2026-07-11 | [#137](https://github.com/blorbeer-cmd/LAN_2026/pull/137) | [Arcade: back to one expanded game, add compact open-lobbies overview](pr/pr-137-arcade-back-to-one-expanded-game-add-compact-open-lobbies-overview.md) | `claude/arcade-lobby-filtering-witbyu` |
| 2026-07-11 | [#136](https://github.com/blorbeer-cmd/LAN_2026/pull/136) | [Flag individual players still opposing a seat neighbor in team draws](pr/pr-136-flag-individual-players-still-opposing-a-seat-neighbor-in-team-draws.md) | `claude/team-draw-seat-neighbors-2wfji2` |
| 2026-07-11 | [#135](https://github.com/blorbeer-cmd/LAN_2026/pull/135) | [Arcade-Spiel: Pong](pr/pr-135-arcade-spiel-pong.md) | `feat/46-arcade-pong` |
| 2026-07-11 | [#134](https://github.com/blorbeer-cmd/LAN_2026/pull/134) | [Track Arcade playtime and live "who's playing" like other games](pr/pr-134-track-arcade-playtime-and-live-who-s-playing-like-other-games.md) | `claude/arcade-all-open-lobbies-tptts0` |
| 2026-07-11 | [#133](https://github.com/blorbeer-cmd/LAN_2026/pull/133) | [Fix Home tile resize/reordering on pause, add active-game counts](pr/pr-133-fix-home-tile-resize-reordering-on-pause-add-active-game-counts.md) | `claude/home-tiles-games-display-c6uua7` |
| 2026-07-11 | [#132](https://github.com/blorbeer-cmd/LAN_2026/pull/132) | [Add always-on header notification banner, compact Aktuell, unify Kiosk banner](pr/pr-132-add-always-on-header-notification-banner-compact-aktuell-unify-kiosk-banner.md) | `claude/live-page-home-redesign-ailuxo` |
| 2026-07-11 | [#131](https://github.com/blorbeer-cmd/LAN_2026/pull/131) | [Add more Scribble words](pr/pr-131-add-more-scribble-words.md) | `claude/scribble-word-list-t4o8i4` |
| 2026-07-11 | [#130](https://github.com/blorbeer-cmd/LAN_2026/pull/130) | [Arcade: always show all open lobbies, grouped by game](pr/pr-130-arcade-always-show-all-open-lobbies-grouped-by-game.md) | `claude/arcade-all-open-lobbies-tptts0` |
| 2026-07-11 | [#129](https://github.com/blorbeer-cmd/LAN_2026/pull/129) | [Link rematch results back to Ergebnis-Historie](pr/pr-129-link-rematch-results-back-to-ergebnis-historie.md) | `claude/rematch-result-history-05t4qm` |
| 2026-07-11 | [#128](https://github.com/blorbeer-cmd/LAN_2026/pull/128) | [Remove reroll button in tournament team draw, persist team count](pr/pr-128-remove-reroll-button-in-tournament-team-draw-persist-team-count.md) | `claude/team-draw-button-persistence-nadnbw` |
| 2026-07-11 | [#127](https://github.com/blorbeer-cmd/LAN_2026/pull/127) | [Show real names in small next to gamer names in the seating plan](pr/pr-127-show-real-names-in-small-next-to-gamer-names-in-the-seating-plan.md) | `claude/seating-real-name` |
| 2026-07-11 | [#126](https://github.com/blorbeer-cmd/LAN_2026/pull/126) | [Stop enforcing the retired admin PIN on admin endpoints](pr/pr-126-stop-enforcing-the-retired-admin-pin-on-admin-endpoints.md) | `claude/test-user-admin-setup-4ntv3z` |
| 2026-07-11 | [#125](https://github.com/blorbeer-cmd/LAN_2026/pull/125) | [Trackbarkeits-Icon in der Spiele-Liste anzeigen](pr/pr-125-trackbarkeits-icon-in-der-spiele-liste-anzeigen.md) | `claude/game-list-trackability-icon-pzmnf6` |
| 2026-07-11 | [#124](https://github.com/blorbeer-cmd/LAN_2026/pull/124) | [Fix flaky skill-suggestion race in the Spiele view](pr/pr-124-fix-flaky-skill-suggestion-race-in-the-spiele-view.md) | `claude/live-page-home-redesign-ailuxo` |
| 2026-07-11 | [#123](https://github.com/blorbeer-cmd/LAN_2026/pull/123) | [Seeded admin test users, admin-mode banner, retire admin PIN](pr/pr-123-seeded-admin-test-users-admin-mode-banner-retire-admin-pin.md) | `claude/test-user-admin-setup-4ntv3z` |
| 2026-07-11 | [#122](https://github.com/blorbeer-cmd/LAN_2026/pull/122) | [Turn the Live view into the Home landing page](pr/pr-122-turn-the-live-view-into-the-home-landing-page.md) | `claude/live-page-home-redesign-ailuxo` |
| 2026-07-11 | [#121](https://github.com/blorbeer-cmd/LAN_2026/pull/121) | [Add test-user seeding concept and implementation plan](pr/pr-121-add-test-user-seeding-concept-and-implementation-plan.md) | `claude/test-user-admin-setup-4ntv3z` |
| 2026-07-11 | [#120](https://github.com/blorbeer-cmd/LAN_2026/pull/120) | [Play a notification chime on the kiosk when a new push arrives](pr/pr-120-play-kiosk-notification-chime-on-new-push.md) | `claude/kiosk-push-notification-sound-oaiiy9` |
| 2026-07-11 | [#119](https://github.com/blorbeer-cmd/LAN_2026/pull/119) | [Fix voting points slider gradient while dragging](pr/pr-119-fix-voting-points-slider-gradient-while-dragging.md) | `claude/voting-slider-color-bug-zbq2uh` |
| 2026-07-11 | [#118](https://github.com/blorbeer-cmd/LAN_2026/pull/118) | [Add realtime, offline-sweep, and DB migration test coverage](pr/pr-118-add-realtime-offline-sweep-and-db-migration-test-coverage.md) | `claude/test-coverage-analysis-ragd8i` |
| 2026-07-11 | [#117](https://github.com/blorbeer-cmd/LAN_2026/pull/117) | [feat: LAN-Polish, Backup und PWA](pr/pr-117-feat-lan-polish-backup-und-pwa.md) | `feat/lan-polish-agent-pwa` |
| 2026-07-11 | [#116](https://github.com/blorbeer-cmd/LAN_2026/pull/116) | [Claude/user management concept xbro77](pr/pr-116-claude-user-management-concept-xbro77.md) | `claude/user-management-concept-xbro77` |
| 2026-07-11 | [#115](https://github.com/blorbeer-cmd/LAN_2026/pull/115) | [block moving the last player out of a team when reassigning proposed …](pr/pr-115-block-moving-the-last-player-out-of-a-team-when-reassigning-proposed.md) | `claude/tournament-lobby-features-yt5cgp` |
| 2026-07-11 | [#114](https://github.com/blorbeer-cmd/LAN_2026/pull/114) | [Auto-fill visible monitors from same-edge seating plan placements](pr/pr-114-auto-fill-visible-monitors-from-same-edge-seating-plan-placements.md) | `claude/seating-monitors-sync-iqef7o` |
| 2026-07-11 | [#113](https://github.com/blorbeer-cmd/LAN_2026/pull/113) | [Extend Teams-auslosen: draft badge, score/rank results, tournament Fe…](pr/pr-113-extend-teams-auslosen-draft-badge-score-rank-results-tournament-fe.md) | `claude/team-draw-feature-rni1xs` |
| 2026-07-11 | [#112](https://github.com/blorbeer-cmd/LAN_2026/pull/112) | [Default vote rounds to all games, gate preselection behind a toggle](pr/pr-112-default-vote-rounds-to-all-games-gate-preselection-behind-a-toggle.md) | `claude/voting-page-improvements-3bsox6` |
| 2026-07-11 | [#111](https://github.com/blorbeer-cmd/LAN_2026/pull/111) | [add optional lobby name/password to tournament creation with host hint in match-ready push](pr/pr-111-add-optional-lobby-name-password-to-tournament-creation-with-host-hint.md) | `claude/tournament-lobby-features-yt5cgp` |
| 2026-07-10 | [#110](https://github.com/blorbeer-cmd/LAN_2026/pull/110) | [feat: editierbarer Drag-&-Drop-Sitzplan](pr/pr-110-feat-editierbarer-drag-drop-sitzplan.md) | `feat/seating-drag-drop` |
| 2026-07-10 | [#109](https://github.com/blorbeer-cmd/LAN_2026/pull/109) | [fix: Logo und Wortmarke zur Landingpage verlinken](pr/pr-109-fix-logo-und-wortmarke-zur-landingpage-verlinken.md) | `fix/logo-landing-link` |
| 2026-07-10 | [#108](https://github.com/blorbeer-cmd/LAN_2026/pull/108) | [Link matchmaking draws to match results (Team-Historie → Ergebnis-Historie)](pr/pr-108-link-matchmaking-draws-to-match-results-team-historie-ergebnis-histori.md) | `claude/team-draw-feature-rni1xs` |
| 2026-07-10 | [#107](https://github.com/blorbeer-cmd/LAN_2026/pull/107) | [Voting: add round titles, info, game preselection, and runoff mode](pr/pr-107-voting-add-round-titles-info-game-preselection-and-runoff-mode.md) | `claude/voting-page-improvements-3bsox6` |
| 2026-07-10 | [#106](https://github.com/blorbeer-cmd/LAN_2026/pull/106) | [Add ready state to arcade lobbies](pr/pr-106-add-ready-state-to-arcade-lobbies.md) | `claude/arcade-ready-button-cw1cth` |
| 2026-07-10 | [#105](https://github.com/blorbeer-cmd/LAN_2026/pull/105) | [Agent-Diagnose in der Web-UI](pr/pr-105-agent-diagnose-in-der-web-ui.md) | `feat/agent-diagnostics` |
| 2026-07-10 | [#104](https://github.com/blorbeer-cmd/LAN_2026/pull/104) | [Claude/merge conflicts UI symbols 0b61av](pr/pr-104-claude-merge-conflicts-ui-symbols-0b61av.md) | `claude/merge-conflicts-ui-symbols-0b61av` |
| 2026-07-10 | [#103](https://github.com/blorbeer-cmd/LAN_2026/pull/103) | [Arcade-Spiel: Blobby Volley](pr/pr-103-arcade-spiel-blobby-volley.md) | `feat/arcade-blobby-volley` |
| 2026-07-10 | [#102](https://github.com/blorbeer-cmd/LAN_2026/pull/102) | [feat: refine UI icons, sorting and rating visuals](pr/pr-102-feat-refine-ui-icons-sorting-and-rating-visuals.md) | `claude/merge-conflicts-ui-symbols-0b61av` |
| 2026-07-10 | [#101](https://github.com/blorbeer-cmd/LAN_2026/pull/101) | [fix Docker build broken by the design-token pre-commit hook's prepare script](pr/pr-101-fix-docker-build-broken-by-the-design-token-pre-commit-hook-s-prepare-.md) | `claude/design-system-setup-7m45xk` |
| 2026-07-10 | [#100](https://github.com/blorbeer-cmd/LAN_2026/pull/100) | [add analysis for skribbl.io-style arcade game](pr/pr-100-add-analysis-for-skribbl-io-style-arcade-game.md) | `claude/scribble-io-analysis-h2vfeb` |
| 2026-07-10 | [#98](https://github.com/blorbeer-cmd/LAN_2026/pull/98) | [add design system tokens (typography, spacing, radius, shadows, avatar sizes/colors)](pr/pr-098-add-design-system-tokens-typography-spacing-radius-shadows-avatar-size.md) | `claude/design-system-setup-7m45xk` |
| 2026-07-10 | [#95](https://github.com/blorbeer-cmd/LAN_2026/pull/95) | [Kiosk: show open food orders and a shared last-push banner](pr/pr-095-kiosk-show-open-food-orders-and-a-shared-last-push-banner.md) | `claude/food-order-metadata-links-tupa5b` |
| 2026-07-10 | [#92](https://github.com/blorbeer-cmd/LAN_2026/pull/92) | [Make platform/trailer links clickable on game cards](pr/pr-092-make-platform-trailer-links-clickable-on-game-cards.md) | `claude/voting-section-redesign-dop6cu` |
| 2026-07-10 | [#91](https://github.com/blorbeer-cmd/LAN_2026/pull/91) | [Redesign voting view: last result + top 5, explicit submit, richer stats](pr/pr-091-redesign-voting-view-last-result-top-5-explicit-submit-richer-stats.md) | `claude/voting-section-redesign-dop6cu` |
| 2026-07-10 | [#89](https://github.com/blorbeer-cmd/LAN_2026/pull/89) | [Add optional notes and link fields to food orders](pr/pr-089-add-optional-notes-and-link-fields-to-food-orders.md) | `claude/food-order-metadata-links-tupa5b` |
| 2026-07-10 | [#80](https://github.com/blorbeer-cmd/LAN_2026/pull/80) | [Arcade-Spiel: Tetris 1v1 (Battle)](pr/pr-080-arcade-spiel-tetris-1v1-battle.md) | `feat/arcade-tetris` |
| 2026-07-09 | [#88](https://github.com/blorbeer-cmd/LAN_2026/pull/88) | [Fix e2e tests: stop hardcoding a fixed chromium path](pr/pr-088-fix-e2e-tests-stop-hardcoding-a-fixed-chromium-path.md) | `fix-e2e-chromium-path` |
| 2026-07-09 | [#87](https://github.com/blorbeer-cmd/LAN_2026/pull/87) | [Serialize deploy job to prevent parallel-run races](pr/pr-087-serialize-deploy-job-to-prevent-parallel-run-races.md) | `concurrency-fix-onto-main` |
| 2026-07-09 | [#86](https://github.com/blorbeer-cmd/LAN_2026/pull/86) | [Fix broken CI/CD: Node 20 lacks node --test glob support, upgrade to Node 24](pr/pr-086-fix-broken-ci-cd-node-20-lacks-node-test-glob-support-upgrade-to-node-.md) | `node24-fix-onto-main` |
| 2026-07-09 | [#85](https://github.com/blorbeer-cmd/LAN_2026/pull/85) | [Hide live vote distribution while a round is open; add history detail…](pr/pr-085-hide-live-vote-distribution-while-a-round-is-open-add-history-detail.md) | `claude/lan-tools-quality-e2e-x6k61w` |
| 2026-07-09 | [#84](https://github.com/blorbeer-cmd/LAN_2026/pull/84) | [Claude/games features reorganization k3lbwv](pr/pr-084-claude-games-features-reorganization-k3lbwv.md) | `claude/games-features-reorganization-k3lbwv` |
| 2026-07-09 | [#83](https://github.com/blorbeer-cmd/LAN_2026/pull/83) | [Docker + GitHub Actions CI/CD: deploy on Hetzner behind Cloudflare Tunnel](pr/pr-083-docker-github-actions-ci-cd-deploy-on-hetzner-behind-cloudflare-tunnel.md) | `worktree-hetzner-cicd` |
| 2026-07-09 | [#82](https://github.com/blorbeer-cmd/LAN_2026/pull/82) | [make the device back button step through in-app views, not leave the …](pr/pr-082-make-the-device-back-button-step-through-in-app-views-not-leave-the.md) | `claude/lan-tools-quality-e2e-x6k61w` |
| 2026-07-09 | [#81](https://github.com/blorbeer-cmd/LAN_2026/pull/81) | [Claude/pr merge order p67vj8](pr/pr-081-claude-pr-merge-order-p67vj8.md) | `claude/pr-merge-order-p67vj8` |
| 2026-07-09 | [#79](https://github.com/blorbeer-cmd/LAN_2026/pull/79) | [add an editable send time to Sammelbestellungen](pr/pr-079-add-an-editable-send-time-to-sammelbestellungen.md) | `claude/lan-tools-quality-e2e-x6k61w` |
| 2026-07-09 | [#78](https://github.com/blorbeer-cmd/LAN_2026/pull/78) | [make Bock-Level changes update the voting view live, simplify points …](pr/pr-078-make-bock-level-changes-update-the-voting-view-live-simplify-points.md) | `claude/game-preference-voting-ototpn` |
| 2026-07-09 | [#77](https://github.com/blorbeer-cmd/LAN_2026/pull/77) | [Themed date/time picker instead of native datetime-local](pr/pr-077-themed-date-time-picker-instead-of-native-datetime-local.md) | `fix/themed-datetime-picker` |
| 2026-07-09 | [#76](https://github.com/blorbeer-cmd/LAN_2026/pull/76) | [Add arcade quiz framework](pr/pr-076-add-arcade-quiz-framework.md) | `feat/arcade-quiz` |
| 2026-07-09 | [#75](https://github.com/blorbeer-cmd/LAN_2026/pull/75) | [Add combined game catalog](pr/pr-075-add-combined-game-catalog.md) | `feat/game-catalog` |
| 2026-07-09 | [#74](https://github.com/blorbeer-cmd/LAN_2026/pull/74) | [Add arrival and carpool planning](pr/pr-074-add-arrival-and-carpool-planning.md) | `feat/arrival-carpools` |
| 2026-07-09 | [#73](https://github.com/blorbeer-cmd/LAN_2026/pull/73) | [Add GitHub feedback link](pr/pr-073-add-github-feedback-link.md) | `feat/github-feedback-link` |
| 2026-07-09 | [#72](https://github.com/blorbeer-cmd/LAN_2026/pull/72) | [Add admin base](pr/pr-072-add-admin-base.md) | `feat/admin-base` |
| 2026-07-09 | [#70](https://github.com/blorbeer-cmd/LAN_2026/pull/70) | [Claude/lan tools quality e2e x6k61w](pr/pr-070-claude-lan-tools-quality-e2e-x6k61w.md) | `claude/lan-tools-quality-e2e-x6k61w` |
| 2026-07-09 | [#69](https://github.com/blorbeer-cmd/LAN_2026/pull/69) | [add per-player "Bock" preference ratings and a points-based voting mode](pr/pr-069-add-per-player-bock-preference-ratings-and-a-points-based-voting-mode.md) | `claude/game-preference-voting-ototpn` |
| 2026-07-08 | [#16](https://github.com/blorbeer-cmd/LAN_2026/pull/16) | [Claude/lan tools quality e2e x6k61w](pr/pr-016-claude-lan-tools-quality-e2e-x6k61w.md) | `claude/lan-tools-quality-e2e-x6k61w` |
| 2026-07-08 | [#15](https://github.com/blorbeer-cmd/LAN_2026/pull/15) | [Claude/lan tools quality e2e x6k61w](pr/pr-015-claude-lan-tools-quality-e2e-x6k61w.md) | `claude/lan-tools-quality-e2e-x6k61w` |
| 2026-07-08 | [#14](https://github.com/blorbeer-cmd/LAN_2026/pull/14) | [Claude/funny mayer 8ib4li](pr/pr-014-claude-funny-mayer-8ib4li.md) | `claude/funny-mayer-8ib4li` |
| 2026-07-08 | [#13](https://github.com/blorbeer-cmd/LAN_2026/pull/13) | [fix two general spacing/layout bugs: section-title margin, datetime o…](pr/pr-013-fix-two-general-spacing-layout-bugs-section-title-margin-datetime-o.md) | `claude/tool-spacing-buttons-i853pj` |
| 2026-07-08 | [#12](https://github.com/blorbeer-cmd/LAN_2026/pull/12) | [Add step-by-step tracing inside the tray PowerShell script itself](pr/pr-012-add-step-by-step-tracing-inside-the-tray-powershell-script-itself.md) | `claude/funny-mayer-8ib4li` |
| 2026-07-08 | [#11](https://github.com/blorbeer-cmd/LAN_2026/pull/11) | [feat: highlight which running game is actually in the foreground](pr/pr-011-feat-highlight-which-running-game-is-actually-in-the-foreground.md) | `claude/pause-live-tracking-bug-uilj46` |
| 2026-07-08 | [#10](https://github.com/blorbeer-cmd/LAN_2026/pull/10) | [fix: let manual pause note win over an active game in live state](pr/pr-010-fix-let-manual-pause-note-win-over-an-active-game-in-live-state.md) | `claude/pause-live-tracking-bug-uilj46` |
| 2026-07-08 | [#9](https://github.com/blorbeer-cmd/LAN_2026/pull/9) | [Claude/funny mayer 8ib4li](pr/pr-009-claude-funny-mayer-8ib4li.md) | `claude/funny-mayer-8ib4li` |
| 2026-07-08 | [#8](https://github.com/blorbeer-cmd/LAN_2026/pull/8) | [Claude/tool spacing buttons i853pj](pr/pr-008-claude-tool-spacing-buttons-i853pj.md) | `claude/tool-spacing-buttons-i853pj` |
| 2026-07-08 | [#7](https://github.com/blorbeer-cmd/LAN_2026/pull/7) | [Improve game stats, suggestions, tournament UI and agent reporting](pr/pr-007-improve-game-stats-suggestions-tournament-ui-and-agent-reporting.md) | `claude/funny-mayer-8ib4li` |
| 2026-07-08 | [#6](https://github.com/blorbeer-cmd/LAN_2026/pull/6) | [Push next-match notifications for round-robin tournaments](pr/pr-006-push-next-match-notifications.md) | `claude/push-notification-types-9djvav` |
| 2026-07-08 | [#5](https://github.com/blorbeer-cmd/LAN_2026/pull/5) | [Add agent control server and pause support](pr/pr-005-add-agent-control-server-and-pause-support.md) | `claude/tracking-tool-pause-feature-62phr2` |
| 2026-07-07 | [#4](https://github.com/blorbeer-cmd/LAN_2026/pull/4) | [Claude/funny mayer 8ib4li](pr/pr-004-claude-funny-mayer-8ib4li.md) | `claude/funny-mayer-8ib4li` |
| 2026-07-07 | [#3](https://github.com/blorbeer-cmd/LAN_2026/pull/3) | [Claude/funny mayer 8ib4li](pr/pr-003-claude-funny-mayer-8ib4li.md) | `claude/funny-mayer-8ib4li` |
| 2026-07-07 | [#2](https://github.com/blorbeer-cmd/LAN_2026/pull/2) | [Claude/funny mayer 8ib4li](pr/pr-002-claude-funny-mayer-8ib4li.md) | `claude/funny-mayer-8ib4li` |
| 2026-07-07 | [#1](https://github.com/blorbeer-cmd/LAN_2026/pull/1) | [Claude/lan party tools 6jqu4g](pr/pr-001-claude-lan-party-tools-6jqu4g.md) | `claude/lan-party-tools-6jqu4g` |

## Branch-Index

Die Branch-Seiten zeigen, über welche PRs ein Themenstrang in `main` eingeflossen ist.

- [`agent/arcade-kiosk-stream`](branches/agent-arcade-kiosk-stream.md)
- [`agent/arcade-single-lobby`](branches/agent-arcade-single-lobby.md)
- [`agent/arcade-watch-stream`](branches/agent-arcade-watch-stream.md)
- [`agent/fix-scribble-undo-e2e`](branches/agent-fix-scribble-undo-e2e.md)
- [`agent/notification-banner-lifecycle`](branches/agent-notification-banner-lifecycle.md)
- [`agent/phase5c-organization-communication`](branches/agent-phase5c-organization-communication.md)
- [`agent/phase5c-votes-drafts`](branches/agent-phase5c-votes-drafts.md)
- [`agent/session-hygiene-guidance`](branches/agent-session-hygiene-guidance.md)
- [`agent/split-agent-guidelines`](branches/agent-split-agent-guidelines.md)
- [`agent/unify-guidelines-and-ci`](branches/agent-unify-guidelines-and-ci.md)
- [`chore/node-24-pin`](branches/chore-node-24-pin.md)
- [`claude/ankunft-abreise-adjustments-cb8tvs`](branches/claude-ankunft-abreise-adjustments-cb8tvs.md)
- [`claude/arcade-against-ai-admin-s55h89`](branches/claude-arcade-against-ai-admin-s55h89.md)
- [`claude/arcade-all-open-lobbies-tptts0`](branches/claude-arcade-all-open-lobbies-tptts0.md)
- [`claude/arcade-e2e-testing-gn96bz`](branches/claude-arcade-e2e-testing-gn96bz.md)
- [`claude/arcade-games-reports-hwafva`](branches/claude-arcade-games-reports-hwafva.md)
- [`claude/arcade-game-tiles-width-izo34m`](branches/claude-arcade-game-tiles-width-izo34m.md)
- [`claude/arcade-lobby-filtering-witbyu`](branches/claude-arcade-lobby-filtering-witbyu.md)
- [`claude/arcade-mode-adjustments-eq29ci`](branches/claude-arcade-mode-adjustments-eq29ci.md)
- [`claude/arcade-pause-exit-options-d9kd54`](branches/claude-arcade-pause-exit-options-d9kd54.md)
- [`claude/arcade-ready-button-cw1cth`](branches/claude-arcade-ready-button-cw1cth.md)
- [`claude/automated-deployment-pipeline-jw2zf1`](branches/claude-automated-deployment-pipeline-jw2zf1.md)
- [`claude/auto-resume-token-reset-0jl2dt`](branches/claude-auto-resume-token-reset-0jl2dt.md)
- [`claude/bock-skill-slider-bug-hp7fce`](branches/claude-bock-skill-slider-bug-hp7fce.md)
- [`claude/captain-draft-skill-level-pj2i5b`](branches/claude-captain-draft-skill-level-pj2i5b.md)
- [`claude/delete-confirmation-dialogs-n55op3`](branches/claude-delete-confirmation-dialogs-n55op3.md)
- [`claude/design-system-setup-7m45xk`](branches/claude-design-system-setup-7m45xk.md)
- [`claude/food-order-metadata-links-tupa5b`](branches/claude-food-order-metadata-links-tupa5b.md)
- [`claude/funny-mayer-8ib4li`](branches/claude-funny-mayer-8ib4li.md)
- [`claude/game-list-trackability-icon-pzmnf6`](branches/claude-game-list-trackability-icon-pzmnf6.md)
- [`claude/game-preference-voting-ototpn`](branches/claude-game-preference-voting-ototpn.md)
- [`claude/game-results-draw-display-opzvah`](branches/claude-game-results-draw-display-opzvah.md)
- [`claude/games-features-reorganization-k3lbwv`](branches/claude-games-features-reorganization-k3lbwv.md)
- [`claude/group-scoping-catalog-presence`](branches/claude-group-scoping-catalog-presence.md)
- [`claude/home-pause-button-bug-xhapiv`](branches/claude-home-pause-button-bug-xhapiv.md)
- [`claude/home-tiles-games-display-c6uua7`](branches/claude-home-tiles-games-display-c6uua7.md)
- [`claude/kiosk-push-notification-sound-oaiiy9`](branches/claude-kiosk-push-notification-sound-oaiiy9.md)
- [`claude/konzept-rev5-single-group-k78eou`](branches/claude-konzept-rev5-single-group-k78eou.md)
- [`claude/lan-packing-checklist-tasks-ijg5cp`](branches/claude-lan-packing-checklist-tasks-ijg5cp.md)
- [`claude/lan-party-tools-6jqu4g`](branches/claude-lan-party-tools-6jqu4g.md)
- [`claude/lan-tools-quality-e2e-x6k61w`](branches/claude-lan-tools-quality-e2e-x6k61w.md)
- [`claude/live-page-home-redesign-ailuxo`](branches/claude-live-page-home-redesign-ailuxo.md)
- [`claude/merge-conflicts-ui-symbols-0b61av`](branches/claude-merge-conflicts-ui-symbols-0b61av.md)
- [`claude/mobile-push-respawn-icon-t82eex`](branches/claude-mobile-push-respawn-icon-t82eex.md)
- [`claude/mobile-skill-slider-jank-i5osw2`](branches/claude-mobile-skill-slider-jank-i5osw2.md)
- [`claude/multigroup-realtime-delivery-pschci`](branches/claude-multigroup-realtime-delivery-pschci.md)
- [`claude/mystifying-proskuriakova-a45f34`](branches/claude-mystifying-proskuriakova-a45f34.md)
- [`claude/order-delete-checkboxes-qyqa6a`](branches/claude-order-delete-checkboxes-qyqa6a.md)
- [`claude/order-item-paid-marking-cuanwi`](branches/claude-order-item-paid-marking-cuanwi.md)
- [`claude/packliste-abhaken-ruckler-44nl8m`](branches/claude-packliste-abhaken-ruckler-44nl8m.md)
- [`claude/packliste-push-notifications-ri4b3u`](branches/claude-packliste-push-notifications-ri4b3u.md)
- [`claude/packliste-ticket-concept-40kaqe`](branches/claude-packliste-ticket-concept-40kaqe.md)
- [`claude/pause-live-tracking-bug-uilj46`](branches/claude-pause-live-tracking-bug-uilj46.md)
- [`claude/paypal-link-eingabe-vereinfachen-9yilwk`](branches/claude-paypal-link-eingabe-vereinfachen-9yilwk.md)
- [`claude/pr-merge-order-p67vj8`](branches/claude-pr-merge-order-p67vj8.md)
- [`claude/push-notification-types-9djvav`](branches/claude-push-notification-types-9djvav.md)
- [`claude/rematch-result-history-05t4qm`](branches/claude-rematch-result-history-05t4qm.md)
- [`claude/rematch-results-winner-display-7qg5hr`](branches/claude-rematch-results-winner-display-7qg5hr.md)
- [`claude/reset-phase-r2-multigroup-removal-u8s7j6`](branches/claude-reset-phase-r2-multigroup-removal-u8s7j6.md)
- [`claude/reset-plan-r4-migrations-v0zond`](branches/claude-reset-plan-r4-migrations-v0zond.md)
- [`claude/sammelbezahlung-summe-kopieren-umx8sd`](branches/claude-sammelbezahlung-summe-kopieren-umx8sd.md)
- [`claude/scribble-io-analysis-h2vfeb`](branches/claude-scribble-io-analysis-h2vfeb.md)
- [`claude/scribble-word-list-t4o8i4`](branches/claude-scribble-word-list-t4o8i4.md)
- [`claude/search-palette-keyboard-flake`](branches/claude-search-palette-keyboard-flake.md)
- [`claude/seating-monitors-sync-iqef7o`](branches/claude-seating-monitors-sync-iqef7o.md)
- [`claude/seating-real-name`](branches/claude-seating-real-name.md)
- [`claude/select-deselect-all-unify-wdmuf6`](branches/claude-select-deselect-all-unify-wdmuf6.md)
- [`claude/session-6x1p4s`](branches/claude-session-6x1p4s.md)
- [`claude/sitzplan-mobile-cutoff-7yn0m9`](branches/claude-sitzplan-mobile-cutoff-7yn0m9.md)
- [`claude/sticky-buttons-positioning-bx9d2g`](branches/claude-sticky-buttons-positioning-bx9d2g.md)
- [`claude/sticky-voting-buttons-relyd6`](branches/claude-sticky-voting-buttons-relyd6.md)
- [`claude/team-draw-button-persistence-nadnbw`](branches/claude-team-draw-button-persistence-nadnbw.md)
- [`claude/team-draw-display-bug-gacxhe`](branches/claude-team-draw-display-bug-gacxhe.md)
- [`claude/team-draw-feature-rni1xs`](branches/claude-team-draw-feature-rni1xs.md)
- [`claude/team-draw-seat-neighbors-2wfji2`](branches/claude-team-draw-seat-neighbors-2wfji2.md)
- [`claude/teams-auslosung-button-layout-fheukt`](branches/claude-teams-auslosung-button-layout-fheukt.md)
- [`claude/teams-section-cleanup-6tg1so`](branches/claude-teams-section-cleanup-6tg1so.md)
- [`claude/test-coverage-analysis-ragd8i`](branches/claude-test-coverage-analysis-ragd8i.md)
- [`claude/test-user-admin-setup-4ntv3z`](branches/claude-test-user-admin-setup-4ntv3z.md)
- [`claude/tool-spacing-buttons-i853pj`](branches/claude-tool-spacing-buttons-i853pj.md)
- [`claude/tournament-lobby-features-yt5cgp`](branches/claude-tournament-lobby-features-yt5cgp.md)
- [`claude/tournament-teams-consistency-lkkns1`](branches/claude-tournament-teams-consistency-lkkns1.md)
- [`claude/tracking-tool-pause-feature-62phr2`](branches/claude-tracking-tool-pause-feature-62phr2.md)
- [`claude/user-management-concept-xbro77`](branches/claude-user-management-concept-xbro77.md)
- [`claude/voting-page-improvements-3bsox6`](branches/claude-voting-page-improvements-3bsox6.md)
- [`claude/voting-section-redesign-dop6cu`](branches/claude-voting-section-redesign-dop6cu.md)
- [`claude/voting-slider-color-bug-zbq2uh`](branches/claude-voting-slider-color-bug-zbq2uh.md)
- [`claude/zahlenfeld-mausrad-fix-9iwfbb`](branches/claude-zahlenfeld-mausrad-fix-9iwfbb.md)
- [`codex/arcade-tetris-navigation-fix`](branches/codex-arcade-tetris-navigation-fix.md)
- [`codex/arcade-viewport-aspect-ratio`](branches/codex-arcade-viewport-aspect-ratio.md)
- [`codex/arcade-viewport-fix`](branches/codex-arcade-viewport-fix.md)
- [`codex/changelog-deploy-hardening`](branches/codex-changelog-deploy-hardening.md)
- [`codex/deploy-optimizations`](branches/codex-deploy-optimizations.md)
- [`codex/docker-prepare-fix`](branches/codex-docker-prepare-fix.md)
- [`codex/feedback-general-ui-polish`](branches/codex-feedback-general-ui-polish.md)
- [`codex/fix-arcade-spectator-views`](branches/codex-fix-arcade-spectator-views.md)
- [`codex/fix-scribble-watch-rerender`](branches/codex-fix-scribble-watch-rerender.md)
- [`codex/group-management`](branches/codex-group-management.md)
- [`codex/phase5c-seating-pings`](branches/codex-phase5c-seating-pings.md)
- [`codex/pr201-hardening`](branches/codex-pr201-hardening.md)
- [`codex/reset-plan-r3`](branches/codex-reset-plan-r3.md)
- [`codex/reset-r5-docs`](branches/codex-reset-r5-docs.md)
- [`codex/spotify-music-session`](branches/codex-spotify-music-session.md)
- [`codex/update-arcade-changelog`](branches/codex-update-arcade-changelog.md)
- [`codex/update-seat-neighbor-labels`](branches/codex-update-seat-neighbor-labels.md)
- [`concurrency-fix-onto-main`](branches/concurrency-fix-onto-main.md)
- [`feat/46-arcade-pong`](branches/feat-46-arcade-pong.md)
- [`feat/admin-base`](branches/feat-admin-base.md)
- [`feat/agent-diagnostics`](branches/feat-agent-diagnostics.md)
- [`feat/arcade-blobby-volley`](branches/feat-arcade-blobby-volley.md)
- [`feat/arcade-quiz`](branches/feat-arcade-quiz.md)
- [`feat/arcade-tetris`](branches/feat-arcade-tetris.md)
- [`feat/arrival-carpools`](branches/feat-arrival-carpools.md)
- [`feat/game-catalog`](branches/feat-game-catalog.md)
- [`feat/games-table-polish`](branches/feat-games-table-polish.md)
- [`feat/github-feedback-link`](branches/feat-github-feedback-link.md)
- [`feat/lan-polish-agent-pwa`](branches/feat-lan-polish-agent-pwa.md)
- [`feat/lucide-ui-icons`](branches/feat-lucide-ui-icons.md)
- [`feat/seating-drag-drop`](branches/feat-seating-drag-drop.md)
- [`fix/assigned-bugs`](branches/fix-assigned-bugs.md)
- [`fix/e2e-admin-count-height-flake`](branches/fix-e2e-admin-count-height-flake.md)
- [`fix/e2e-modal-cleanup`](branches/fix-e2e-modal-cleanup.md)
- [`fix/food-order-icons-guideline`](branches/fix-food-order-icons-guideline.md)
- [`fix/issues-31-19-25`](branches/fix-issues-31-19-25.md)
- [`fix/live-status-agent-url`](branches/fix-live-status-agent-url.md)
- [`fix/logo-landing-link`](branches/fix-logo-landing-link.md)
- [`fix/rang-1-gold-css-property`](branches/fix-rang-1-gold-css-property.md)
- [`fix/themed-datetime-picker`](branches/fix-themed-datetime-picker.md)
- [`fix/topbar-wordmark`](branches/fix-topbar-wordmark.md)
- [`fix-cloudflared-network-split`](branches/fix-cloudflared-network-split.md)
- [`fix-disk-full-image-prune`](branches/fix-disk-full-image-prune.md)
- [`fix-e2e-chromium-path`](branches/fix-e2e-chromium-path.md)
- [`node24-fix-onto-main`](branches/node24-fix-onto-main.md)
- [`symbol-fix`](branches/symbol-fix.md)
- [`test/all-features-local`](branches/test-all-features-local.md)
- [`worktree-hetzner-cicd`](branches/worktree-hetzner-cicd.md)
