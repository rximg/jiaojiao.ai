/**
 * DashScope multimodal-generation：从 output.choices[0].message.content 取首张图 URL。
 * T2I / image-edit 等适配器共用（仅 infrastructure）。
 */

export type DashScopeMultimodalContentPart = {
  type?: string;
  image?: string;
};

export type DashScopeChoicesRoot = {
  output?: {
    choices?: Array<{
      message?: { content?: DashScopeMultimodalContentPart[] };
    }>;
  };
};

export function extractFirstImageUrlFromDashScopeMessageContent(
  content: DashScopeMultimodalContentPart[] | undefined
): string | undefined {
  if (!Array.isArray(content)) return undefined;
  for (const item of content) {
    if (item?.image && (!item?.type || item.type === 'image')) {
      return item.image;
    }
  }
  return undefined;
}

/** 从 API JSON 根上的 `output.choices[0].message.content` 取第一张图 URL */
export function extractFirstImageUrlFromDashScopeChoicesRoot(
  data: DashScopeChoicesRoot | undefined
): string | undefined {
  return extractFirstImageUrlFromDashScopeMessageContent(
    data?.output?.choices?.[0]?.message?.content
  );
}
