export interface DccExportRequest {
  asset_id: string;
  shot_id: string;
  version_label: string;
  export_format: string;
}

export interface DccExportResponse {
  job_id: string;
  status: "queued";
}

export interface DccImportRequest {
  asset_id: string;
  nuke_project_path: string;
}

export interface DccImportResponse {
  asset_id: string;
  metadata_imported: boolean;
}

export type DccJobStatus = "completed" | "in_progress" | "failed";

export interface DccJobStatusResponse {
  job_id: string;
  status: DccJobStatus;
}

export interface DccSupportedFormatsResponse {
  formats: string[];
}

export interface DccAuditEntry {
  id: string;
  action: string;
  asset_id: string | null;
  format: string | null;
  timestamp: string;
}
