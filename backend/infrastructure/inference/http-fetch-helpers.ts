/**
 * fetch Response 错误处理（仅 inference 适配器使用，勿被 domain 引用）
 */

export async function readResponseErrorText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return '';
  }
}

/**
 * 非 2xx 时读取 body 并抛出带前缀的错误（与各处手写 `!res.ok` + `text().catch` 语义一致）
 */
export async function throwIfResponseNotOk(res: Response, label: string): Promise<void> {
  if (res.ok) return;
  const text = await readResponseErrorText(res);
  const suffix = text.trim() ? ` ${text}` : '';
  throw new Error(`${label}: ${res.status} ${res.statusText}${suffix}`.trim());
}
