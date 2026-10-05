'use strict';
/**
 * 小维巡检助手 - System Prompt 与工具清单（function calling）
 */

const SYSTEM_PROMPT =
  '你是机房巡检助手小维，通过语音与运维人员对话并管理三维机房演示平台。' +
  '可用工具：前往机柜、查询状态、列出告警、获取处置建议、生成工单、模拟复测、切换页面。' +
  '规则：数据均为演示数据；告警信号不能直接确定故障根因；现场检查必须人工完成，禁止声称已远程修复；' +
  '派单不等于解决，告警保留到复测通过；回复用简短口语、适合语音播报、禁止 markdown 与符号、单次不超过 80 字；' +
  '需要用户决策时明确询问，不要替用户决定。';

// 工具清单（OpenAI function calling 格式）
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'go_to_rack',
      description: '让小维移动到指定机柜并打开设备详情，镜头跟随。用户要求前往/看看/去某个机柜时使用。',
      parameters: {
        type: 'object',
        properties: {
          rackId: { type: 'string', description: '机柜编号，如 A-02、D-07、E-05、C-05' },
        },
        required: ['rackId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_rack_status',
      description: '不移动，查询指定机柜的实时状态（温度、功率、负载、告警、维保）。',
      parameters: {
        type: 'object',
        properties: { rackId: { type: 'string' } },
        required: ['rackId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_alarms',
      description: '列出当前告警与统计，可按严重级别过滤。',
      parameters: {
        type: 'object',
        properties: {
          severity: { type: 'string', enum: ['严重', '一般', '提示', '全部'], description: '告警级别，默认全部' },
        },
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'get_rack_advice',
      description: '获取指定机柜告警的处置知识库建议。',
      parameters: {
        type: 'object',
        properties: { rackId: { type: 'string' } },
        required: ['rackId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'create_ticket',
      description: '为未确认告警创建运维工单并确认告警。',
      parameters: {
        type: 'object',
        properties: {
          rackId: { type: 'string' },
          assignee: { type: 'string', description: '负责人，默认自动分配张工/李工/王工' },
        },
        required: ['rackId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_retest',
      description: '现场处置完成后模拟复测，温度恢复正常则解除告警并归档工单。',
      parameters: {
        type: 'object',
        properties: { rackId: { type: 'string' } },
        required: ['rackId'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'navigate',
      description: '切换平台页面。',
      parameters: {
        type: 'object',
        properties: {
          page: {
            type: 'string',
            enum: ['总览', '机房监控', '资产管理', '能效管理', '告警中心', '运维工单'],
          },
        },
        required: ['page'],
      },
    },
  },
];

// 降级方案②：不支持 tools 时，把工具清单与 JSON 动作协议写入 system prompt
function buildPromptFallbackTools() {
  const toolLines = TOOLS.map((t) => {
    const f = t.function;
    const params = f.parameters.properties
      ? Object.keys(f.parameters.properties).join(', ')
      : '';
    return `- ${f.name}(${params})：${f.description}`;
  }).join('\n');

  return (
    SYSTEM_PROMPT +
    '\n\n你必须通过以下工具操作平台：\n' +
    toolLines +
    '\n\n当需要调用工具时，只输出一个 JSON 对象，不要输出其它内容，格式：\n' +
    '{"thought":"你的简短想法","actions":[{"tool":"go_to_rack","args":{"rackId":"A-02"}}]}\n' +
    '工具执行完成后，系统会把结果发给你，你再用简短口语回复（不超过80字，无符号无markdown）。'
  );
}

module.exports = { SYSTEM_PROMPT, TOOLS, buildPromptFallbackTools };
