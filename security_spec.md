# SmartPlate VN 2.0 — Security Specification (Phase 0)

## 1. Data Invariants
1. **No Self-Privilege Escalation**: A newly registered user via Google Sign-In may only initialize their own `/users/{uid}` document with `role` in `['student', 'parent']` and `status: 'active'` (unless the caller is the bootstrapped Super Admin `vulin10000@gmail.com`). Users can never update their own `role`, `status`, `schoolId`, `verifiedParentIds`, or `linkedChildIds`.
2. **Suspended Account Lockout**: Any user document with `status == 'suspended'` or `'deleted'` is denied all write operations across all collections.
3. **Strict School Tenant Isolation**: `school_admin` and `teacher` accounts can only read/write school-scoped resources (`classes`, `academic_years`, `meal_logs`, `menus`, `teacher_comments`, `student_tasks`) where `schoolId == caller.schoolId`.
4. **Class Scope for Teachers**: Teachers can only update/review `meal_logs`, assign `student_tasks`, and write `teacher_comments` for classes present in `caller.classIds`.
5. **Verified Parent-Child Access**: Parents can only read `meal_logs`, `teacher_comments`, and `student_progress` when `request.auth.uid in resource.data.verifiedParentIds` (which is only populated upon verification of a `parent_child_links` record by `school_admin` or `super_admin`).
6. **Immutable Audit Trail**: `audit_logs` are append-only (`allow update, delete: if false`) and must bind `actorUid == request.auth.uid` and `createdAt == request.time`.
7. **Temporal & Schema Integrity**: Every created document must validate `createdAt == request.time` and `updatedAt == request.time`, enforce `.size()` bounds on all strings/arrays, and reject ghost/shadow fields via `keys().hasOnly(...)` and `affectedKeys().hasOnly(...)`.

## 2. Dirty Dozen Attack Payloads (Expected: PERMISSION_DENIED)
1. **Role Self-Escalation on Create**: Student creates `/users/{uid}` with `role: "super_admin"`.
2. **Role Self-Escalation on Update**: Authenticated student updates `/users/{uid}` changing `role` to `"school_admin"`.
3. **Ghost Field Injection (Shadow Update)**: User updates `/users/{uid}` adding `{ displayName: "An", isVerified: true }`.
4. **Cross-School Meal Log Read**: Teacher from `school_a` queries `meal_logs` with `schoolId == "school_b"`.
5. **Unverified Parent Snooping**: Parent tries to read `meal_logs` of a student whose `verifiedParentIds` does not include `parentUid`.
6. **Suspended User Write**: User with `status == "suspended"` attempts to create a `meal_logs` document.
7. **Student Deleting Teacher Comment**: Student attempts `delete` on `/teacher_comments/{commentId}`.
8. **Audit Log Tampering**: School Admin attempts `update` or `delete` on `/audit_logs/{logId}`.
9. **Spoofed Actor UID in Audit Log**: User creates `/audit_logs/{logId}` with `actorUid: "other_uid"`.
10. **ID Poisoning**: Attacker writes document with 500-character ID or invalid characters `../admin`.
11. **Timestamp Forgery**: User creates `/meal_logs/{logId}` with backdated `createdAt` instead of server `request.time`.
12. **Unverified Email Admin Spoof**: Token with `email: "vulin10000@gmail.com"` and `email_verified: false` attempts Super Admin write.
