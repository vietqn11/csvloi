export interface ProcessedFile {
  id: string;
  name: string;
  rawText: string;
  size: number;
  result: ProcessResult | null;
  aiAnalysis: string | null;
  isAiLoading: boolean;
  aiError: string | null;
}

export interface ProcessResult {
  status: "ok" | "warn" | "err";
  message: string;
  csvText: string | null;
  matchedCount: number;
  totalRows: number;
  dateColName: string;
  dateIdx: number;
  misaligned: boolean;
  extraCols: number;
  columns: string[];
}

export interface SummaryData {
  total_rows: number;
  columns: string[];
  date_range: { from: string; to: string } | null;
  rows_per_day: Record<string, number>;
  status_column_counts: Record<string, Record<string, number>>;
  sample_abnormal_rows: Record<string, string>[];
  abnormal_row_count_found: number;
}
