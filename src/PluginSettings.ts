export class PluginSettings {
  public activePersonaId = 'default';

  // SECURITY: Auto-approve single-option permissions (default: disabled)
  // When enabled, permissions with exactly one "allow" option are approved
  // automatically without user review. This is a convenience feature that
  // reduces security — only enable if you completely trust the agent.
  public autoApproveSingleOptionPermissions = false;

  // Security
  public allowTerminal = false;

  // Agent Identity
  public chatAgentName = 'Hermes';

  // Conversation Persistence
  public chatSaveFolder = 'hermes';
  // Connection
  public connectionMode: 'acp' | 'api' = 'acp';

  // Academic & Citations Settings
  public bibliographyPath = 'references.bib';
  public citationStyle: 'apa' | 'mla' | 'chicago' | 'ieee' = 'apa';
  public autoExtractPdfAnnotations = false;

  // Feature Toggles
  public enableCitations = true;
  public enableAnnotations = true;
  public enableTags = true;

  // Core Plugin Integrations

  // Context Behavior
  public contextEntireNote = false;
  public conversationOrganization: 'by-date' | 'by-project' | 'flat' = 'flat';

  // Debug Mode — enables verbose console logging for troubleshooting
  public enableDebugMode = false;
  public enableHapticFeedback = false;

  // Audio / Haptic Feedback
  public enableTypingSound = false;
  // Onboarding
  public hasSeenOnboarding = false;
  // API Configuration
  public hermesAgentName = 'hermes-agent';

  public hermesApiUrl = 'http://localhost:8642';

  // ACP Configuration
  public hermesBinaryPath = '';
  public mcpServersEnabled = false;
  public mcpServersList = '';

  // Note Templates (Obsidian core Templates plugin)
  /** Override path for the Obsidian Templates folder. Leave empty to auto-detect. */
  public noteTemplatesFolder = '';

  // Persona Templates
  public personaTemplates: { defaultTools: string[]; id: string; name: string; systemPrompt: string }[] = [
    {
      defaultTools: [],
      id: 'default',
      name: 'Default',
      systemPrompt: ''
    },
    {
      defaultTools: ['read_file', 'write_file', 'terminal'],
      id: 'coding',
      name: 'Coding Assistant',
      systemPrompt: 'You are a senior software engineer. Provide concise, correct code. Prefer TypeScript. Explain trade-offs briefly.'
    },
    {
      defaultTools: ['read_file', 'write_file'],
      id: 'writing',
      name: 'Writing Coach',
      systemPrompt: 'You are an experienced editor and writing coach. Help refine prose, fix grammar, and suggest structural improvements.'
    },
    {
      defaultTools: ['read_file', 'write_file'],
      id: 'research',
      name: 'Research Assistant',
      systemPrompt: 'You are a research assistant. Synthesize information, cite sources when possible, and ask clarifying questions.'
    }
  ];

  // Chat Display
  public showReasoning = false;

  public showTokenCount = true;

  public showToolUse = false;

  public showPendingChangesInChat = false;
}
