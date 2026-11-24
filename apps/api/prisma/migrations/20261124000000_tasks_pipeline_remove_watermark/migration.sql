-- Xóa watermark/logo/phụ đề: cho phép pipeline remove_watermark (CHECK không khai báo được trong Prisma schema).
ALTER TABLE "tasks" DROP CONSTRAINT "tasks_pipeline_valid_chk";
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_pipeline_valid_chk" CHECK ("pipeline" IN ('face_swap', 'body_retouch', 'motion_control', 'outfit_change', 'motion_control_v2', 'veo3', 'muse_video', 'remove_watermark'));
