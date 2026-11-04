function analysisTransport(api) {
  const relay = api.activeRelay || api;
  return {
    ...api,
    baseUrl: relay.analysisBaseUrl || api.analysisBaseUrl || api.baseUrl,
    imageKey: relay.analysisKey || api.analysisKey || api.imageKey
  };
}

function analysisChannelError(error, model) {
  if (!/no available channel|model[_ -]not[_ -]found/i.test(String(error?.message || error))) return error;
  return new Error(`分析接口当前没有模型“${model}”的可用通道。请检查分析密钥的模型分组权限或中转站通道状态，或配置独立的分析 API 地址和密钥。模型列表中出现名称不代表当前密钥一定可调用；请在系统设置点击“测试分析接口”验证。`);
}

module.exports = { analysisTransport, analysisChannelError };
