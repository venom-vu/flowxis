import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  MuseVideoCreateRequestSchema,
  MuseVideoCreateResponseSchema,
  MUSE_VIDEO_ASPECT_RATIOS,
  MUSE_VIDEO_MAX_IMAGES,
  MUSE_VIDEO_MAX_TOTAL_BYTES,
  MUSE_VIDEO_PRICE,
  MUSE_VIDEO_PROMPT_MAX_LENGTH,
  TASK_PIPELINES,
} from '@flowxis/contracts';
import { PIPELINE_CONFIGS } from '../dist/modules/pipelines/pipeline-config.js';
import { buildMuseVideoRequest, museVideoInputKeys } from '../dist/modules/pipelines/muse-video.js';
import { PRICING_CONFIG } from '../dist/modules/wallet/tier.js';
import { TasksService } from '../dist/modules/tasks/tasks.service.js';

const key = (n) => `in/11111111-1111-4111-8111-111111111111/${String(n).padStart(8, '0')}-2222-4222-8222-222222222222`;
const KEYS = Array.from({ length: 10 }, (_, i) => key(i + 1));

describe('Muse Video: giá và hằng số hợp đồng', () => {
  it('giá cố định 250 credit, khớp cấu hình server', () => {
    assert.equal(MUSE_VIDEO_PRICE, 250);
    assert.equal(PRICING_CONFIG.pipelines.museVideoCredits, 250);
    assert.ok(TASK_PIPELINES.includes('muse_video'));
    assert.equal(MUSE_VIDEO_MAX_IMAGES, 9);
    assert.equal(MUSE_VIDEO_MAX_TOTAL_BYTES, 11 * 1024 * 1024);
    assert.equal(MUSE_VIDEO_PROMPT_MAX_LENGTH, 4000);
    assert.deepEqual([...MUSE_VIDEO_ASPECT_RATIOS], ['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3']);
  });
});

describe('Muse Video: schema request', () => {
  const ok = { prompt: 'Một người thợ da khâu chậm rãi', imageKeys: [KEYS[0]] };

  it('nhận 1-9 ảnh, aspectRatio tùy chọn', () => {
    assert.ok(MuseVideoCreateRequestSchema.safeParse(ok).success);
    assert.ok(MuseVideoCreateRequestSchema.safeParse({ ...ok, imageKeys: KEYS.slice(0, 9) }).success);
    for (const ar of MUSE_VIDEO_ASPECT_RATIOS) {
      assert.ok(MuseVideoCreateRequestSchema.safeParse({ ...ok, aspectRatio: ar }).success, ar);
    }
    const parsed = MuseVideoCreateRequestSchema.parse({ ...ok, prompt: '  a  ' });
    assert.equal(parsed.prompt, 'a');
    assert.ok(!('aspectRatio' in parsed));
  });

  it('từ chối prompt rỗng hoặc dài hơn 4000 ký tự', () => {
    assert.ok(!MuseVideoCreateRequestSchema.safeParse({ ...ok, prompt: '' }).success);
    assert.ok(!MuseVideoCreateRequestSchema.safeParse({ ...ok, prompt: '   ' }).success);
    assert.ok(!MuseVideoCreateRequestSchema.safeParse({ ...ok, prompt: 'x'.repeat(4001) }).success);
    assert.ok(MuseVideoCreateRequestSchema.safeParse({ ...ok, prompt: 'x'.repeat(4000) }).success);
  });

  it('từ chối 0 ảnh, hơn 9 ảnh, khóa trùng hoặc khóa sai định dạng', () => {
    assert.ok(!MuseVideoCreateRequestSchema.safeParse({ ...ok, imageKeys: [] }).success);
    assert.ok(!MuseVideoCreateRequestSchema.safeParse({ ...ok, imageKeys: KEYS }).success);
    assert.ok(!MuseVideoCreateRequestSchema.safeParse({ ...ok, imageKeys: [KEYS[0], KEYS[1], KEYS[0]] }).success);
    assert.ok(!MuseVideoCreateRequestSchema.safeParse({ ...ok, imageKeys: ['tmp/x'] }).success);
    assert.ok(!MuseVideoCreateRequestSchema.safeParse({ prompt: 'p' }).success);
  });

  it('từ chối tỉ lệ lạ và trường thừa (duration/resolution do server cố định)', () => {
    assert.ok(!MuseVideoCreateRequestSchema.safeParse({ ...ok, aspectRatio: '21:9' }).success);
    assert.ok(!MuseVideoCreateRequestSchema.safeParse({ ...ok, duration: '10' }).success);
    assert.ok(!MuseVideoCreateRequestSchema.safeParse({ ...ok, resolution: '720p' }).success);
    assert.ok(!MuseVideoCreateRequestSchema.safeParse({ ...ok, price: 1 }).success);
  });

  it('response bắt buộc price = creditCost', () => {
    const base = {
      id: '33333333-3333-4333-8333-333333333333',
      pipeline: 'muse_video',
      status: 'queued',
      reasonCode: null,
      queuePosition: 1,
      creditCost: 250,
      price: 250,
      createdAt: '2026-11-19T00:00:00.000Z',
      updatedAt: '2026-11-19T00:00:00.000Z',
    };
    assert.ok(MuseVideoCreateResponseSchema.safeParse(base).success);
    assert.ok(!MuseVideoCreateResponseSchema.safeParse({ ...base, price: 100 }).success);
    assert.ok(!MuseVideoCreateResponseSchema.safeParse({ ...base, pipeline: 'veo3' }).success);
  });
});

