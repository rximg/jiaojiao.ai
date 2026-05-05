/**
 * 将步骤结果中的相对路径解析为绝对路径（基于 workspace root + sessionId）
 */
import path from 'path';
import { loadConfig } from '../../app-config.js';
import { getWorkspaceFilesystem } from '../../services/fs.js';

export type StepResultLike = { type: string; payload: { path?: string; [k: string]: unknown } };

function isAbsolutePath(p: string): boolean {
  const trimmed = p.trim();
  if (/^[A-Za-z]:[\\/]/.test(trimmed)) return true;
  // POSIX：仅在明显是系统绝对路径时认为 absolute，避免 "/foo.png" 这种“前导斜杠相对路径”误判
  if (trimmed.startsWith('/')) {
    return (
      trimmed.startsWith('/Users/') ||
      trimmed.startsWith('/home/') ||
      trimmed.startsWith('/var/') ||
      trimmed.startsWith('/Applications/') ||
      trimmed.startsWith('/tmp/')
    );
  }
  return false;
}

export async function resolveStepResultPaths<T extends StepResultLike>(
  sessionId: string | undefined,
  stepResults: T[]
): Promise<T[]> {
  if (!sessionId || stepResults.length === 0) return stepResults;
  try {
    const appConfig = await loadConfig();
    const outputPath = appConfig?.storage?.outputPath ?? './outputs';
    const workspaceFs = getWorkspaceFilesystem({ outputPath });
    const sessionRoot = path.join(workspaceFs.root, sessionId);
    return stepResults.map((sr) => {
      if (sr.payload?.path) {
        // 统一：把 "/foo.png" 视作相对路径（剥掉前导斜杠），再解析到 sessionRoot 下
        const raw = sr.payload.path;
        const normalized = raw.replace(/^[/\\]+/, '');
        if (!isAbsolutePath(raw)) {
          const abs = path.resolve(sessionRoot, normalized);
          return { ...sr, payload: { ...sr.payload, path: abs } };
        }
        // 即便是绝对路径，如果它是 "/foo.png" 这种被误判的形式，上面已通过 isAbsolutePath 规避；
        // 这里保留原样。
        return { ...sr, payload: { ...sr.payload, path: abs } };
      }
      return sr;
    });
  } catch {
    return stepResults;
  }
}
