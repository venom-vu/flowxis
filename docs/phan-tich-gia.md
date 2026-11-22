# Phân tích giá các chức năng flowxis

> Nguồn: `apps/api/src/modules/wallet/tier.ts` (`PRICING_CONFIG`), `packages/contracts/src/tasks.ts`, `apps/api/src/modules/tasks/instance-pricing.ts`, `deploy/compose.coolify.yml`.
> Ngày phân tích: 2026-11-20. Giá phía server là nguồn sự thật duy nhất; client không gửi credit.

## 1. Bảng giá credit theo chức năng

| Chức năng (pipeline) | Cách tính | Giá credit | Ghi chú |
|---|---|---|---|
| Face Swap (`face_swap`) | Cố định | **100** | |
| Outfit Change (`outfit_change`) | Cố định | **100** | |
| Body Retouch (`body_retouch`) | Cố định | **100** | |
| Motion Control (`motion_control`) | 150 + 15 × giây | **225 – 450** | Trim 5–20 giây |
| Motion Control V2 (`motion_control_v2`) | 150 + 60 × giây | **450 – 1.050** | Trim 5–15 giây |
| Veo 3 720p (`veo3`) | Cố định / video 8s | **500** | Model `rhart-video-v3.1-pro` |
| Veo 3 1080p | Cố định / video 8s | **700** | |
| Veo 3 4K | Cố định / video 8s | **950** | |
| Muse Video (`muse_video`) | Cố định / video ~10s, 720p | **250** | Model `meta/muse-video/economy` |

### Chi tiết Motion Control (số giây → credit)

| Giây | Motion Control (150 + 15s) | Motion Control V2 (150 + 60s) |
|---|---|---|
| 5 | 225 | 450 |
| 8 | 270 | 630 |
| 10 | 300 | 750 |
| 15 | 375 | không hỗ trợ (tối đa 10s) |
| 20 | 450 | không hỗ trợ |

Cap thực tế = `min(giới hạn chức năng, maxVideoSeconds của Tier)`. Gói FREE bị khóa ở 5 giây.

## 2. Gói nạp và Tier

| Tier | Giá (VND) | Credit | Đơn giá VND/credit | Max video | Task đồng thời | Priority |
|---|---|---|---|---|---|---|
| FREE | 0 | 250 (tặng một lần) | – | 5s | 1 | 10 |
| Starter | 49.000 | 5.000 | 9,80 | 20s | 2 | 3 |
| Pro | 99.000 | 12.000 | 8,25 | 20s | 3 | 2 |
| Creator | 199.000 | 28.000 | 7,11 | 20s | 5 | 1 |

- Giữ Tier trả phí khi `balance + held >= 100` credit; dưới ngưỡng này về FREE.
- Priority số nhỏ chạy trước, cùng Priority thì FIFO. Task FREE bị gỡ và hoàn credit sau 15 phút chờ.

## 3. Giá quy đổi sang VND cho người dùng

Tính theo đơn giá từng gói (VND/credit làm tròn):

| Chức năng | Credit | Starter (9,80) | Pro (8,25) | Creator (7,11) |
|---|---|---|---|---|
| Face Swap / Outfit / Body Retouch | 100 | 980 | 825 | 711 |
| Muse Video | 250 | 2.450 | 2.063 | 1.778 |
| Motion Control 5s | 225 | 2.205 | 1.856 | 1.600 |
| Motion Control 10s | 300 | 2.940 | 2.475 | 2.133 |
| Motion Control 20s | 450 | 4.410 | 3.713 | 3.200 |
| Motion Control V2 5s | 450 | 4.410 | 3.713 | 3.200 |
| Motion Control V2 10s | 750 | 7.350 | 6.188 | 5.333 |
| Veo 3 720p | 500 | 4.900 | 4.125 | 3.555 |
| Veo 3 1080p | 700 | 6.860 | 5.775 | 4.977 |
| Veo 3 4K | 950 | 9.310 | 7.838 | 6.755 |

## 4. Số lượt dùng mỗi gói (ước tính)

