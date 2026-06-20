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
    loginUrl: 'https://chatgpt.com/auth/login'
  },
  gemini: {
    supportsStreaming: true,
    supportsImages: true,
    supportsVision: true,
    supportsProjects: true,
    supportsConversationRestore: true,
    supportsCurrentPageMode: true,
    baseUrl: 'https://gemini.google.com/app',
    loginUrl: 'https://gemini.google.com/'
  },
  claude: {
    supportsStreaming: true,
    supportsImages: true,
    supportsVision: true,
    supportsProjects: true,
    supportsConversationRestore: true,
    supportsCurrentPageMode: true,
    baseUrl: 'https://claude.ai/new',
    loginUrl: 'https://claude.ai/login'
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
