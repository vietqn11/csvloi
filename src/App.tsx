import { useState, useRef, useEffect } from "react";
import {
  FileSpreadsheet,
  UploadCloud,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Download,
  Sparkles,
  Eye,
  EyeOff,
  Trash2,
  FileArchive,
  RefreshCw,
  Settings,
  ChevronLeft,
  ChevronRight,
  Info,
  Calendar,
  AlertCircle,
  ListFilter,
  FileCheck2,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import JSZip from "jszip";
import { ProcessedFile, ProcessResult, SummaryData } from "./types";

export default function App() {
  // Application State
  const [files, setFiles] = useState<ProcessedFile[]>([]);
  const [dateColName, setDateColName] = useState<string>("Date");
  const [inFormat, setInFormat] = useState<"YMDHMS" | "DMYHMS">("YMDHMS");
  const [delim, setDelim] = useState<string>(",");
  const [userNotes, setUserNotes] = useState<string>("");
  const [activeTableIdx, setActiveTableIdx] = useState<number | null>(null);
  const [previewPage, setPreviewPage] = useState<number>(1);
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const [isProcessingAll, setIsProcessingAll] = useState<boolean>(false);
  const [apiHealth, setApiHealth] = useState<{ status: string; aiConfigured: boolean } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const previewRowsPerPage = 15;

  // Check API health on load
  useEffect(() => {
    fetch("/api/health")
      .then((res) => res.json())
      .then((data) => setApiHealth(data))
      .catch((err) => console.error("Error checking API health:", err));
  }, []);

  // Helper functions for CSV Parsing & Formatting
  function splitCSVLine(line: string, separator: string): string[] {
    const result: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === separator && !inQuotes) {
        result.push(cur);
        cur = "";
      } else {
        cur += ch;
      }
    }
    result.push(cur);
    return result;
  }

  function csvEscape(val: string): string {
    const s = val === undefined || val === null ? "" : String(val);
    if (/[",\r\n]/.test(s)) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  }

  function parseDateToken(token: string, mode: "YMDHMS" | "DMYHMS"): string | null {
    const t = token.trim();
    if (!/^\d{14}$/.test(t)) return null;

    let y = "", mo = "", d = "", h = "", mi = "", s = "";
    if (mode === "DMYHMS") {
      d = t.slice(0, 2);
      mo = t.slice(2, 4);
      y = t.slice(4, 8);
      h = t.slice(8, 10);
      mi = t.slice(10, 12);
      s = t.slice(12, 14);
    } else {
      y = t.slice(0, 4);
      mo = t.slice(4, 6);
      d = t.slice(6, 8);
      h = t.slice(8, 10);
      mi = t.slice(10, 12);
      s = t.slice(12, 14);
    }

    const yearNum = Number(y);
    const monthNum = Number(mo);
    const dayNum = Number(d);
    const hourNum = Number(h);
    const minNum = Number(mi);
    const secNum = Number(s);

    const dt = new Date(yearNum, monthNum - 1, dayNum, hourNum, minNum, secNum);
    if (isNaN(dt.getTime())) return null;
    if (
      dt.getFullYear() !== yearNum ||
      dt.getMonth() + 1 !== monthNum ||
      dt.getDate() !== dayNum ||
      dt.getHours() !== hourNum ||
      dt.getMinutes() !== minNum ||
      dt.getSeconds() !== secNum
    ) {
      return null;
    }

    return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
  }

  function processSingleFileText(rawText: string, customColName: string): ProcessResult {
    const activeDelim = delim === "\\t" ? "\t" : delim;
    const cleanText = rawText.replace(/^\uFEFF/, "");
    const lines = cleanText.split(/\r\n|\n|\r/).filter((l, idx, arr) => !(idx === arr.length - 1 && l === ""));

    if (lines.length < 2) {
      return {
        status: "err",
        message: "File rỗng hoặc không đủ số dòng (yêu cầu ít nhất 2 dòng bao gồm tiêu đề).",
        csvText: null,
        matchedCount: 0,
        totalRows: 0,
        dateColName: customColName,
        dateIdx: -1,
        misaligned: false,
        extraCols: 0,
        columns: [],
      };
    }

    const headerRaw = splitCSVLine(lines[0], activeDelim).map((h) => h.trim());
    const headerCount = headerRaw.length;

    // Detect date column
    let dateIdx = headerRaw.findIndex((h) => h.toLowerCase() === customColName.toLowerCase());
    let dateColAutodetected = false;

    if (dateIdx === -1) {
      // Look at the second row to probe for a 14-digit sequence
      const probeFields = splitCSVLine(lines[1], activeDelim);
      for (let i = 0; i < probeFields.length; i++) {
        if (/^\d{14}$/.test(probeFields[i].trim())) {
          dateIdx = i;
          dateColAutodetected = true;
          break;
        }
      }
    }

    if (dateIdx === -1) {
      return {
        status: "err",
        message: `Không tìm thấy cột "${customColName}" hoặc bất kỳ cột nào chứa chuỗi 14 chữ số ở dòng dữ liệu đầu tiên.`,
        csvText: null,
        matchedCount: 0,
        totalRows: lines.length - 1,
        dateColName: customColName,
        dateIdx: -1,
        misaligned: false,
        extraCols: 0,
        columns: headerRaw,
      };
    }

    // Detect column misalignment by scanning a sample of rows
    const sampleSize = Math.min(50, lines.length - 1);
    const dataLens: Record<number, number> = {};
    for (let i = 1; i <= sampleSize; i++) {
      const fields = splitCSVLine(lines[i], activeDelim);
      dataLens[fields.length] = (dataLens[fields.length] || 0) + 1;
    }

    let commonDataLen = headerCount;
    let maxCount = 0;
    for (const lenStr in dataLens) {
      const len = Number(lenStr);
      if (dataLens[len] > maxCount) {
        maxCount = dataLens[len];
        commonDataLen = len;
      }
    }

    const misaligned = commonDataLen > headerCount;
    const extraCols = misaligned ? commonDataLen - headerCount : 0;

    // Adjust headers
    const adjustedHeaders = [...headerRaw];
    if (misaligned) {
      for (let i = 0; i < extraCols; i++) {
        adjustedHeaders.push(`Cột_Bổ_Sung_${i + 1}`);
      }
    }

    let matchedCount = 0;
    let totalDataRows = 0;
    const outLines: string[] = [adjustedHeaders.map(csvEscape).join(",")];

    for (let i = 1; i < lines.length; i++) {
      const lineStr = lines[i];
      if (lineStr.trim() === "") continue;
      totalDataRows++;

      const fields = splitCSVLine(lineStr, activeDelim);

      // Pad or truncate to match adjusted headers length
      while (fields.length < adjustedHeaders.length) {
        fields.push("");
      }
      if (fields.length > adjustedHeaders.length) {
        fields.splice(adjustedHeaders.length);
      }

      const rawVal = fields[dateIdx] !== undefined ? fields[dateIdx] : "";
      const parsed = parseDateToken(rawVal, inFormat);
      if (parsed !== null) {
        fields[dateIdx] = parsed;
        matchedCount++;
      }

      outLines.push(fields.map(csvEscape).join(","));
    }

    const csvText = outLines.join("\r\n") + "\r\n";
    let status: "ok" | "warn" | "err" = "ok";
    let message = `Đã định dạng thành công ${matchedCount}/${totalDataRows} dòng thời gian.`;

    if (misaligned) {
      message += ` Phát hiện lệch cột & đã tự sửa lỗi (thêm ${extraCols} cột bổ sung).`;
      status = "warn";
    }
    if (dateColAutodetected) {
      message += ` Tự động phát hiện cột chứa ngày ở vị trí số ${dateIdx + 1} (thay vì tên "${customColName}").`;
      status = "warn";
    }
    if (matchedCount < totalDataRows) {
      const failCount = totalDataRows - matchedCount;
      message += ` Có ${failCount} dòng không parse được định dạng ngày giờ (giữ giá trị gốc).`;
      status = "warn";
    }
    if (matchedCount === 0) {
      status = "err";
      message = "Không parse được dữ liệu ngày giờ nào. Vui lòng kiểm tra lại cấu hình hoặc định dạng nguồn.";
    }

    return {
      status,
      message,
      csvText,
      matchedCount,
      totalRows: totalDataRows,
      dateColName: adjustedHeaders[dateIdx] || customColName,
      dateIdx,
      misaligned,
      extraCols,
      columns: adjustedHeaders,
    };
  }

  // Handler for files addition
  const onFilesAdded = (rawFileList: FileList) => {
    const fileArray = Array.from(rawFileList);
    const csvFiles = fileArray.filter((f) => f.name.toLowerCase().endsWith(".csv"));

    if (csvFiles.length === 0) return;

    csvFiles.forEach((file) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const text = e.target?.result as string;
        const newFile: ProcessedFile = {
          id: Math.random().toString(36).substring(2, 9),
          name: file.name,
          rawText: text,
          size: file.size,
          result: null,
          aiAnalysis: null,
          isAiLoading: false,
          aiError: null,
        };
        setFiles((prev) => [...prev, newFile]);
      };
      reader.readAsText(file, "UTF-8");
    });
  };

  // Process all files with current config
  const handleProcessAll = () => {
    if (files.length === 0) return;
    setIsProcessingAll(true);
    setTimeout(() => {
      setFiles((prev) =>
        prev.map((f) => {
          const res = processSingleFileText(f.rawText, dateColName);
          return {
            ...f,
            result: res,
          };
        })
      );
      setIsProcessingAll(false);
    }, 400);
  };

  // Summarize file output for Gemini
  function generateSummaryForAI(file: ProcessedFile): SummaryData | null {
    if (!file.result || !file.result.csvText) return null;

    const activeDelim = ","; // The output of our process is always comma separated
    const rows = file.result.csvText
      .split(/\r\n|\n/)
      .filter((l) => l !== "")
      .map((l) => splitCSVLine(l, activeDelim));

    if (rows.length < 2) return null;

    const header = rows[0];
    const body = rows.slice(1);
    const dateIdx = file.result.dateIdx;

    // Identify standard status/error columns
    // We search for columns containing "status", "result", "code", "state", "error", "type", "ng", "ok"
    const statusCols: { idx: number; name: string; values: string[] }[] = [];
    header.forEach((h, i) => {
      if (i === dateIdx) return;
      const lowerH = h.toLowerCase();
      const isStatusLike =
        lowerH.includes("status") ||
        lowerH.includes("result") ||
        lowerH.includes("code") ||
        lowerH.includes("state") ||
        lowerH.includes("error") ||
        lowerH.includes("outcome") ||
        lowerH.includes("fail") ||
        lowerH.includes("ng") ||
        lowerH.includes("ok") ||
        lowerH.includes("sensor") ||
        lowerH.includes("alarm");

      if (isStatusLike) {
        // Collect unique values (limit to first 500 rows to keep it lightweight)
        const uniqueVals = new Set<string>();
        for (let r = 0; r < Math.min(body.length, 500); r++) {
          const v = (body[r][i] || "").trim();
          if (v) uniqueVals.add(v);
        }
        if (uniqueVals.size > 0 && uniqueVals.size <= 15) {
          statusCols.push({ idx: i, name: h, values: Array.from(uniqueVals) });
        }
      }
    });

    // Compute status counts
    const statusCounts: Record<string, Record<string, number>> = {};
    statusCols.forEach((col) => {
      statusCounts[col.name] = {};
      body.forEach((r) => {
        const val = (r[col.idx] || "").trim() || "(trống)";
        statusCounts[col.name][val] = (statusCounts[col.name][val] || 0) + 1;
      });
    });

    // Parse date ranges and errors per day
    let dateRange: { from: string; to: string } | null = null;
    const rowsPerDay: Record<string, number> = {};

    if (dateIdx !== -1) {
      const validDates = body
        .map((r) => r[dateIdx])
        .filter((d) => d && /^\d{4}-\d{2}-\d{2}/.test(d))
        .sort();

      if (validDates.length > 0) {
        dateRange = {
          from: validDates[0],
          to: validDates[validDates.length - 1],
        };

        validDates.forEach((d) => {
          const day = d.slice(0, 10); // YYYY-MM-DD
          rowsPerDay[day] = (rowsPerDay[day] || 0) + 1;
        });
      }
    }

    // Capture standard sample anomalous rows
    // An anomalous row is any row where error-like columns contain values that are not standard successes (like OK, PASS, 0, true)
    const successTokens = ["ok", "pass", "good", "true", "0", "success", "yes", "active"];
    const sampleAbnormalRows: Record<string, string>[] = [];

    for (let r = 0; r < body.length && sampleAbnormalRows.length < 25; r++) {
      const row = body[r];
      const isAnomaly = statusCols.some((col) => {
        const val = (row[col.idx] || "").trim().toLowerCase();
        return val && !successTokens.includes(val);
      });

      if (isAnomaly || file.result.misaligned) {
        const rowObj: Record<string, string> = {};
        header.forEach((h, i) => {
          if (row[i]) rowObj[h] = row[i];
        });
        sampleAbnormalRows.push(rowObj);
      }
    }

    return {
      total_rows: body.length,
      columns: header,
      date_range: dateRange,
      rows_per_day: rowsPerDay,
      status_column_counts: statusCounts,
      sample_abnormal_rows: sampleAbnormalRows,
      abnormal_row_count_found: sampleAbnormalRows.length,
    };
  }

  // Trigger AI analysis on backend server
  const handleAiAnalysis = async (idx: number) => {
    const file = files[idx];
    if (!file.result || !file.result.csvText) return;

    const summary = generateSummaryForAI(file);
    if (!summary) {
      setFiles((prev) =>
        prev.map((f, i) => (i === idx ? { ...f, aiError: "Không thể tạo tóm tắt phân tích cho tệp này." } : f))
      );
      return;
    }

    // Mark loading
    setFiles((prev) =>
      prev.map((f, i) =>
        i === idx ? { ...f, isAiLoading: true, aiError: null, aiAnalysis: null } : f
      )
    );

    try {
      const response = await fetch("/api/analyze-log", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          fileName: file.name,
          summary,
          userNotes,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Gặp lỗi khi xử lý phân tích log trên máy chủ.");
      }

      setFiles((prev) =>
        prev.map((f, i) => (i === idx ? { ...f, aiAnalysis: data.analysis, isAiLoading: false } : f))
      );
    } catch (err: any) {
      console.error(err);
      setFiles((prev) =>
        prev.map((f, i) =>
          i === idx ? { ...f, aiError: err.message || "Không thể kết nối tới server AI.", isAiLoading: false } : f
        )
      );
    }
  };

  // Downloader for single file
  const handleDownloadSingle = (file: ProcessedFile) => {
    if (!file.result || !file.result.csvText) return;
    const blob = new Blob(["\uFEFF" + file.result.csvText], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = file.name.replace(/\.csv$/i, "") + "_fixed.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // Downloader for batch zip
  const handleDownloadAllZip = async () => {
    const readyFiles = files.filter((f) => f.result && f.result.csvText);
    if (readyFiles.length === 0) return;

    const zip = new JSZip();
    readyFiles.forEach((f) => {
      if (f.result && f.result.csvText) {
        zip.file(f.name.replace(/\.csv$/i, "") + "_fixed.csv", "\uFEFF" + f.result.csvText);
      }
    });

    try {
      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = "csv_logs_fixed_batch.zip";
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error("Lỗi đóng gói ZIP:", err);
    }
  };

  // Remove file
  const handleRemoveFile = (idx: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== idx));
    if (activeTableIdx === idx) {
      setActiveTableIdx(null);
    } else if (activeTableIdx !== null && activeTableIdx > idx) {
      setActiveTableIdx(activeTableIdx - 1);
    }
  };

  // Clear all
  const handleClearAll = () => {
    setFiles([]);
    setActiveTableIdx(null);
  };

  // Read preview data
  const getPreviewRows = () => {
    if (activeTableIdx === null || !files[activeTableIdx]?.result?.csvText) return { headers: [], rows: [] };
    const text = files[activeTableIdx].result!.csvText!;
    const allLines = text.split(/\r\n|\n/).filter((l) => l !== "");
    const headers = splitCSVLine(allLines[0], ",");
    const dataLines = allLines.slice(1);

    const startIndex = (previewPage - 1) * previewRowsPerPage;
    const paginatedLines = dataLines.slice(startIndex, startIndex + previewRowsPerPage);
    const rows = paginatedLines.map((l) => splitCSVLine(l, ","));

    return { headers, rows, total: dataLines.length };
  };

  const previewData = getPreviewRows();

  // Simple custom Markdown to HTML element parser for clean rendering of Gemini responses
  function renderMarkdownText(mdText: string) {
    const lines = mdText.split("\n");
    return lines.map((line, index) => {
      // Headers
      if (line.startsWith("### ")) {
        return (
          <h4 key={index} className="text-md font-semibold text-emerald-950 mt-5 mb-2 border-b border-emerald-100 pb-1 flex items-center gap-2">
            {line.replace("### ", "")}
          </h4>
        );
      }
      if (line.startsWith("## ")) {
        return (
          <h3 key={index} className="text-lg font-bold text-emerald-900 mt-6 mb-3 flex items-center gap-2">
            {line.replace("## ", "")}
          </h3>
        );
      }
      // Bullet points
      if (line.startsWith("* ") || line.startsWith("- ")) {
        const cleanContent = line.replace(/^[\*\-]\s+/, "");
        return (
          <li key={index} className="ml-4 list-disc text-slate-700 mb-1 pl-1 text-sm leading-relaxed">
            {renderBoldText(cleanContent)}
          </li>
        );
      }
      // Blockquotes
      if (line.startsWith("> ")) {
        return (
          <blockquote key={index} className="border-l-4 border-emerald-500 bg-emerald-50/50 p-3 italic text-slate-700 text-sm my-2 rounded-r">
            {renderBoldText(line.replace("> ", ""))}
          </blockquote>
        );
      }
      // Code Blocks/Pre
      if (line.startsWith("```")) {
        return null; // Simple renderer skips the ``` tags themselves
      }
      if (line.startsWith("    ") || line.startsWith("\t") || (line.includes("SELECT ") && line.includes("FROM "))) {
        return (
          <pre key={index} className="bg-slate-900 text-emerald-400 p-3 rounded font-mono text-xs overflow-x-auto my-2 shadow-inner border border-slate-800">
            <code>{line}</code>
          </pre>
        );
      }

      // Default paragraph
      if (line.trim() === "") return <div key={index} className="h-2" />;
      return (
        <p key={index} className="text-slate-700 text-sm leading-relaxed mb-2">
          {renderBoldText(line)}
        </p>
      );
    });
  }

  function renderBoldText(text: string) {
    const parts = text.split(/(\*\*.*?\*\*|`.*?`)/g);
    return parts.map((part, i) => {
      if (part.startsWith("**") && part.endsWith("**")) {
        return <strong key={i} className="font-semibold text-slate-900">{part.slice(2, -2)}</strong>;
      }
      if (part.startsWith("`") && part.endsWith("`")) {
        return <code key={i} className="bg-slate-100 border border-slate-200 px-1.5 py-0.5 rounded text-xs font-mono text-emerald-700">{part.slice(1, -1)}</code>;
      }
      return part;
    });
  }

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800 font-sans antialiased">
      {/* Container Wrapper */}
      <div className="max-w-5xl mx-auto px-4 py-8 sm:px-6 lg:py-12">
        
        {/* Header Section */}
        <header className="mb-8 text-center sm:text-left border-b border-slate-200 pb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 bg-white p-6 rounded-lg border shadow-xs">
          <div className="flex-1">
            <div className="flex items-center justify-center sm:justify-start space-x-2">
              <div className="w-7 h-7 bg-blue-600 rounded flex items-center justify-center text-white font-bold text-sm">L</div>
              <span className="font-mono text-xs tracking-wider uppercase text-blue-600 font-semibold">
                Nội bộ · Tiện ích xử lý dữ liệu hệ thống
              </span>
            </div>
            <h1 className="text-2xl sm:text-3xl mt-2 font-bold tracking-tight text-slate-900">
              Sửa Cột Ngày Giờ & Phân Tích Log CSV
            </h1>
            <p className="text-slate-500 mt-1 max-w-2xl text-xs leading-relaxed">
              Tự động phát hiện lệch cột (thừa dấu phẩy), chuyển đổi chuỗi 14 chữ số ở cột Date sang định dạng tiêu chuẩn{" "}
              <code className="bg-slate-100 text-blue-700 border border-slate-200 px-1 py-0.5 rounded font-mono text-[11px]">
                YYYY-MM-DD HH:MM:SS
              </code>{" "}
              và phân tích sâu báo cáo cấu trúc bằng mô hình AI Gemini tiên tiến.
            </p>
          </div>

          {/* Health Badge */}
          <div className="flex sm:flex-col items-center sm:items-end justify-center gap-2">
            <span className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">Môi trường:</span>
            <div className="flex items-center gap-1.5 bg-slate-50 border border-slate-200 px-3 py-1.5 rounded-full">
              <span className={`w-2 h-2 rounded-full ${apiHealth?.aiConfigured ? "bg-emerald-500 animate-pulse" : "bg-amber-500"}`} />
              <span className="font-mono text-[11px] font-medium text-slate-600 uppercase tracking-tight">
                {apiHealth?.aiConfigured ? "API Connected" : "Chưa cài Key AI"}
              </span>
            </div>
          </div>
        </header>

        {/* Setup Parameters Panel */}
        <div className="bg-white rounded-lg border border-slate-200 custom-card-shadow p-6 mb-6">
          <div className="flex items-center gap-2 mb-4 border-b border-slate-100 pb-3">
            <Settings className="w-4 h-4 text-blue-600" />
            <h2 className="text-sm font-bold text-slate-800 uppercase tracking-wider">Cấu hình tham số xử lý & phân tích</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            {/* Target Column Name */}
            <div>
              <label htmlFor="date-col" className="block text-[11px] font-mono font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Tên cột chứa ngày giờ cần sửa
              </label>
              <div className="relative">
                <input
                  id="date-col"
                  type="text"
                  value={dateColName}
                  onChange={(e) => setDateColName(e.target.value)}
                  className="w-full font-mono text-xs border border-slate-200 rounded px-3 py-2 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600 transition-colors"
                  placeholder="Ví dụ: Date, Time, Timestamp"
                />
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5 leading-normal">
                Mặc định: "Date". Nếu không khớp, hệ thống tự động quét cột chứa chuỗi 14 chữ số để xử lý.
              </p>
            </div>

            {/* Timestamp input format */}
            <div>
              <label htmlFor="input-format" className="block text-[11px] font-mono font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Định dạng chuỗi ngày nguồn (14 số)
              </label>
              <select
                id="input-format"
                value={inFormat}
                onChange={(e) => setInFormat(e.target.value as "YMDHMS" | "DMYHMS")}
                className="w-full font-mono text-xs border border-slate-200 rounded px-3 py-2 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600 transition-colors text-slate-700"
              >
                <option value="YMDHMS">YYYYMMDDHHMMSS (Mặc định)</option>
                <option value="DMYHMS">DDMMYYYYHHMMSS (Đảo ngày trước)</option>
              </select>
              <p className="text-[10px] text-slate-400 mt-1.5 leading-normal">
                Xác định thứ tự ngày/tháng từ chuỗi số dính liền không ký tự phân tách.
              </p>
            </div>

            {/* Delimiter */}
            <div>
              <label htmlFor="delimiter" className="block text-[11px] font-mono font-semibold text-slate-400 uppercase tracking-wider mb-2">
                Kí tự phân tách dữ liệu gốc (CSV)
              </label>
              <select
                id="delimiter"
                value={delim}
                onChange={(e) => setDelim(e.target.value)}
                className="w-full font-mono text-xs border border-slate-200 rounded px-3 py-2 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600 transition-colors text-slate-700"
              >
                <option value=",">Dấu phẩy ( , )</option>
                <option value=";">Dấu chấm phẩy ( ; )</option>
                <option value="\t">Ký tự Tab</option>
              </select>
              <p className="text-[10px] text-slate-400 mt-1.5 leading-normal">
                Dấu hiệu nhận biết sự phân tách giữa các trường thông tin trong log gốc.
              </p>
            </div>
          </div>

          {/* Context Notes for Gemini Log Analysis */}
          <div className="mt-5 pt-4 border-t border-slate-100">
            <label htmlFor="user-notes" className="block text-[11px] font-mono font-semibold text-slate-400 uppercase tracking-wider mb-2 flex items-center gap-1">
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              Thông tin bổ sung gửi kèm cho AI (Phần cứng, thiết bị nghi ngờ, ca trực...)
            </label>
            <textarea
              id="user-notes"
              rows={2}
              value={userNotes}
              onChange={(e) => setUserNotes(e.target.value)}
              placeholder="Ví dụ: Lỗi thường xảy ra vào mốc 0h đêm chạy đồng bộ nền, hoặc log từ phân xưởng kiểm thử số 2..."
              className="w-full text-xs border border-slate-200 rounded px-3 py-2 bg-slate-50/50 focus:bg-white focus:outline-none focus:ring-1 focus:ring-blue-600 focus:border-blue-600 transition-colors"
            />
          </div>
        </div>

        {/* Drag & Drop Zone */}
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setIsDragOver(true);
          }}
          onDragLeave={() => setIsDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setIsDragOver(false);
            if (e.dataTransfer.files) {
              onFilesAdded(e.dataTransfer.files);
            }
          }}
          onClick={() => fileInputRef.current?.click()}
          className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-all duration-200 ${
            isDragOver
              ? "border-blue-600 bg-blue-50/30 scale-[1.005]"
              : "border-slate-300 hover:border-blue-600 bg-white"
          }`}
        >
          <input
            type="file"
            ref={fileInputRef}
            onChange={(e) => {
              if (e.target.files) {
                onFilesAdded(e.target.files);
              }
            }}
            accept=".csv"
            multiple
            className="hidden"
          />
          <div className="flex flex-col items-center">
            <div className="p-3 bg-blue-50 rounded-lg text-blue-600 mb-3 border border-blue-100">
              <UploadCloud className="w-6 h-6" />
            </div>
            <h3 className="text-sm font-semibold text-slate-800 mb-1">
              Kéo thả các file CSV vào đây, hoặc nhấn để duyệt tìm
            </h3>
            <p className="text-slate-400 text-xs max-w-md mt-1 leading-relaxed">
              Hỗ trợ tải lên nhiều tệp tin cùng một lúc. Mọi quá trình căn chỉnh cột thô và sửa ngày giờ đều được xử lý hoàn toàn trực tiếp trên trình duyệt máy khách của bạn, đảm bảo tính an toàn dữ liệu.
            </p>
          </div>
        </div>

        {/* File List Header & Bulk Toolbar */}
        {files.length > 0 && (
          <div className="mt-6">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4 bg-white border border-slate-200 rounded-lg p-4 shadow-xs">
              <div className="flex items-center gap-2">
                <FileSpreadsheet className="w-4 h-4 text-blue-600" />
                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Danh sách tệp tin ({files.length})
                </span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <button
                  onClick={handleProcessAll}
                  disabled={isProcessingAll}
                  className="bg-blue-600 text-white hover:bg-blue-700 font-mono text-xs px-3.5 py-1.5 rounded transition-colors flex items-center gap-1.5 font-medium shadow-xs disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${isProcessingAll ? "animate-spin" : ""}`} />
                  Xử lý hàng loạt
                </button>
                <button
                  onClick={handleDownloadAllZip}
                  disabled={files.every((f) => !f.result?.csvText)}
                  className="bg-slate-800 text-white hover:bg-slate-900 font-mono text-xs px-3.5 py-1.5 rounded transition-colors flex items-center gap-1.5 font-medium shadow-xs disabled:opacity-30"
                >
                  <FileArchive className="w-3 h-3" />
                  Tải cả bản ZIP
                </button>
                <button
                  onClick={handleClearAll}
                  className="border border-slate-200 hover:bg-red-50 text-red-600 font-mono text-xs px-3.5 py-1.5 rounded transition-colors flex items-center gap-1.5 font-medium bg-white"
                >
                  <Trash2 className="w-3 h-3" />
                  Xoá hết
                </button>
              </div>
            </div>

            {/* Individual File Items */}
            <div className="space-y-3">
              {files.map((file, idx) => {
                const status = file.result ? file.result.status : "pending";
                return (
                  <div
                    key={file.id}
                    className="bg-white border border-slate-200 rounded-lg custom-card-shadow overflow-hidden transition-all duration-200"
                  >
                    {/* Header Row of the File Panel */}
                    <div className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                      {/* Left: Name and Basic Info */}
                      <div className="flex items-start gap-3">
                        <div className={`p-2 rounded mt-0.5 border ${
                          status === "ok" ? "bg-emerald-50 text-emerald-700 border-emerald-100" :
                          status === "warn" ? "bg-amber-50 text-amber-700 border-amber-100" :
                          status === "err" ? "bg-rose-50 text-rose-700 border-rose-100" :
                          "bg-slate-50 text-slate-500 border-slate-200"
                        }`}>
                          <FileSpreadsheet className="w-4 h-4" />
                        </div>
                        <div>
                          <h4 className="font-mono text-xs font-semibold text-slate-800 break-all">{file.name}</h4>
                          <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-400 font-mono">
                            <span>Dung lượng: {(file.size / 1024).toFixed(1)} KB</span>
                            <span>•</span>
                            <span>Trạng thái: </span>
                            {status === "pending" && <span className="text-slate-500 font-semibold">Chờ xử lý</span>}
                            {status === "ok" && <span className="text-emerald-600 font-semibold uppercase tracking-tight">Thành công</span>}
                            {status === "warn" && <span className="text-amber-600 font-semibold uppercase tracking-tight">Đã sửa &amp; Cảnh báo</span>}
                            {status === "err" && <span className="text-rose-600 font-semibold uppercase tracking-tight">Lỗi</span>}
                          </div>
                        </div>
                      </div>

                      {/* Right: Actions */}
                      <div className="flex items-center gap-1.5 flex-wrap sm:justify-end">
                        {/* Auto Process indicator */}
                        {!file.result && (
                          <button
                            onClick={() => {
                              const res = processSingleFileText(file.rawText, dateColName);
                              setFiles((prev) => prev.map((f, i) => (i === idx ? { ...f, result: res } : f)));
                            }}
                            className="bg-blue-600 text-white hover:bg-blue-700 font-mono text-xs px-2.5 py-1.5 rounded transition-colors font-medium"
                          >
                            Xử lý tệp
                          </button>
                        )}

                        {file.result && (
                          <>
                            {/* Toggle Table Preview */}
                            <button
                              onClick={() => {
                                if (activeTableIdx === idx) {
                                  setActiveTableIdx(null);
                                } else {
                                  setActiveTableIdx(idx);
                                  setPreviewPage(1);
                                }
                              }}
                              className={`font-mono text-xs px-2.5 py-1.5 rounded transition-all flex items-center gap-1 border ${
                                activeTableIdx === idx
                                  ? "bg-slate-800 text-white border-slate-850"
                                  : "border-slate-200 text-slate-600 hover:bg-slate-50 bg-white"
                              }`}
                            >
                              {activeTableIdx === idx ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                              Xem bảng
                            </button>

                            {/* AI analysis trigger button */}
                            <button
                              onClick={() => handleAiAnalysis(idx)}
                              disabled={file.isAiLoading}
                              className="bg-slate-800 text-white hover:bg-slate-900 disabled:bg-slate-200 font-mono text-xs px-2.5 py-1.5 rounded transition-all flex items-center gap-1 border border-slate-900 font-medium"
                            >
                              <Sparkles className={`w-3 h-3 ${file.isAiLoading ? "animate-spin text-slate-300" : "text-blue-400"}`} />
                              Phân tích AI
                            </button>

                            {/* Download Single fixed CSV */}
                            <button
                              onClick={() => handleDownloadSingle(file)}
                              className="border border-slate-200 text-slate-600 hover:bg-slate-50 bg-white font-mono text-xs px-2.5 py-1.5 rounded transition-all flex items-center gap-1"
                            >
                              <Download className="w-3 h-3" />
                              Tải về
                            </button>
                          </>
                        )}

                        {/* Remove button */}
                        <button
                          onClick={() => handleRemoveFile(idx)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors"
                          title="Xoá tệp"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    {/* Notification message from single format action */}
                    {file.result && (
                      <div className={`px-4 pb-3 text-[11px] font-mono flex items-start gap-1.5 ${
                        status === "ok" ? "text-emerald-700" :
                        status === "warn" ? "text-amber-700" :
                        "text-rose-700"
                      }`}>
                        {status === "ok" ? (
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                        ) : status === "warn" ? (
                          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                        ) : (
                          <XCircle className="w-3.5 h-3.5 shrink-0" />
                        )}
                        <span>{file.result.message}</span>
                      </div>
                    )}

                    {/* Expandable Preview Table Panel */}
                    <AnimatePresence>
                      {activeTableIdx === idx && file.result && file.result.csvText && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          transition={{ duration: 0.15 }}
                          className="bg-slate-50 border-t border-slate-200 overflow-hidden"
                        >
                          <div className="p-4">
                            <div className="flex items-center justify-between mb-3">
                              <div className="flex items-center gap-1.5">
                                <FileCheck2 className="w-3.5 h-3.5 text-blue-600" />
                                <span className="font-mono text-xs font-semibold text-slate-700">
                                  Bản xem trước CSV ({previewData.total} dòng dữ liệu)
                                </span>
                              </div>
                              <span className="text-[10px] font-mono text-slate-400">
                                Hiển thị {previewRowsPerPage} dòng mỗi trang
                              </span>
                            </div>

                            {/* CSV Preview Table */}
                            <div className="border border-slate-200 rounded-lg bg-white overflow-x-auto shadow-xs">
                              <table className="w-full text-left border-collapse font-mono text-[11px]">
                                <thead>
                                  <tr className="bg-slate-800 text-slate-200">
                                    {previewData.headers.map((h, i) => (
                                      <th
                                        key={i}
                                        className={`px-3 py-2 font-medium tracking-wide ${
                                          h.toLowerCase() === dateColName.toLowerCase() ||
                                          h === file.result?.dateColName
                                            ? "bg-slate-900 text-blue-300 font-semibold border-x border-slate-700"
                                            : ""
                                        }`}
                                      >
                                        {h}
                                      </th>
                                    ))}
                                  </tr>
                                </thead>
                                <tbody>
                                  {previewData.rows.map((row, rIdx) => (
                                    <tr key={rIdx} className="border-t border-slate-100 hover:bg-slate-50/80">
                                      {previewData.headers.map((_, cIdx) => {
                                        const cellVal = row[cIdx] || "";
                                        const isDateCol = cIdx === file.result?.dateIdx;
                                        return (
                                          <td
                                            key={cIdx}
                                            className={`px-3 py-1.5 whitespace-nowrap ${
                                              isDateCol
                                                ? "bg-blue-50/30 text-blue-900 border-x border-blue-100/50 font-medium"
                                                : "text-slate-600"
                                            }`}
                                          >
                                            {cellVal}
                                          </td>
                                        );
                                      })}
                                    </tr>
                                  ))}
                                </tbody>
                              </table>
                            </div>

                            {/* Table Pagination */}
                            <div className="flex items-center justify-between mt-3 font-mono text-[11px] text-slate-400">
                              <span>
                                Trang {previewPage} / {Math.ceil(previewData.total / previewRowsPerPage)}
                              </span>
                              <div className="flex items-center gap-1">
                                <button
                                  onClick={() => setPreviewPage((p) => Math.max(1, p - 1))}
                                  disabled={previewPage === 1}
                                  className="p-1 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 disabled:opacity-40"
                                >
                                  <ChevronLeft className="w-3 h-3" />
                                </button>
                                <button
                                  onClick={() =>
                                    setPreviewPage((p) =>
                                      Math.min(Math.ceil(previewData.total / previewRowsPerPage), p + 1)
                                    )
                                  }
                                  disabled={previewPage >= Math.ceil(previewData.total / previewRowsPerPage)}
                                  className="p-1 rounded border border-slate-200 bg-white hover:bg-slate-100 text-slate-600 disabled:opacity-40"
                                >
                                  <ChevronRight className="w-3 h-3" />
                                </button>
                              </div>
                            </div>
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>

                    {/* AI Analysis Result Panel */}
                    <AnimatePresence>
                      {(file.isAiLoading || file.aiAnalysis || file.aiError) && (
                        <motion.div
                          initial={{ opacity: 0, height: 0 }}
                          animate={{ opacity: 1, height: "auto" }}
                          exit={{ opacity: 0, height: 0 }}
                          className="bg-slate-50/50 border-t border-slate-200"
                        >
                          <div className="p-5 sm:p-6 border-l-4 border-blue-600">
                            {/* Header label for AI */}
                            <div className="flex items-center justify-between mb-4 pb-2 border-b border-slate-200">
                              <div className="flex items-center gap-2">
                                <div className="p-1 bg-blue-50 text-blue-600 rounded">
                                  <Sparkles className="w-4 h-4 text-blue-600 animate-pulse" />
                                </div>
                                <span className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                                  Phân Tích & Chẩn Đoán Hệ Thống (Gemini AI Agent)
                                </span>
                              </div>
                              <span className="px-2 py-0.5 bg-red-100 text-red-700 text-[10px] font-bold rounded">
                                SYSTEM INCIDENT INSIGHTS
                              </span>
                            </div>

                            {/* Loading state */}
                            {file.isAiLoading && (
                              <div className="py-8 flex flex-col items-center justify-center text-center">
                                <RefreshCw className="w-6 h-6 text-blue-600 animate-spin mb-2" />
                                <h5 className="font-semibold text-slate-800 text-xs uppercase tracking-wider">
                                  AI đang quét & phân tích cấu trúc dữ liệu log...
                                </h5>
                                <p className="text-slate-400 text-[11px] mt-1 max-w-sm leading-normal font-mono">
                                  Bóc tách phân phối lỗi, trích lọc dòng bất thường, đưa ra giả thuyết và câu lệnh deep-dive. Vui lòng đợi trong giây lát...
                                </p>
                              </div>
                            )}

                            {/* Error state */}
                            {file.aiError && (
                              <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg text-rose-800 text-xs font-mono flex items-start gap-2">
                                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                                <div>
                                  <p className="font-semibold">Lỗi phân tích log:</p>
                                  <p className="mt-1">{file.aiError}</p>
                                </div>
                              </div>
                            )}

                            {/* Completed Result content */}
                            {file.aiAnalysis && (
                              <div className="prose prose-slate max-w-none">
                                <div className="bg-white border border-slate-200 rounded-lg p-5 sm:p-6 shadow-xs text-slate-700 leading-relaxed custom-card-shadow text-sm">
                                  {renderMarkdownText(file.aiAnalysis)}
                                </div>
                              </div>
                            )}
                          </div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Empty State Banner */}
        {files.length === 0 && (
          <div className="bg-white border border-slate-200 rounded-lg custom-card-shadow p-8 text-center mt-6">
            <div className="max-w-md mx-auto">
              <Info className="w-6 h-6 text-slate-400 mx-auto mb-3" />
              <h4 className="text-sm font-bold text-slate-800 uppercase tracking-wider mb-1">
                Chưa có tệp tin nào được tải lên
              </h4>
              <p className="text-slate-400 text-xs leading-relaxed">
                Hãy kéo thả một hoặc nhiều file CSV chứa nhật ký dữ liệu (log file) bị lệch cột hoặc chứa cột ngày giờ dạng 14 chữ số dính liền để bắt đầu trải nghiệm hệ thống phân tích.
              </p>
              <div className="mt-5 p-3.5 bg-slate-50 border border-slate-200 rounded-lg text-left text-xs text-slate-500 space-y-2 font-mono">
                <p className="font-semibold text-slate-600">💡 Mẹo định vị cấu trúc:</p>
                <p className="text-[11px] leading-relaxed">• Cột chứa ngày giờ mặc định có tiêu đề chứa từ "<b>Date</b>" (không phân biệt chữ hoa thường).</p>
                <p className="text-[11px] leading-relaxed">• Nếu log của bạn ghi ngày ở cột có tên khác (ví dụ: "<i>timestamp</i>", "<i>Ghi_Nhan</i>"), hãy khai báo tên ở cấu hình phía trên trước khi chọn tệp.</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