| Chức năng | Starter (5.000) | Pro (12.000) | Creator (28.000) | FREE (250) |
|---|---|---|---|---|
| Face Swap / Outfit / Body Retouch | 50 | 120 | 280 | 2 |
| Muse Video | 20 | 48 | 112 | 1 |
| Motion Control 5s | 22 | 53 | 124 | 1 |
| Motion Control 10s | 16 | 40 | 93 | 0 (khóa 5s) |
| Motion Control V2 10s | 6 | 16 | 37 | 0 |
| Veo 3 720p | 10 | 24 | 56 | 0 |
| Veo 3 4K | 5 | 12 | 29 | 0 |

Credit tặng FREE (250) đủ cho 2 lượt ảnh hoặc 1 Motion Control 5s.

## 5. Chi phí vốn (GPU RunningHub)

Giá giờ theo loại máy (tài khoản Enterprise-Shared), tính `chi phí = giây × giá giờ / 3600`:

| Loại máy | USD/giờ | USD/phút |
|---|---|---|
| `default` | 0,88 | 0,0147 |
| `plus` | 1,18 | 0,0197 |
| `ultra` | 2,35 | 0,0392 |

- Mỗi chức năng workflow (Face Swap, Outfit Change, Body Retouch, Motion, Motion V2) đang cấu hình loại máy `default` qua biến `RUNNINGHUB_INSTANCE_*`.
- Veo 3 và Muse Video gọi theo model API của RunningHub, chi phí do RunningHub trả về (`costUsd`), không tính theo máy.
- Chi phí thực được ghi vào Task (`reported` nếu RunningHub trả `costUsd`, `estimated` nếu suy ra từ số giây), tổng hợp ở trang admin Stats (`gpuCostUsd`, `avgCostUsd`, `wastedCostUsd`).

**Chưa có trong mã nguồn:** tỷ giá USD→VND và chi phí vốn thực tế trên mỗi lượt của từng chức năng. Vì vậy chưa tính được biên lợi nhuận chính xác. Cần lấy `avgCostUsd` theo pipeline từ trang admin Stats (dữ liệu thật) để hoàn thiện mục này.

## 6. Quy tắc tiền (sổ cái)

- Tạo Task: HOLD toàn bộ giá, sổ cái append-only (`HOLD` −n, `RELEASED` +n, `CAPTURED` 0).
- Thành công: CAPTURED, tiền giữ chuyển thành doanh thu.
- Lỗi sau HOLD (`NO_POSE`, `NO_FACE`, `GPU_ERROR`, `GPU_TIMEOUT`, `CONTENT_BLOCKED`...), hủy hoặc hết hạn hàng đợi FREE: RELEASED 100%, không có trạng thái `rejected`.
- Backend đo lại độ dài video thật để tính giá Motion, không tin client.

## 7. Nhận xét

1. **Giá cố định ảnh (100 credit) là rẻ nhất**: 711–980 VND/lượt, phù hợp làm chức năng thu hút người dùng.
2. **Motion Control V2 đắt gấp 4 lần mỗi giây** so với bản thường (60 vs 15) và bị giới hạn 10s, nên 10s V2 (750) gấp 2,5 lần 10s thường (300). Nên đảm bảo UI giải thích khác biệt chất lượng.
3. **Veo 3 4K (950) gần gấp đôi 720p (500)**: mức tăng lũy tiến theo độ phân giải, cần đối chiếu với `costUsd` thực của model để chắc biên lợi nhuận không âm ở 4K.
4. **Muse Video (250) rẻ hơn nhiều so với Veo 3 (500+)** cho video 10s so với 8s; hợp lý nếu chi phí model economy thấp.
5. **Chiết khấu gói lớn**: Creator rẻ hơn Starter ~27% mỗi credit (7,11 vs 9,80), thúc đẩy nâng cấp. Tier cao còn có Priority và số task đồng thời tốt hơn.
6. **FREE rất hạn chế** (250 credit một lần, 5s, 1 task, Priority 10, hết hạn chờ 15 phút), đủ để thử nhưng không đủ để dùng thường xuyên.
7. **Rủi ro cần kiểm tra**: ngưỡng giữ Tier 100 credit bằng đúng giá 1 ảnh; credit còn dư ít vẫn giữ Tier cao một cách có chủ đích, nhưng nên theo dõi lạm dụng (nạp Creator rồi tiêu gần hết vẫn giữ Priority 1).
