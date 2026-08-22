import { Router } from "express";
import bcrypt from "bcryptjs";
import { db } from "@workspace/db";
import {
  usersTable,
  campusesTable,
  recoverySessionsTable,
} from "@workspace/db";
import { eq } from "drizzle-orm";
import { requireSession } from "../lib/auth.js";
import { invalidateSessionCache } from "../lib/sessionCache.js";
import { manageableRoles, ROLE_META, SUBJECTS } from "../lib/rbac.js";
import type { Role } from "../lib/rbac.js";
import { getInstitutions, getSubjectList } from "../lib/queries.js";
import { cacheDeletePrefix } from "../lib/cache.js";
import { usersTable, campusesTable, recoverySessionsTable } from "@workspace/db";
import { UpdateRecoveryInstructorLinkBody } from "@workspace/api-zod";

const router = Router();

  const [sessions, users] = await Promise.all([
    db.select().from(recoverySessionsTable).orderBy(recoverySessionsTable.instructorName),
    db.select({ id: usersTable.id, name: usersTable.name, role: usersTable.role, isActive: usersTable.isActive })
      .from(usersTable).where(eq(usersTable.isActive, true)).orderBy(usersTable.name),
  ]);
  const users = await db
    .select()
    .from(usersTable)
    .orderBy(usersTable.createdAt);
  res.json(
    users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      role: u.role,
      campuses: u.campuses,
      subjects: u.subjects,
      isActive: u.isActive,
      createdBy: u.createdBy,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
    })),
  );
});

router.post("/users", async (req, res): Promise<void> => {
  const session = req.session!;
  const { name, email, role, password, campuses, subjects, isActive } =
    req.body as {
      name?: string;
      email?: string;
      role?: string;
      password?: string;
      campuses?: string[];
      subjects?: string[];
      isActive?: boolean;
    };
  if (!name || !email || !role || !password) {
    res.status(400).json({ error: "name, email, role, password required" });
    return;
  }
    const allowedRoles = manageableRoles(session.role as Role);
  if (!allowedRoles.includes(role as Role)) {
    res.status(403).json({ error: "Cannot assign this role" });
    return;
  }
  const normalizedEmail = email.trim().toLowerCase();
  const passwordHash = await bcrypt.hash(password, 10);
  const inserted = await db
    .insert(campusesTable)
    .values({ name, instituteId })
    .returning();
  const u = updated[0]!;
  invalidateSessionCache(u.id);
  res.json({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    campuses: u.campuses,
    subjects: u.subjects,
    isActive: u.isActive,
    createdBy: u.createdBy,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  });
});

router.delete("/users/:id", async (req, res): Promise<void> => {
  const session = req.session!;
    const id = String(req.params["id"] ?? "");
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  const target = existing[0];
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (
    session.role === "admin" &&
    (target.role === "admin" || target.role === "superadmin")
  ) {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }
  const { name, email, role, password, campuses, subjects, isActive } =
    req.body as {
      name?: string;
      email?: string;
      role?: string;
      password?: string;
      campuses?: string[];
      subjects?: string[];
      isActive?: boolean;
    };
  const updates: Partial<typeof campusesTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (name) updates.name = name;
  if (email) updates.email = email.trim().toLowerCase();
  if (role) {
    const allowedRoles = manageableRoles(session.role as Role);
    if (!allowedRoles.includes(role as Role)) {
      res.status(403).json({ error: "Cannot assign this role" });
      return;
    }
    updates.role = role as Role;
    updates.tokenVersion = (target.tokenVersion ?? 0) + 1;
  }
  if (password) updates.passwordHash = await bcrypt.hash(password, 10);
  if (campuses !== undefined) updates.campuses = campuses;
  if (subjects !== undefined) updates.subjects = subjects;
  if (isActive !== undefined) {
    updates.isActive = isActive;
    if (!isActive) {
      updates.tokenVersion =
        (updates.tokenVersion ?? target.tokenVersion ?? 0) + 1;
    }
  }
  updates.updatedAt = new Date();
  const updated = await db
    .update(campusesTable)
    .set(updates)
    .where(eq(campusesTable.id, id))
    .returning();
  const u = updated[0]!;
  invalidateSessionCache(u.id);
  res.json({
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    campuses: u.campuses,
    subjects: u.subjects,
    isActive: u.isActive,
    createdBy: u.createdBy,
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  });
});

router.delete("/users/:id", async (req, res): Promise<void> => {
  const session = req.session!;
    const id = String(req.params["id"] ?? "");
  if (id === session.sub) {
    res.status(400).json({ error: "Cannot delete yourself" });
    return;
  }
  const existing = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.id, id))
    .limit(1);
  const target = existing[0];
  if (!target) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  if (
    session.role === "admin" &&
    (target.role === "admin" || target.role === "superadmin")
  ) {
    res.status(403).json({ error: "Insufficient permissions" });
    return;
  }
  await db.delete(usersTable).where(eq(usersTable.id, id));
  res.status(204).send();
});

