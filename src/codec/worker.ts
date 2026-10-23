/// <reference lib="webworker" />
import { BudgetTooSmallError, encodeAtBudget, prepareImage, restoreResult, updateRegions } from './engine.ts';
import type { ImageModel } from './engine.ts';
import type { WorkerRequest, WorkerResponse } from './protocol.ts';

const context = globalThis as unknown as DedicatedWorkerGlobalScope;
let model: ImageModel | undefined;
function send(message: WorkerResponse): void { context.postMessage(message); }

context.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;
  try {
    if (request.type === 'init') {
      model = prepareImage(request.image, request.regions);
      send({ type: 'ready', frame: model.baseFrame, minimumBytes: model.minimumBytes, baseBytes: model.prepared.bytes.length, nonzeroAC: model.nonzeroAC });
    } else {
      if (!model) throw new Error('原图还未准备好，请重新加载。');
      updateRegions(model,request.regions);
      send({ type: 'progress', id: request.id, label: '计算同预算的均匀保留版本…' });
      const uniform = encodeAtBudget(model, request.budget, null);
      send({ type: 'progress', id: request.id, label: '按你的选择写出 JPEG，并重新解码…' });
      const current = request.restore?restoreResult(model,request.restore,request.budget,request.priority):request.priority === null ? uniform : encodeAtBudget(model, request.budget, request.priority);
      send({ type: 'result', id: request.id, comparison: { uniform, current } });
    }
  } catch (error) {
    send({ type: 'error', id: request.type === 'encode' ? request.id : undefined,
      message: error instanceof Error ? error.message : '图像处理失败。',
      minimumBytes: error instanceof BudgetTooSmallError ? error.minimumBytes : undefined });
  }
};
