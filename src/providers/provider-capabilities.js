/**
 * Provider Capability Layer
 * Exposes feature support per provider so UI and logic can adapt gracefully.
 */
const CAPABILITIES = {
  chatgpt: {
    supportsStreaming: true,
    supportsImages: true,
    supportsVision: true,
    supportsProjects: true,
    supportsConversationRestore: true,
    supportsCurrentPageMode: true,
    baseUrl: 'https://chatgpt.com',
    loginUrl: 'https://chatgpt.com/auth/login',
    domains: ['chatgpt.com', 'openai.com']
  },
  gemini: {
    supportsStreaming: true,
    supportsImages: true,
    supportsVision: true,
    supportsProjects: true,
    supportsConversationRestore: true,
    supportsCurrentPageMode: true,
    baseUrl: 'https://gemini.google.com/app',
    loginUrl: 'https://gemini.google.com/',
    domains: ['gemini.google.com', 'google.com']
  },
  claude: {
    supportsStreaming: true,
    supportsImages: true,
    supportsVision: true,
    supportsProjects: true,
    supportsConversationRestore: true,
    supportsCurrentPageMode: true,
    baseUrl: 'https://claude.ai/new',
    loginUrl: 'https://claude.ai/login',
    domains: ['claude.ai']
  },
  kimi: {
    supportsStreaming: true,
    supportsImages: true,
    supportsVision: true,
    supportsProjects: true,
    supportsConversationRestore: true,
    supportsCurrentPageMode: true,
    baseUrl: 'https://kimi.com',
    loginUrl: 'https://kimi.com/login',
    domains: ['kimi.com', 'kimi.moonshot.cn', 'moonshot.cn', 'kimi.la']
  },
  deepseek: {
    supportsStreaming: true,
    supportsImages: false,
    supportsVision: false,
    supportsProjects: true,
    supportsConversationRestore: true,
    supportsCurrentPageMode: true,
    baseUrl: 'https://chat.deepseek.com',
    loginUrl: 'https://chat.deepseek.com/login',
    domains: ['deepseek.com']
  },
  googlesearch: {
    supportsStreaming: true,
    supportsImages: false,
    supportsVision: false,
    supportsProjects: true,
    supportsConversationRestore: true,
    supportsCurrentPageMode: true,
    baseUrl: 'https://www.google.com',
    loginUrl: 'https://www.google.com',
    domains: ['google.com']
  }
};

class ProviderCapabilities {
  getCapabilities(provider) {
    return CAPABILITIES[provider] || null;
  }

  hasCapability(provider, capability) {
    const caps = this.getCapabilities(provider);
    return caps ? !!caps[capability] : false;
  }
}

module.exports = new ProviderCapabilities();
