// Dexie/IndexedDB implementation of the Repository interface.
// Nothing outside this file knows we use Dexie — swap freely behind the interface.
import Dexie, { type Table } from "dexie";
import type {
  Exercise,
  Template,
  WorkoutSession,
  Settings,
  ID,
  BodyWeightEntry,
} from "$lib/types";
import type { Repository } from "./repository";
import { DEFAULT_SETTINGS } from "./seed";
import { stripSessionHealth, preserveLocalHealth } from "$lib/healthPrivacy";

type SettingsRow = Settings & { id: string };
const SETTINGS_KEY = "singleton";

class BuffyDB extends Dexie {
  exercises!: Table<Exercise, ID>;
  templates!: Table<Template, ID>;
  sessions!: Table<WorkoutSession, ID>;
  settings!: Table<SettingsRow, string>;
  bodyweights!: Table<BodyWeightEntry, ID>;

  constructor() {
    super("buffy");
    // Schema versioning — to evolve the schema, ADD a new version() block below;
    // never edit an existing one in place (that silently drops user data). Add
    // .upgrade((tx) => …) when reshaping records; index-only changes migrate
    // automatically and preserve all data.
    this.version(1).stores({
      exercises: "id, name, equipment, trackingType",
      templates: "id, name, updatedAt",
      sessions: "id, startedAt, sourceTemplateId",
      settings: "id",
    });
    // v2: index completed sessions by endedAt (history + per-exercise lookups).
    this.version(2).stores({
      sessions: "id, startedAt, sourceTemplateId, endedAt",
    });
    // v3: exercises + sessions gain updatedAt (iCloud sync merge key, mirrors
    // templates' existing field) — backfill existing rows so nothing is undefined.
    this.version(3)
      .stores({
        exercises: "id, name, equipment, trackingType, updatedAt",
        sessions: "id, startedAt, sourceTemplateId, endedAt, updatedAt",
      })
      .upgrade(async (tx) => {
        const now = new Date().toISOString();
        await tx
          .table("exercises")
          .toCollection()
          .modify((e) => {
            if (!e.updatedAt) e.updatedAt = now;
          });
        await tx
          .table("sessions")
          .toCollection()
          .modify((s) => {
            if (!s.updatedAt) s.updatedAt = now;
          });
      });
    // v4: body-weight log (Trends chart). LOCAL-ONLY — health data, never synced to
    // iCloud (5.1.3(ii)); indexed by `at` for chronological reads. Adding a table is a
    // non-destructive migration; existing data is untouched.
    this.version(4).stores({
      bodyweights: "id, at",
    });
    // If another tab upgrades the schema, close this connection rather than block it.
    this.on("versionchange", () => this.close());
  }
}

export class DexieRepository implements Repository {
  readonly db = new BuffyDB();

  // Deletes tombstone instead of removing the row (see the interface doc) — the
  // tombstone rides the normal updatedAt/last-write-wins sync path, so deletions
  // propagate across devices instead of resurrecting on the next pull.
  private async tombstone<
    T extends { id: ID; updatedAt?: string; deletedAt?: string }
  >(table: Table<T, ID>, id: ID) {
    const rec = await table.get(id);
    if (!rec || rec.deletedAt) return;
    const now = this.monotonicStamp(rec.updatedAt);
    await table.put({ ...rec, deletedAt: now, updatedAt: now });
  }
  // LWW's merge key is device wall-clock time; a skewed/rewound clock would stamp an
  // edit OLDER than the record it replaces and then lose the merge against a stale
  // remote copy. Clamp every write forward of the record's own last stamp so a
  // device's successive edits are always monotonically increasing.
  private monotonicStamp(prevUpdatedAt?: string): string {
    const prevMs = prevUpdatedAt ? Date.parse(prevUpdatedAt) : 0;
    const now = Date.now();
    return new Date(now > prevMs ? now : prevMs + 1).toISOString();
  }
  private async stampFor<T extends { updatedAt?: string }>(
    table: Table<T, ID>,
    id: ID
  ): Promise<string> {
    const prev = await table.get(id);
    return this.monotonicStamp(prev?.updatedAt);
  }
  private live<T extends { deletedAt?: string }>(rows: T[]) {
    return rows.filter((r) => !r.deletedAt);
  }

  // --- exercises ---
  async listExercises() {
    return this.live(await this.db.exercises.orderBy("name").toArray());
  }
  async getExercise(id: ID) {
    const ex = await this.db.exercises.get(id);
    return ex?.deletedAt ? undefined : ex;
  }
  async upsertExercise(ex: Exercise) {
    // stamp centrally — sync merge depends on every write bumping this, and
    // there are too many call sites to trust each one to remember
    await this.db.exercises.put({
      ...ex,
      updatedAt: await this.stampFor(this.db.exercises, ex.id),
    });
  }
  async deleteExercise(id: ID) {
    await this.tombstone(this.db.exercises, id);
  }

