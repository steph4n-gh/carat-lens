import { z } from "zod";

export const OriginClassSchema = z.enum([
  "carried",
  "source",
  "source_elsewhere",
  "source_normalized",
  "rebuilt",
  "unexplained",
]);
export type OriginClass = z.infer<typeof OriginClassSchema>;

export const FileRoleSchema = z.enum([
  "code",
  "manifest",
  "declaration",
  "source_map",
  "binary",
  "doc",
  "other",
]);
export type FileRole = z.infer<typeof FileRoleSchema>;

export const VerdictSchema = z.enum(["explained", "read", "stop"]);
export type Verdict = z.infer<typeof VerdictSchema>;

export const AnchorSchema = z.object({
  found: z.boolean(),
  commit: z.string().nullable(),
  method: z.string().nullable(),
  methods_tried: z.array(z.string()),
  conflict: z.boolean(),
  conflict_details: z.array(z.string()),
  repository_url: z.string().nullable(),
  repository_directory: z.string().nullable(),
  workflow_path: z.string().nullable(),
  workflow_ref: z.string().nullable(),
  reachable_from_branch: z.boolean().nullable(),
  lookup_error: z.string().nullable().optional(),
});
export type Anchor = z.infer<typeof AnchorSchema>;

export const FileOriginSchema = z.object({
  path: z.string(),
  sha256: z.string(),
  bytes: z.number(),
  class: OriginClassSchema,
  role: FileRoleSchema,
  moved_from: z.string().nullable().optional(),
  source_path: z.string().nullable().optional(),
  normalization: z.string().nullable().optional(),
  significant_manifest_diffs: z.array(z.string()).optional(),
});
export type FileOrigin = z.infer<typeof FileOriginSchema>;

export const ClassTotalSchema = z.object({
  files: z.number(),
  bytes: z.number(),
});

export const LedgerEndpointSchema = z.object({
  version: z.string(),
  sha512: z.string(),
  profile_id: z.string(),
  standing: z.string().nullable().optional(),
  published_at: z.string().nullable().optional(),
});

export const TransitionLedgerSchema = z.object({
  kind: z.string(),
  schema: z.number(),
  subject: z.string(),
  ecosystem: z.string(),
  name: z.string(),
  reference: LedgerEndpointSchema.nullable(),
  new: LedgerEndpointSchema,
  anchor: AnchorSchema,
  lock_alarms: z.array(z.string()),
  archive_facts: z.array(z.string()),
  files: z.array(FileOriginSchema),
  removed_files: z.array(z.string()),
  totals: z.record(z.string(), ClassTotalSchema),
  unexplained_code_bytes: z.number(),
  unexplained_non_exec_bytes: z.number(),
  breaks: z.array(z.string()),
  flags: z.array(z.string()),
  break_notes: z.record(z.string(), z.string()),
  advisory_ids: z.array(z.string()).optional(),
  osv_unavailable: z.boolean().optional(),
  new_reach: z.array(z.string()),
  new_reach_in_unexplained: z.array(z.string()),
  new_reach_files: z.record(z.string(), z.array(z.string())),
  new_hostnames: z.array(z.string()),
  prior_release_count: z.number().optional(),
  package_first_published_at: z.string().nullable().optional(),
  history_slice_sha256: z.string().nullable().optional(),
  tool_version: z.string(),
});
export type TransitionLedger = z.infer<typeof TransitionLedgerSchema>;

export const DecisionSchema = z.object({
  kind: z.string(),
  schema: z.number(),
  ledger_id: z.string(),
  subject: z.string(),
  as_of: z.string(),
  policy_version: z.number(),
  published_age_hours: z.number().nullable(),
  age_band: z.string(),
  reading_required: z.boolean(),
  reading_outcome: z.string(),
  stop_rules: z.array(z.string()),
  stop_facts: z.array(z.string()),
  stop_reasons: z.array(z.string()),
  verdict: VerdictSchema,
});
export type Decision = z.infer<typeof DecisionSchema>;

export const ResidualDiffSchema = z.object({
  path: z.string(),
  bytes: z.number(),
  total_lines: z.number(),
  truncated: z.boolean(),
  diff: z.string(),
});
export type ResidualDiff = z.infer<typeof ResidualDiffSchema>;

export const ApprovalRecordSchema = z.object({
  kind: z.string(),
  schema: z.number(),
  subject: z.string(),
  ledger_id: z.string(),
  approved_facts: z.array(z.string()),
  approver: z.string(),
  approved_at: z.string(),
  note: z.string().nullable().optional(),
});
export type ApprovalRecord = z.infer<typeof ApprovalRecordSchema>;

export const RouteEdgeSchema = z.object({
  from: z.string(),
  to: z.string(),
  kind: z.string(),
});

export const ExplainResultSchema = z.object({
  ledger_id: z.string().optional(),
  ledger: TransitionLedgerSchema,
  decision: DecisionSchema,
  residual_diffs: z.array(ResidualDiffSchema).optional().default([]),
  reading: z.unknown().nullable().optional(),
  route: z.array(RouteEdgeSchema).optional().default([]),
  approved_by: z.string().nullable().optional(),
});
export type ExplainResult = z.infer<typeof ExplainResultSchema>;

export const StoreEntrySchema = z.object({
  ledger_id: z.string(),
  ledger: TransitionLedgerSchema,
  decision: DecisionSchema.nullable(),
  approval: ApprovalRecordSchema.nullable(),
});
export type StoreEntry = z.infer<typeof StoreEntrySchema>;

export const InventoryPackageSchema = z.object({
  instance_path: z.string(),
  name: z.string(),
  version: z.string().nullable(),
  resolved: z.string().nullable(),
  sha512: z.string().nullable(),
  source_kind: z.string(),
  dev: z.boolean().optional(),
  optional: z.boolean().optional(),
  in_bundle: z.boolean().optional(),
});

export const InventoryResultSchema = z.object({
  total_packages: z.number(),
  missing_integrity: z.number(),
  non_registry: z.number(),
  packages: z.array(InventoryPackageSchema),
});
export type InventoryResult = z.infer<typeof InventoryResultSchema>;

export const GitExposureHitSchema = z.object({
  repo: z.string(),
  lockfile: z.string(),
  name: z.string(),
  version: z.string().nullable(),
  sha512: z.string().nullable(),
  instance_path: z.string(),
  first_commit: z.string(),
  first_date: z.string(),
  last_commit: z.string(),
  last_date: z.string(),
  still_present: z.boolean(),
});

export const StoreExposureHitSchema = z.object({
  ledger_id: z.string(),
  subject: z.string(),
  name: z.string(),
  version: z.string(),
  sha512: z.string(),
  published_at: z.string().nullable(),
});

export const ExposureResultSchema = z.object({
  query: z.string().optional(),
  git_hits: z.array(GitExposureHitSchema).default([]),
  store_hits: z.array(StoreExposureHitSchema).default([]),
});
export type ExposureResult = z.infer<typeof ExposureResultSchema>;

export const ExplainRequestSchema = z.object({
  spec: z
    .string()
    .trim()
    .regex(/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+@[0-9A-Za-z._+-]+\.\.[0-9A-Za-z._+-]+$/, {
      message: "Expected format <name>@<from>..<to>, e.g. chalk@5.4.0..5.4.1",
    }),
  projectDir: z.string().min(1).optional(),
});

export const ExposureRequestSchema = z.object({
  spec: z
    .string()
    .trim()
    .regex(/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+@[0-9A-Za-z._+-]+$/, {
      message: "Expected format <name>@<version>, e.g. zod@4.6.7",
    }),
  projectDir: z.string().min(1),
});
