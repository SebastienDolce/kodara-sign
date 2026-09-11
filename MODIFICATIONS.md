# Kodara Sign modification notice

Kodara Sign is a modified version of OpenSign by OpenSignLabs.

- Upstream project: https://github.com/OpenSignLabs/OpenSign
- Modified project: https://github.com/SebastienDolce/kodara-sign
- Modifying organization: KODARA LLC
- Modifications began: August 2026
- Primary public service: https://sign.kodara.dev

The upstream OpenSign copyright and license notices are retained in this repository. Except where a file or directory contains a different applicable license notice, this modified work is distributed under the GNU Affero General Public License version 3 as provided in the root `LICENSE` file.

## Material Kodara changes

Kodara modifications include, among other changes:

- Kodara Sign branding and transactional email presentation.
- HTML-backed proposal templates with arbitrary HTML, dark CSS, and light CSS.
- Chromium-based dark and print-friendly PDF rendering.
- Proposal snapshotting, integrity hashing, acceptance tracking, proposal-to-contract handoff, and first-open sender notifications.
- Delivery of accepted proposal, print-friendly proposal, signed agreement, and signing certificate.
- Kodara-branded completion certificates and proxy-aware audit IP handling.
- Public source-code / AGPL notice in the network user interface.

The Git history is the authoritative detailed record of individual modifications and dates.

## Proposal first-open notifications

The public proposal route records `FirstViewedAt` the first time a valid proposal link loads. It then sends the proposal sender a one-time email notification and records `ViewNotificationSentAt` after successful delivery. A mail-delivery failure does not block the public proposal page; a later proposal load may retry the notification until delivery succeeds.

This telemetry is intentionally observational. A recorded load means the public proposal route was requested; it does not prove the identity of the person or automated system that opened the link, and it does not represent proposal acceptance or an electronic signature. Acceptance and signing continue to use their existing explicit workflow and audit events.

The database fields are added by the server migration system and are applied when the OpenSign server starts. No frontend deployment or new client-side configuration is required for this behavior.

## Corresponding Source

The corresponding source for the Kodara Sign network service is made available at no charge at:

https://github.com/SebastienDolce/kodara-sign

Users of the network service are also provided a visible `Source code · AGPL-3.0` link in the application interface.

## No upstream endorsement

Kodara Sign is independently modified and operated by KODARA LLC. It is not the official hosted service of OpenSignLabs, and the Kodara Sign name and branding are used to distinguish this modified deployment from the upstream project.
