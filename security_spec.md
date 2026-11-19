# Security Specification — VaniSetu Firestore Rules

## 1. Data Invariants
1. **Identity Integrity**: No user may create or modify a `UserProfile`, `DialectTranscript`, `ModelEvaluation`, or `ApiWebhook` with an `ownerId`/`uid` belonging to another user.
2. **Privilege Escalation Prevention**: Users registering a `UserProfile` may only initialize `role == 'contributor'` unless they are a verified admin (`isAdmin()`). Users cannot self-promote `role` on update.
3. **PII Isolation**: User email, phone, and private notes reside exclusively in `/users/{userId}/private/{docId}` and are readable/writable only by `isOwner(userId)` or `isAdmin()`.
4. **Terminal State Locking**: A `DialectTranscript` whose `status == 'verified'` is locked against updates or deletion by non-admin users.
5. **Temporal Integrity**: `createdAt` and `updatedAt` must equal `request.time` on creation, and `createdAt` is immutable on update while `updatedAt == request.time`.
6. **Zero Query Delegation**: Every `allow list` rule evaluates `resource.data` directly without `get()` or `exists()` calls.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Self-Admin Registration**: `POST /users/{uid}` with `{ role: "admin", ... }` by a non-admin user -> `PERMISSION_DENIED`.
2. **Role Escalation Update**: `PATCH /users/{uid}` updating `role` from `"contributor"` to `"admin"` by owner -> `PERMISSION_DENIED`.
3. **Shadow Ghost Field**: `POST /transcripts/{id}` with valid fields plus `{ isApprovedOverride: true }` -> `PERMISSION_DENIED`.
4. **ID Poisoning**: `POST /transcripts/a... (200 chars)` or invalid characters (`../admin`) -> `PERMISSION_DENIED`.
5. **Owner Spoofing**: `POST /transcripts/{id}` with `ownerId: "victim_uid"` while authenticated as `"attacker_uid"` -> `PERMISSION_DENIED`.
6. **PII Cross-Read**: `GET /users/{victim_uid}/private/info` as another signed-in user -> `PERMISSION_DENIED`.
7. **Unverified Email Write**: Write request where `request.auth.token.email_verified == false` -> `PERMISSION_DENIED`.
8. **Admin Email Spoof**: Write to `/departments/d1` where `token.email == "pavanimule85@gmail.com"` and `email_verified == false` -> `PERMISSION_DENIED`.
9. **Terminal State Mutation**: `PATCH /transcripts/{id}` changing `translatedText` when `existing().status == 'verified'` as non-admin -> `PERMISSION_DENIED`.
10. **Immutable Timestamp Backdating**: `POST /transcripts/{id}` with `createdAt` set to a past timestamp instead of `request.time` -> `PERMISSION_DENIED`.
11. **Denial-of-Wallet Oversized String**: `POST /transcripts/{id}` with `sourceTranscript` > 12000 chars -> `PERMISSION_DENIED`.
12. **Blanket List Scraping**: `LIST /transcripts` querying private records where `ownerId != request.auth.uid` and `visibility != 'archive'` -> `PERMISSION_DENIED`.
