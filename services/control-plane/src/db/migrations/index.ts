/**
 * Migration registry — imports all migrations in order.
 * Used by the installer to discover and execute migrations.
 */

import type { Migration } from "./types.js";
import { migration as m001 } from "./001_vfx_hierarchy.js";
import { migration as m002 } from "./002_episode_task.js";
import { migration as m003 } from "./003_review_status.js";
import { migration as m004 } from "./004_version_frame_handles.js";
import { migration as m005 } from "./005_materialx_materials.js";
import { migration as m006 } from "./006_workflow_tables.js";
import { migration as m007 } from "./007_review_sessions.js";
import { migration as m008 } from "./008_timeline_enhancements.js";
import { migration as m009 } from "./009_review_workflow.js";
import { migration as m010 } from "./010_asset_genealogy.js";
import { migration as m011 } from "./011_iam_tables.js";
import { migration as m012 } from "./012_audit_trail.js";
import { migration as m013 } from "./013_adhoc_query_audit.js";
import { migration as m014 } from "./014_processed_events.js";
import { migration as m015 } from "./015_s3_compensation_log.js";
import { migration as m016 } from "./016_custom_field_definitions.js";
import { migration as m017 } from "./017_version_context_sentinels.js";
import { migration as m018 } from "./018_checkins.js";
import { migration as m019 } from "./019_version_files.js";
import { migration as m020 } from "./020_triggers_webhooks.js";
import { migration as m021 } from "./021_workflow_engine.js";
import { migration as m022 } from "./022_dataengine_dispatches.js";
import { migration as m023 } from "./023_naming_templates.js";

export type { Migration } from "./types.js";

export const migrations: Migration[] = [
  m001, m002, m003, m004, m005, m006, m007, m008, m009, m010,
  m011, m012, m013, m014, m015, m016, m017, m018, m019, m020, m021, m022, m023,
];