describe('Muse Video: dựng request RunningHub', () => {
  const params = { prompt: 'cinematic close-up', imageCount: 2, resolution: '720p', seconds: 10, price: 250 };
  const urls = { imageKey0: 'https://rh/a.png', imageKey1: 'https://rh/b.png' };

  it('cấu hình pipeline dùng chế độ model, không cần node', () => {
    const c = PIPELINE_CONFIGS.muse_video;
    assert.equal(c.runMode, 'model');
    assert.deepEqual(c.inputs, []);
    assert.equal(c.defaultWorkflowId, 'meta/muse-video/economy');
    assert.equal(c.workflowEnvVar, 'RUNNINGHUB_MUSE_VIDEO_MODEL');
    assert.equal(c.instanceEnvVar, 'RUNNINGHUB_INSTANCE_MUSE_VIDEO');
    assert.equal(c.deadlineMs, 600_000);
    assert.equal(typeof c.model.inputKeys, 'function');
  });

  it('museVideoInputKeys trả imageKey0..8 có mặt, theo thứ tự số', () => {
    const inputKeys = { imageKey2: KEYS[2], imageKey0: KEYS[0], imageKey10: KEYS[9], imageKey1: KEYS[1], other: KEYS[3] };
    assert.deepEqual(museVideoInputKeys({}, inputKeys), ['imageKey0', 'imageKey1', 'imageKey2']);
    assert.deepEqual(museVideoInputKeys({}, {}), []);
  });

  it('payload theo thứ tự ảnh, cố định duration/resolution/nsfwCheck, không có aspectRatio khi "Theo ảnh"', () => {
    const r = buildMuseVideoRequest('meta/muse-video/economy', params, urls);
    assert.equal(r.path, '/openapi/v2/meta/muse-video/economy');
    assert.deepEqual(r.payload, {
      prompt: 'cinematic close-up',
      imageUrls: ['https://rh/a.png', 'https://rh/b.png'],
      duration: '10',
      resolution: '720p',
      nsfwCheck: false,
    });
    assert.ok(!('aspectRatio' in r.payload));
  });

  it('gửi aspectRatio khi người dùng chọn', () => {
    const r = buildMuseVideoRequest('meta/muse-video/economy', { ...params, aspectRatio: '3:4' }, urls);
    assert.equal(r.payload.aspectRatio, '3:4');
  });

  it('bộ dựng của cấu hình cho cùng kết quả', () => {
    assert.deepEqual(
      PIPELINE_CONFIGS.muse_video.model.buildRequest('meta/muse-video/economy', params, urls),
      buildMuseVideoRequest('meta/muse-video/economy', params, urls),
    );
  });

  it('đường dẫn bỏ dấu / thừa ở đầu, cuối và giữa tên model', () => {
    assert.equal(buildMuseVideoRequest('/meta//muse-video/economy/', params, urls).path, '/openapi/v2/meta/muse-video/economy');
  });

  it('trả null khi thiếu URL ảnh hoặc tham số hỏng', () => {
    assert.equal(buildMuseVideoRequest('m', params, { imageKey0: 'https://rh/a.png' }), null);
    assert.equal(buildMuseVideoRequest('m', params, { imageKey1: 'https://rh/b.png' }), null);
    assert.equal(buildMuseVideoRequest('m', { ...params, imageCount: 0 }, {}), null);
    assert.equal(buildMuseVideoRequest('m', { prompt: 'p' }, {}), null);
    assert.equal(buildMuseVideoRequest('m', { ...params, prompt: 1 }, urls), null);
    assert.equal(buildMuseVideoRequest('m', { ...params, prompt: '' }, urls), null);
    assert.equal(buildMuseVideoRequest('m', { ...params, aspectRatio: '21:9' }, urls), null);
  });
});