// Campuses
router.get("/campuses", async (_req, res) => {
  const campuses = await db
    .select()
    .from(campusesTable)
    .orderBy(campusesTable.name);
  res.json(
    campuses.map((c) => ({
      id: c.id,
      name: c.name,
      instituteId: c.instituteId,
      createdAt: c.createdAt.toISOString(),
    })),
  );
});

router.post("/campuses", async (req, res): Promise<void> => {
  const { name, instituteId } = req.body as {
    name?: string;
    instituteId?: string;
  };
  if (!name) {
    res.status(400).json({ error: "name required" });
    return;
  }
  const inserted = await db
    .insert(campusesTable)
    .values({ name, instituteId })
    .returning();
  const c = updated[0];
  if (!c) {
    res.status(404).json({ error: "Campus not found" });
    return;
  }
  res.json({
    id: c.id,
    name: c.name,
    instituteId: c.instituteId,
    createdAt: c.createdAt.toISOString(),
  });
});

router.delete("/campuses/:id", async (req, res): Promise<void> => {
    const id = String(req.params["id"] ?? "");
  const { name, instituteId } = req.body as {
    name?: string;
    instituteId?: string;
  };
  const updates: Partial<typeof campusesTable.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (name) updates.name = name;
  if (instituteId !== undefined) updates.instituteId = instituteId;
  const updated = await db
    .update(campusesTable)
    .set(updates)
    .where(eq(campusesTable.id, id))
    .returning();
  const c = updated[0];
  if (!c) {
    res.status(404).json({ error: "Campus not found" });
    return;
  }
  res.json({
    id: c.id,
    name: c.name,
    instituteId: c.instituteId,
    createdAt: c.createdAt.toISOString(),
  });
});

router.delete("/campuses/:id", async (req, res): Promise<void> => {
    const id = String(req.params["id"] ?? "");
  await db.delete(campusesTable).where(eq(campusesTable.id, id));
  res.status(204).send();
});

router.patch(
  "/recovery-sessions/:id/instructor-type",
  async (req, res): Promise<void> => {
    const id = String(req.params["id"] ?? "");
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidPattern.test(id)) {
      res.status(400).json({ error: "Invalid recovery session id" });
      return;
    }

    const instructorType = (req.body as { instructorType?: unknown })
      .instructorType;
    if (
      instructorType !== "campus" &&
      instructorType !== "backup" &&
      instructorType !== "unknown"
    ) {
      res.status(400).json({ error: "Invalid instructor type" });
      return;
    }

    const [updated] = await db
      .update(recoverySessionsTable)
      .set({
        instructorType,
        instructorTypeReviewedAt: new Date(),
        isBackupInstructor: instructorType === "backup",
        updatedAt: new Date(),
      })
      .where(eq(recoverySessionsTable.id, id))
      .returning({
        id: recoverySessionsTable.id,
        instructorType: recoverySessionsTable.instructorType,
      });
    if (!updated) {
      res.status(404).json({ error: "Recovery session not found" });
      return;
    }

    cacheDeletePrefix("session-tracker:");
    res.json(updated);
  },
);

// Meta — campuses and subjects come live from BigQuery so the assignable
// options exactly match the institutions/subjects present in the data
// warehouse. institute_name is what scope filtering matches on, so that is
// what gets stored on the user. institutions[] additionally carries the
// institute_id for display. Falls back to the Postgres campuses table /
// hardcoded SUBJECTS if BigQuery is unavailable, so the form never breaks.
router.get("/meta", async (req, res) => {
  const session = req.session!;
  const roles = manageableRoles(session.role as Role).map((r) => ({
    value: r,
    label: ROLE_META[r].label,
    description: ROLE_META[r].description,
  }));

  let institutions: { instituteId: string | null; instituteName: string }[] =
    [];
  let subjects: string[] = [];

  try {
    [institutions, subjects] = await Promise.all([
      getInstitutions(),
      getSubjectList(),
    ]);
  } catch (err) {
    req.log.error({ err }, "Failed to load meta from BigQuery, falling back");
  }

  if (institutions.length === 0) {
    const dbCampuses = await db
      .select()
      .from(campusesTable)
      .orderBy(campusesTable.name);
    institutions = dbCampuses.map((c) => ({
      instituteId: c.instituteId ?? null,
      instituteName: c.name,
    }));
  }
  if (subjects.length === 0) {
    subjects = [...SUBJECTS];
  }

  res.json({
    roles,
    campuses: institutions.map((i) => i.instituteName),
    institutions,
    subjects,
  });
});

export default router;

  const groups = new Map<string, { count: number; instructorId: string | null }>();

    const user = await db.select({ id: usersTable.id, role: usersTable.role, isActive: usersTable.isActive })
      .from(usersTable).where(eq(usersTable.id, body.userId)).limit(1);

  const parsed = UpdateRecoveryInstructorLinkBody.safeParse(req.body);

  const body = parsed.data;

    const current = groups.get(item.instructorName) ?? { count: 0, instructorId: item.instructorId };
