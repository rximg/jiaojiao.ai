/**
 * 智谱图像编辑适配器占位：当前按产品需求仅实现通义 wan2.6-image 编辑接口
 */
import type { ImageEditAIConfig } from '#backend/domain/inference/types.js';
import { SyncInferenceBase } from '../../bases/sync-inference-base.js';
import type { EditImagePortInput } from '../../port-types.js';

export interface ZhipuEditImageOutput {
  imageUrl: string;
}

export class EditImageZhipuPort extends SyncInferenceBase<EditImagePortInput, ZhipuEditImageOutput> {
  constructor(_cfg: ImageEditAIConfig) {
    super();
  }

  protected async _execute(_input: EditImagePortInput): Promise<ZhipuEditImageOutput> {
    throw new Error('edit_image is not implemented for provider zhipu yet');
  }
}