describe('Muse Video: tạo Task kiểm tra ảnh trước khi HOLD', async () => {
  const { TasksService } = await import('../dist/modules/tasks/tasks.service.js');
  const req = { prompt: 'p', imageKeys: [KEYS[0], KEYS[1]], aspectRatio: '1:1' };

  function make(totalBytes) {
    const calls = [];
    const svc = Object.create(TasksService.prototype);
    svc.uploads = { getConfirmedImagesTotalBytes: async (userId, keys) => { calls.push(['bytes', userId, keys]); return totalBytes; } };
    svc.createPipelineTask = async (userId, spec) => { calls.push(['create', userId, spec]); return { id: 't', creditCost: spec.amount }; };
    return { svc, calls };
  }

  it('ảnh không thuộc user hoặc chưa xác nhận: VALIDATION_FAILED, không HOLD', async () => {
    const { svc, calls } = make(null);
    await assert.rejects(svc.createMuseVideo('u1', req), (e) => e.getResponse().code === 'VALIDATION_FAILED');
    assert.ok(!calls.some((c) => c[0] === 'create'));
  });

  it('tổng dung lượng > 11 MB: VALIDATION_FAILED nêu giới hạn, không HOLD', async () => {
    const { svc, calls } = make(MUSE_VIDEO_MAX_TOTAL_BYTES + 1);
    await assert.rejects(svc.createMuseVideo('u1', req), (e) => {
      const r = e.getResponse();
      return r.code === 'VALIDATION_FAILED' && r.message.includes('11 MB');
    });
    assert.ok(!calls.some((c) => c[0] === 'create'));
  });

  it('hợp lệ: giữ thứ tự ảnh qua imageKey0..N, giá 250, đánh dấu đã kiểm tra khóa', async () => {
    const { svc, calls } = make(MUSE_VIDEO_MAX_TOTAL_BYTES);
    const res = await svc.createMuseVideo('u1', req);
    assert.equal(res.price, 250);
    assert.equal(res.pipeline, 'muse_video');
    const [, , spec] = calls.find((c) => c[0] === 'create');
    assert.equal(spec.amount, 250);
    assert.equal(spec.keysVerified, true);
    assert.deepEqual(spec.inputKeys, { imageKey0: KEYS[0], imageKey1: KEYS[1] });
    assert.equal(spec.params.imageCount, 2);
    assert.equal(spec.params.aspectRatio, '1:1');
  });
});

describe('Muse Video: TasksService.createMuseVideo', () => {
  /** Dựng service với collaborator giả; ghi lại spec truyền cho createPipelineTask. */
  function makeService(totalBytes) {
    const calls = { bytes: [], specs: [] };
    const uploads = {
      getConfirmedImagesTotalBytes: async (userId, keys) => {
        calls.bytes.push({ userId, keys });
        return totalBytes;
      },
    };
    const svc = new TasksService({}, {}, uploads, {}, {}, {}, {}, {});
    svc.createPipelineTask = async (_userId, spec) => {
      calls.specs.push(spec);
      return { id: 't', pipeline: spec.pipeline, creditCost: spec.amount };
    };
    return { svc, calls };
  }
  const req = { prompt: 'cinematic', imageKeys: [KEYS[2], KEYS[0], KEYS[1]] };

  it('ảnh hợp lệ: giữ thứ tự imageKey0..n, giá 250, seconds = 10, không có aspectRatio khi theo ảnh', async () => {
    const { svc, calls } = makeService(5 * 1024 * 1024);
    const res = await svc.createMuseVideo('u1', req);
    assert.equal(calls.specs.length, 1);
    const spec = calls.specs[0];
    assert.equal(spec.pipeline, 'muse_video');
    assert.equal(spec.amount, 250);
    assert.equal(spec.keysVerified, true);
    assert.deepEqual(spec.inputKeys, { imageKey0: KEYS[2], imageKey1: KEYS[0], imageKey2: KEYS[1] });
    assert.equal(spec.params.seconds, 10);
    assert.equal(spec.params.imageCount, 3);
    assert.ok(!('aspectRatio' in spec.params));
    assert.equal(res.price, 250);
    assert.deepEqual(calls.bytes[0], { userId: 'u1', keys: req.imageKeys });
  });

  it('có aspectRatio thì lưu vào params', async () => {
    const { svc, calls } = makeService(100);
    await svc.createMuseVideo('u1', { ...req, aspectRatio: '9:16' });
    assert.equal(calls.specs[0].params.aspectRatio, '9:16');
  });

  it('ảnh không thuộc user/chưa confirm: VALIDATION_FAILED, không HOLD', async () => {
    const { svc, calls } = makeService(null);
    await assert.rejects(() => svc.createMuseVideo('u1', req), (e) => e.getResponse().code === 'VALIDATION_FAILED');
    assert.equal(calls.specs.length, 0);
  });

  it('tổng > 11 MB: VALIDATION_FAILED kèm thông báo 11 MB, không HOLD; đúng 11 MB thì được', async () => {
    const over = makeService(MUSE_VIDEO_MAX_TOTAL_BYTES + 1);
    await assert.rejects(
      () => over.svc.createMuseVideo('u1', req),
      (e) => e.getResponse().code === 'VALIDATION_FAILED' && /11 MB/.test(e.getResponse().message),
    );
    assert.equal(over.calls.specs.length, 0);
    const exact = makeService(MUSE_VIDEO_MAX_TOTAL_BYTES);
    await exact.svc.createMuseVideo('u1', req);
    assert.equal(exact.calls.specs.length, 1);
  });
});