  // --- templates ---
  async listTemplates() {
    return this.live(
      await this.db.templates.orderBy("updatedAt").reverse().toArray()
    );
  }
  async getTemplate(id: ID) {
    const t = await this.db.templates.get(id);
    return t?.deletedAt ? undefined : t;
  }
  async upsertTemplate(t: Template) {
    await this.db.templates.put({
      ...t,
      updatedAt: await this.stampFor(this.db.templates, t.id),
    });
  }
  async deleteTemplate(id: ID) {
    await this.tombstone(this.db.templates, id);
  }

  // --- sessions ---
  async listSessions() {
    return this.live(
      await this.db.sessions.orderBy("startedAt").reverse().toArray()
    );
  }
  async getSession(id: ID) {
    const s = await this.db.sessions.get(id);
    return s?.deletedAt ? undefined : s;
  }
  async upsertSession(s: WorkoutSession) {
    await this.db.sessions.put({
      ...s,
      updatedAt: await this.stampFor(this.db.sessions, s.id),
    });
  }
  async deleteSession(id: ID) {
    await this.tombstone(this.db.sessions, id);
  }
  // Health-only patch: atomic re-read + write in ONE transaction (so a remote record
  // applied mid-capture can't be clobbered), and deliberately NOT through upsertSession
  // so updatedAt is preserved — health data never rides sync, so it must not move the
  // LWW clock. See the interface doc.
  async patchSessionHealth(
    id: ID,
    patch: (fresh: WorkoutSession) => WorkoutSession | null
  ) {
    return this.db.transaction("rw", this.db.sessions, async () => {
      const fresh = await this.db.sessions.get(id);
      if (!fresh || fresh.deletedAt) return null;
      const updated = patch(fresh);
      if (!updated) return null;
      await this.db.sessions.put(updated);
      return updated;
    });
  }
  async lastSessionForExercise(exerciseId: ID) {
    const all = await this.db.sessions.orderBy("startedAt").reverse().toArray();
    return all.find(
      (s) =>
        !s.deletedAt &&
        !!s.endedAt &&
        s.exercises.some((e) => e.exerciseId === exerciseId)
    );
  }

  // --- body weight (LOCAL-ONLY health data; never synced, hard-deleted) ---
  async listBodyWeights() {
    return this.db.bodyweights.orderBy("at").toArray(); // chronological
  }
  async addBodyWeight(entry: BodyWeightEntry) {
    await this.db.bodyweights.put(entry);
  }
  async deleteBodyWeight(id: ID) {
    await this.db.bodyweights.delete(id);
  }

  // --- settings ---
  async getSettings() {
    const row = await this.db.settings.get(SETTINGS_KEY);
    if (!row) return { ...DEFAULT_SETTINGS };
    // merge over defaults so a row saved before a new field existed still has it
    const { id: _id, ...rest } = row;
    return { ...DEFAULT_SETTINGS, ...rest };
  }
  async saveSettings(s: Settings) {
    await this.db.settings.put({ ...s, id: SETTINGS_KEY });
  }

  async clearAll() {
    await Promise.all([
      this.db.exercises.clear(),
      this.db.templates.clear(),
      this.db.sessions.clear(),
    ]);
  }

  // --- iCloud sync only — see the interface doc for why these skip the timestamp
  // stamp, why they must see tombstones, and why the apply re-checks freshness ---
  listExercisesForSync() {
    return this.db.exercises.toArray();
  }
  listTemplatesForSync() {
    return this.db.templates.toArray();
  }
  async listSessionsForSync() {
    // health-derived fields must not leave the device for iCloud (5.1.3(ii))
    return (await this.db.sessions.toArray()).map(stripSessionHealth);
  }

  // Write the pulled record only if it is strictly newer than what's stored NOW —
  // inside one transaction, so a local edit landing mid-sync can't be clobbered by
  // a remote record that only beat the sync pass's pre-network snapshot.
  private async applyIfNewer<T extends { id: ID; updatedAt?: string }>(
    table: Table<T, ID>,
    rec: T
  ) {
    await this.db.transaction("rw", table, async () => {
      const cur = await table.get(rec.id);
      const curTime = cur?.updatedAt ? Date.parse(cur.updatedAt) : -Infinity;
      const recTime = rec.updatedAt ? Date.parse(rec.updatedAt) : -Infinity;
      if (!cur || recTime > curTime) await table.put(rec);
    });
  }
  async applySyncedExercise(ex: Exercise) {
    await this.applyIfNewer(this.db.exercises, ex);
  }
  async applySyncedTemplate(t: Template) {
    await this.applyIfNewer(this.db.templates, t);
  }
  async applySyncedSession(s: WorkoutSession) {
    // like applyIfNewer, but preserves this device's local health fields — health
    // never rides sync in either direction (5.1.3(ii)); it's recomputed locally.
    await this.db.transaction("rw", this.db.sessions, async () => {
      const cur = await this.db.sessions.get(s.id);
      const curTime = cur?.updatedAt ? Date.parse(cur.updatedAt) : -Infinity;
      const recTime = s.updatedAt ? Date.parse(s.updatedAt) : -Infinity;
      if (!cur || recTime > curTime)
        await this.db.sessions.put(preserveLocalHealth(s, cur));
    });
  }
}
