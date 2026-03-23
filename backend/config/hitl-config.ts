/**
 * HITL (Human-in-the-Loop) Configuration
 * 定义哪些操作需要人工确认
 */

export interface HITLRule {
  actionType: string;
  enabled: boolean;
  priority: 'high' | 'medium' | 'low';
  requireApproval: boolean;
  autoApproveAfter?: number; // 自动批准的超时时间（毫秒）
  description?: string;
}

export interface HITLConfig {
  enabled: boolean;
  defaultRequireApproval: boolean;
  rules: HITLRule[];
  
  // 超时设置
  timeouts: {
    high: number;    // 高优先级等待时间（毫秒）
    medium: number;
    low: number;
  };
  
  // 通知设置
  notifications: {
    enabled: boolean;
    methods: ('desktop' | 'sound' | 'badge')[];
  };
}

/**
 * 默认 HITL 配置
 */
export const DEFAULT_HITL_CONFIG: HITLConfig = {
  enabled: true,
  defaultRequireApproval: false,
  
  rules: [
    // 文件系统操作
    {
      actionType: 'file.delete',
      enabled: true,
      priority: 'high',
      requireApproval: true,
      description: '删除文件需要确认',
    },
    {
      actionType: 'file.write',
      enabled: false,
      priority: 'low',
      requireApproval: false,
      description: '写入文件无需确认',
    },
    {
      actionType: 'file.execute',
      enabled: true,
      priority: 'high',
      requireApproval: true,
      description: '执行文件需要确认',
    },
    
    // 网络操作
    {
      actionType: 'network.http',
      enabled: true,
      priority: 'medium',
      requireApproval: true,
      description: 'HTTP 请求需要确认',
    },
    {
      actionType: 'network.websocket',
      enabled: true,
      priority: 'medium',
      requireApproval: true,
      description: 'WebSocket 连接需要确认',
    },
    
    // AI 生成操作（超时由前端倒计时控制，无后端自动继续）
    {
      actionType: 'ai.text2image',
      enabled: true,
      priority: 'low',
      requireApproval: true,
      description: '文本生成图片需要确认',
    },
    {
      actionType: 'ai.text2speech',
      enabled: true,
      priority: 'low',
      requireApproval: true,
      description: '文本转语音需要确认',
    },
    {
      actionType: 'ai.vl_script',
      enabled: true,
      priority: 'low',
      requireApproval: true,
      description: '以图生剧本需要确认',
    },
    {
      actionType: 'ai.image_label_order',
      enabled: true,
      priority: 'medium',
      requireApproval: true,
      description: '图片序号标注需确认（可移动、修改序号）',
    },
    {
      actionType: 'story.plan_review',
      enabled: true,
      priority: 'medium',
      requireApproval: true,
      description: '绘本故事策划稿确认需要人工确认',
    },
    
    // 系统操作
    {
      actionType: 'system.command',
      enabled: true,
      priority: 'high',
      requireApproval: true,
      description: '执行系统命令需要确认',
    },
    {
      actionType: 'system.package.install',
      enabled: true,
      priority: 'high',
      requireApproval: true,
      description: '安装软件包需要确认',
    },
    
    // 敏感数据操作
    {
      actionType: 'data.export',
      enabled: true,
      priority: 'high',
      requireApproval: true,
      description: '导出数据需要确认',
    },
    {
      actionType: 'data.delete_batch',
      enabled: true,
      priority: 'high',
      requireApproval: true,
      description: '批量删除数据需要确认',
    },
    {
      actionType: 'artifacts.delete',
      enabled: true,
      priority: 'high',
      requireApproval: true,
      description: '删除产物（图片/音频等）需确认',
    },
    // 通用批量工具执行器（一次确认，串行执行多项）
    {
      actionType: 'ai.batch_tool_call',
      enabled: true,
      priority: 'low',
      requireApproval: true,
      description: '批量执行工具需确认（一次确认后串行执行所有子任务）',
    },
  ],
  
  timeouts: {
    high: 300000,    // 5分钟
    medium: 120000,  // 2分钟
    low: 60000,      // 1分钟
  },
  
  notifications: {
    enabled: true,
    methods: ['desktop', 'sound', 'badge'],
  },
};

/**
 * 获取指定操作的 HITL 规则
 */
export function getHITLRule(actionType: string, config: HITLConfig = DEFAULT_HITL_CONFIG): HITLRule | undefined {
  return config.rules.find(rule => rule.actionType === actionType);
}

/**
 * 检查操作是否需要人工确认
 */
export function requiresApproval(actionType: string, config: HITLConfig = DEFAULT_HITL_CONFIG): boolean {
  if (!config.enabled) return false;
  
  const rule = getHITLRule(actionType, config);
  
  if (!rule) {
    return config.defaultRequireApproval;
  }
  
  return rule.enabled && rule.requireApproval;
}

/**
 * 获取操作的超时时间
 */
export function getTimeout(actionType: string, config: HITLConfig = DEFAULT_HITL_CONFIG): number {
  const rule = getHITLRule(actionType, config);
  
  if (!rule) {
    return config.timeouts.medium;
  }
  
  return config.timeouts[rule.priority];
}
