import express from "express";
import path from "path";
import dotenv from "dotenv";
import { createServer as createViteServer } from "vite";
import { GoogleGenAI } from "@google/genai";

dotenv.config();

// Initialize Gemini client with proper configuration
const apiKey = process.env.GEMINI_API_KEY;
const ai = apiKey
  ? new GoogleGenAI({
      apiKey,
      httpOptions: {
        headers: {
          "User-Agent": "aistudio-build",
        },
      },
    })
  : null;

const app = express();
const PORT = 3000;

// Middleware for body parsing with generous limits
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ limit: "50mb", extended: true }));

// API endpoints
app.get("/api/health", (req, res) => {
  res.json({ status: "ok", aiConfigured: !!ai });
});

// Log analysis endpoint with a highly refined and specific prompt
app.post("/api/analyze-log", async (req, res) => {
  try {
    const { fileName, summary, userNotes } = req.body;

    if (!summary) {
      return res.status(400).json({ error: "Thiếu dữ liệu tóm tắt của log để phân tích." });
    }

    if (!ai) {
      return res.status(500).json({
        error: "Gemini API Key chưa được cấu hình trên server. Vui lòng thêm GEMINI_API_KEY trong phần Settings > Secrets.",
      });
    }

    // Refined prompt targeting production log engineers for detailed, precise root-cause analysis
    const systemInstruction = `Bạn là một Chuyên gia phân tích dữ liệu log cấp cao và Kỹ sư Độ tin cậy Hệ thống (Senior Site Reliability & Quality Engineer) với chuyên môn sâu về chẩn đoán sự cố công nghiệp, phân tích chuỗi thời gian (time-series log) và xử lý dữ liệu ngoại lệ.
Nhiệm vụ của bạn là bóc tách thông tin từ tệp tóm tắt dữ liệu log đã được chuẩn hóa để tìm kiếm các mẫu lỗi (fault signatures), phân tích xu hướng bất thường, liên kết chặt chẽ với ghi chú vận hành từ người dùng để chẩn đoán nguyên nhân gốc rễ và đưa ra khuyến nghị khắc phục mang tính hành động cao.`;

    const prompt = `Hãy thực hiện một phân tích chuyên sâu, toàn diện và có tính kỹ thuật cao đối với dữ liệu nhật ký hệ thống (log data) từ tệp tin "${fileName || "chưa rõ tên"}".

Dưới đây là DỮ LIỆU TỔNG HỢP (CSV summary metrics) được tính toán từ tệp tin log đã chuẩn hóa cột thời gian:
\`\`\`json
${JSON.stringify(summary, null, 2)}
\`\`\`

${userNotes ? `Ghi chú ngữ cảnh vận hành và bối cảnh sự cố từ kỹ sư trực ca:\n"${userNotes}"` : "Không có ghi chú bổ sung nào từ người vận hành."}

Bạn hãy viết một BÁO CÁO CHẨN ĐOÁN KỸ THUẬT (Technical Diagnosis Report) bằng tiếng Việt cực kỳ chi tiết, mạch lạc, trực quan và chuyên nghiệp. Trình bày báo cáo theo cấu trúc Markdown chuẩn mực dưới đây:

### 📊 1. KHẢO SÁT & ĐÁNH GIÁ CHỈ SỐ HỆ THỐNG (SYSTEM METRICS BRIEF)
* **Tổng quan lưu lượng:** Tổng số bản ghi (records), khoảng thời gian ghi nhận dữ liệu (thời điểm bắt đầu và kết thúc từ \`date_range\`). Tính toán tần suất bản ghi trung bình (bản ghi/giờ hoặc bản ghi/ngày) dựa trên khung thời gian này.
* **Định lượng trạng thái vận hành:** Trích xuất các cột trạng thái (từ \`status_column_counts\`). Tính toán chi tiết tỉ lệ phần trăm lỗi (%) trên tổng số dòng cho từng trạng thái. 
* **Biểu đồ trực quan hóa lỗi:** Sử dụng biểu đồ tiến trình giả lập bằng ký tự unicode để trực quan hoá tỉ lệ lỗi (Ví dụ: \`[████░░░░░5] 40% lỗi\`). Thiết kế bảng dữ liệu so sánh trực quan giữa các trạng thái để dễ dàng theo dõi.

### 🔍 2. KHU TRÚ & PHÂN TÍCH QUY LUẬT BẤT THƯỜNG (ANOMALY PROFILE)
* **Tương quan chuỗi thời gian (Temporal Correlation):** Đánh giá số lượng bản ghi theo ngày (từ \`rows_per_day\`). Hãy chỉ ra ngày/giờ nào có sự đột biến (spike) về dữ liệu log hoặc lỗi. Liên hệ sự đột biến này với bối cảnh vận hành hoặc ghi chú của người dùng (ví dụ: ngày lễ, thời gian chạy backup nền, giờ giao ca, hoặc chu kỳ tải cao của hệ thống).
* **Mẫu chữ ký lỗi (Error Signatures):** Nghiên cứu sâu danh sách các dòng dữ liệu lỗi tiêu biểu trong \`sample_abnormal_rows\`. Chỉ ra các điểm chung kỹ thuật giữa chúng:
  - Có sự xuất hiện đồng thời của một dải mã lỗi hay không?
  - Lỗi có chỉ tập trung vào một nhóm thiết bị, một dải cảm biến, hay một tiến trình cụ thể nào không?
  - Phát hiện các bất thường về mặt logic (ví dụ: giá trị cảm biến vượt ngưỡng an toàn vật lý, trạng thái báo động trùng lặp).

### 💡 3. CHẨN ĐOÁN NGUYÊN NHÂN GỐC RỄ (ROOT CAUSE ANALYTICS)
Hãy xây dựng ít nhất **2 đến 3 giả thuyết kỹ thuật logic** để giải thích căn nguyên của sự cố dựa trên dữ liệu đã rà soát:
* **Giả thuyết 1 (Vật lý/Thiết bị):** Liên quan đến lỗi phần cứng, hao mòn cảm biến, trôi điểm không (calibration drift), quá nhiệt hoặc nhiễu điện thế vật lý.
* **Giả thuyết 2 (Hệ thống/Phần mềm):** Liên quan đến xung đột luồng xử lý (race conditions), lỗi tràn bộ đệm (buffer overflow), timeout giao thức kết nối, hoặc sai sót định dạng trong dữ liệu đầu vào.
* **Giả thuyết 3 (Vận hành/Môi trường):** Liên quan đến các yếu tố bên ngoài như sụt áp lưới điện, độ ẩm môi trường, hoặc thao tác thủ công không đúng quy trình của kỹ thuật viên trực ca.
* **Phân cấp mức độ nghiêm trọng:** Đánh giá mức độ rủi ro (Nghiêm trọng/Trung bình/Thấp) và khoanh vùng phạm vi ảnh hưởng (ảnh hưởng cục bộ một thiết bị hay đe dọa toàn bộ dây chuyền hoạt động).

### 🛠️ 4. CHƯƠNG TRÌNH HÀNH ĐỘNG KHẮC PHỤC (ACTIONABLE CONTROLS)
Đề xuất kế hoạch xử lý sự cố chia làm 3 giai đoạn rõ ràng:
1. **Khắc phục ứng cứu khẩn cấp (Emergency Mitigation):** Các bước nhanh chóng nhất để giảm thiểu tổn thất hoặc cô lập vùng lỗi ngay trong vòng 5-15 phút tới.
2. **Biện pháp ngăn ngừa trung và dài hạn (Preventative Controls):** Thiết kế lại logic xử lý lỗi trong phần mềm, lên lịch bảo dưỡng phòng ngừa (preventive maintenance), thiết lập cảnh báo chủ động (alarms threshold adjustment).
3. **Mã truy vấn đào sâu kỹ thuật (Deep-Dive Analytical Scripts):** Cung cấp 1-2 câu lệnh truy vấn SQL cụ thể hoặc câu lệnh Shell grep phù hợp với cấu trúc file CSV này để đội ngũ SRE có thể sử dụng trực tiếp để tiếp tục sàng lọc các dòng lỗi tương tự trong các tệp tin log khác.

*Yêu cầu về văn phong:* Diễn đạt ngắn gọn, khúc chiết, mang đậm tính kỹ thuật hệ thống thực tế và tuyệt đối không sáo rỗng. Tránh lạm dụng các từ ngữ mô tả chung chung không thể hành động. Sử dụng thuật ngữ kỹ thuật chuyên ngành chuẩn mực.`;

    const delay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

    // Robust multi-model failover with multi-pass retry strategy
    let text = "";
    const modelsToTry = ["gemini-3.5-flash", "gemini-3.1-flash-lite", "gemini-flash-latest"];
    let lastApiError: any = null;

    // Pass 1: Try each model immediately with no delay between different models.
    // If a model returns 503/UNAVAILABLE or other transient errors, we immediately move to the next model
    // as different models run on different server pools/quotas and are highly likely to be available.
    for (const modelName of modelsToTry) {
      try {
        console.log(`[Gemini API] Pass 1 - Attempting log analysis with model: ${modelName}`);
        const response = await ai.models.generateContent({
          model: modelName,
          contents: prompt,
          config: {
            systemInstruction,
            temperature: 0.25,
          },
        });

        if (response && response.text) {
          text = response.text;
          console.log(`[Gemini API] Successfully generated analysis report using model: ${modelName} on Pass 1`);
          break;
        }
      } catch (err: any) {
        lastApiError = err;
        console.warn(`[Gemini API] Pass 1 - Model ${modelName} returned error: ${err.message || JSON.stringify(err)}`);
      }
    }

    // Pass 2: If all models failed in Pass 1, wait 1500ms and try them one more time with a robust retry block
    if (!text) {
      console.log(`[Gemini API] Pass 1 failed for all models. Waiting 1500ms before starting Pass 2...`);
      await delay(1500);

      for (const modelName of modelsToTry) {
        try {
          console.log(`[Gemini API] Pass 2 - Attempting log analysis with model: ${modelName}`);
          const response = await ai.models.generateContent({
            model: modelName,
            contents: prompt,
            config: {
              systemInstruction,
              temperature: 0.25,
            },
          });

          if (response && response.text) {
            text = response.text;
            console.log(`[Gemini API] Successfully generated analysis report using model: ${modelName} on Pass 2`);
            break;
          }
        } catch (err: any) {
          lastApiError = err;
          console.warn(`[Gemini API] Pass 2 - Model ${modelName} returned error: ${err.message || JSON.stringify(err)}`);
        }
      }
    }

    if (!text) {
      throw new Error(
        `Không thể hoàn thành phân tích nhật ký bằng mô hình AI nào (tất cả các dịch vụ đều đang bận hoặc quá tải). Lỗi chi tiết: ${
          lastApiError?.message || JSON.stringify(lastApiError) || "Unknown API Error"
        }`
      );
    }

    res.json({ analysis: text });
  } catch (error: any) {
    console.error("Lỗi khi phân tích log bằng AI:", error);
    res.status(500).json({ error: error.message || "Đã xảy ra lỗi không xác định trên server." });
  }
});

// Configure serving static assets & Vite HMR only when NOT in Vercel Serverless Function runner.
// On Vercel, static files are automatically served from 'dist' directory via vercel.json.
if (!process.env.VERCEL) {
  async function startServer() {
    // Vite middleware for development
    if (process.env.NODE_ENV !== "production") {
      const vite = await createViteServer({
        server: { middlewareMode: true },
        appType: "spa",
      });
      app.use(vite.middlewares);
    } else {
      const distPath = path.join(process.cwd(), "dist");
      app.use(express.static(distPath));
      app.get("*", (req, res) => {
        res.sendFile(path.join(distPath, "index.html"));
      });
    }

    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server running on port ${PORT}`);
    });
  }

  startServer();
}

export default app;
