'use strict';
/**
 * 多供应商 LLM 适配层 - 供应商 Profile 与配置解析
 * 统一 OpenAI 兼容协议：POST {baseUrl}/chat/completions
 * 配置优先级：环境变量 > providers.local.json > providers.json > 内置 profile
 */
const fs = require('fs');
const path = require('path');

const CONFIG_DIR = path.join(__dirname, '..', 'config');

// 内置供应商 profile
const BUILTIN_PROFILES = [
  {
    id: 'deepseek',
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com',
    apiKeyEnv: 'DEEPSEEK_API_KEY',
    defaultModel: 'deepseek-chat',
    models: ['deepseek-chat', 'deepseek-reasoner'],
    features: { tools: true, stream: true, vision: false },
    priority: 1,
  },
  {
    id: 'ark',
    name: '豆包（火山方舟）',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    apiKeyEnv: 'ARK_API_KEY',
    defaultModel: 'doubao-seed-1-6-250615',
    models: ['doubao-seed-1-6-250615', 'doubao-1-5-pro-32k-250115'],
    features: { tools: true, stream: true, vision: false },
    priority: 2,
  },
  {
    id: 'dashscope',
    name: '通义千问',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    apiKeyEnv: 'DASHSCOPE_API_KEY',
    defaultModel: 'qwen-plus',
    models: ['qwen-plus', 'qwen-turbo', 'qwen-max'],
    features: { tools: true, stream: true, vision: false },
    priority: 3,
  },
  {
    id: 'zhipu',
    name: '智谱 GLM',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    apiKeyEnv: 'ZHIPU_API_KEY',
    defaultModel: 'glm-4-plus',
    models: ['glm-4-plus', 'glm-4-air', 'glm-4-flash'],
    features: { tools: true, stream: true, vision: false },
    priority: 4,
  },
  {
    id: 'moonshot',
    name: 'Kimi（月之暗面）',
    baseUrl: 'https://api.moonshot.cn/v1',
    apiKeyEnv: 'MOONSHOT_API_KEY',
    defaultModel: 'moonshot-v1-8k',
    models: ['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    features: { tools: true, stream: true, vision: false },
    priority: 5,
  },
  {
    id: 'qianfan',
    name: '文心一言（千帆）',
    baseUrl: 'https://shturl.cc/nUC28fOISvNnYOV4UxEXB',
    apiKeyEnv: 'QIANFAN_API_KEY',
    defaultModel: 'ernie-4.0-8k',
    models: ['ernie-4.0-8k', 'ernie-3.5-8k'],
    features: { tools: true, stream: true, vision: false },
    priority: 6,
  },
  {
    id: 'minimax',
    name: 'MiniMax',
    baseUrl: 'https://api.minimax.chat/v1',
    apiKeyEnv: 'MINIMAX_API_KEY',
    defaultModel: 'MiniMaxText-01',
    models: ['MiniMaxText-01', 'abab6.5s-chat'],
    features: { tools: false, stream: true, vision: false },
    priority: 7,
  },
  {
    id: 'openai',
    name: 'OpenAI（可选）',
    baseUrl: 'https://api.openai.com/v1',
    apiKeyEnv: 'OPENAI_API_KEY',
    defaultModel: 'gpt-4o-mini',
    models: ['gpt-4o-mini', 'gpt-4o'],
    features: { tools: true, stream: true, vision: true },
    priority: 8,
  },
];

function readJsonSafe(file) {
  try {
    if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    console.warn('[providers] 配置文件解析失败:', path.basename(file), e.message);
  }
  return null;
}

/**
 * 加载并合并全部配置，输出带可用状态的供应商列表（不含明文 key）
 */
function loadProviders() {
  const providersJson = readJsonSafe(path.join(CONFIG_DIR, 'providers.json')) || {};
  const localJson = readJsonSafe(path.join(CONFIG_DIR, 'providers.local.json')) || { providers: {}, customs: [] };

  const overrides = providersJson.providers || {};
  const localOverrides = localJson.providers || {};
  const customs = localJson.customs || [];

  const map = new Map();

  // 内置
  for (const p of BUILTIN_PROFILES) {
    map.set(p.id, JSON.parse(JSON.stringify(p)));
  }

  // providers.json 覆盖（模型名等）
  for (const [id, cfg] of Object.entries(overrides)) {
    if (!map.has(id)) map.set(id, { id, name: id, features: { tools: false, stream: true, vision: false }, priority: 99 });
    applyOverride(map.get(id), cfg);
  }
  // local 覆盖
  for (const [id, cfg] of Object.entries(localOverrides)) {
    if (!map.has(id)) map.set(id, { id, name: id, features: { tools: false, stream: true, vision: false }, priority: 99 });
    applyOverride(map.get(id), cfg);
  }

  // 自定义中转站
  customs.forEach((c, idx) => {
    const id = c.id || `custom-${idx + 1}`;
    map.set(id, {
      id,
      name: c.name || '自定义中转站',
      baseUrl: c.baseUrl,
      apiKeyEnv: null,
      apiKeyInline: c.apiKey || null, // 仅后端内存，不回传
      defaultModel: c.model || 'gpt-4o-mini',
      models: c.models || [c.model || 'gpt-4o-mini'],
      features: Object.assign({ tools: true, stream: true, vision: false }, c.features || {}),
      priority: c.priority || 50 + idx,
      custom: true,
    });
  });

  // 解析 key 与可用状态
  const list = Array.from(map.values());
  for (const p of list) {
    p.resolvedKey = resolveKey(p, localOverrides, overrides);
    p.available = !!p.resolvedKey && !!p.baseUrl;
  }
  list.sort((a, b) => a.priority - b.priority);
  return list;
}

function applyOverride(target, cfg) {
  if (cfg.name) target.name = cfg.name;
  if (cfg.baseUrl) target.baseUrl = cfg.baseUrl;
  if (cfg.defaultModel) target.defaultModel = cfg.defaultModel;
  if (Array.isArray(cfg.models) && cfg.models.length) target.models = cfg.models;
  if (cfg.features) target.features = Object.assign(target.features || {}, cfg.features);
  if (typeof cfg.priority === 'number') target.priority = cfg.priority;
  if (cfg.apiKey) target.apiKeyInline = cfg.apiKey;
}

function resolveKey(p, localOverrides, overrides) {
  // 1. 内联（自定义/local/providers.json）
  if (p.apiKeyInline) return p.apiKeyInline;
  const loc = localOverrides[p.id];
  if (loc && loc.apiKey) return loc.apiKey;
  const ov = overrides[p.id];
  if (ov && ov.apiKey) return ov.apiKey;
  // 2. 环境变量
  if (p.apiKeyEnv && process.env[p.apiKeyEnv]) return process.env[p.apiKeyEnv];
  return null;
}

/** 返回给前端的安全视图（绝不含 key） */
function publicView(p) {
  return {
    id: p.id,
    name: p.name,
    keyConfigured: !!p.available,
    defaultModel: p.defaultModel,
    models: p.models || [p.defaultModel],
    features: p.features,
    priority: p.priority,
    custom: !!p.custom,
  };
}

function getPublicProviders() {
  return loadProviders().map(publicView);
}

function getProvider(id) {
  return loadProviders().find((p) => p.id === id) || null;
}

/** 按 priority 选首个可用供应商（failover 起点） */
function getAvailableOrdered(preferredId) {
  const all = loadProviders();
  const avail = all.filter((p) => p.available);
  if (preferredId) {
    const pref = avail.find((p) => p.id === preferredId);
    if (pref) return [pref, ...avail.filter((p) => p.id !== preferredId)];
  }
  return avail;
}

function maskKey(key) {
  if (!key) return '(none)';
  if (key.length <= 6) return 'sk-***';
  return key.slice(0, 3) + '***' + key.slice(-3);
}

function saveLocal(mutator) {
  const file = path.join(CONFIG_DIR, 'providers.local.json');
  const data = readJsonSafe(file) || { providers: {}, customs: [] };
  mutator(data);
  fs.writeFileSync(file, JSON.stringify(data, null, 2), { mode: 0o600 });
  try { fs.chmodSync(file, 0o600); } catch (e) {}
  return data;
}

module.exports = {
  BUILTIN_PROFILES,
  loadProviders,
  getPublicProviders,
  getProvider,
  getAvailableOrdered,
  publicView,
  maskKey,
  saveLocal,
};
