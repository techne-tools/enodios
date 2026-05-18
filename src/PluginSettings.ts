export class PluginSettings {
  // Agent Identity
  public chatAgentName = 'Hermes';

  // Connection
  public connectionMode: 'acp' | 'api' = 'acp';

  // Context Behavior
  public contextEntireNote = false;

  // Conversation Persistence
  public chatSaveFolder = 'hermes';
  public conversationOrganization: 'flat' | 'by-date' | 'by-project' = 'flat';

  // API Configuration
  public hermesAgentName = 'hermes-agent';
  public hermesApiUrl = 'http://localhost:8642';

  // ACP Configuration
  public hermesBinaryPath = '';
  public mcpServersList = '';

  // Chat Display
  public showReasoning = false;
  public showToolUse = false;

  // Security
  public allowTerminal = false;

  // Audio / Haptic Feedback
  public enableTypingSound = false;
  public enableHapticFeedback = false;

  // Persona Templates
  public personaTemplates: Array<{ id: string; name: string; systemPrompt: string; defaultTools: string[] }> = [
    {
      id: 'default',
      name: 'Default',
      systemPrompt: '',
      defaultTools: []
    },
    {
      id: 'coding',
      name: 'Coding Assistant',
      systemPrompt: 'You are a senior software engineer. Provide concise, correct code. Prefer TypeScript. Explain trade-offs briefly.',
      defaultTools: ['readTextFile', 'writeTextFile', 'createTerminal']
    },
    {
      id: 'writing',
      name: 'Writing Coach',
      systemPrompt: 'You are an experienced editor and writing coach. Help refine prose, fix grammar, and suggest structural improvements.',
      defaultTools: ['readTextFile', 'writeTextFile']
    },
    {
      id: 'research',
      name: 'Research Assistant',
      systemPrompt: 'You are a research assistant. Synthesize information, cite sources when possible, and ask clarifying questions.',
      defaultTools: ['readTextFile', 'writeTextFile']
    }
  ];
  public activePersonaId = 'default';

  // Onboarding
  public hasSeenOnboarding = false;

  // Debug Mode — enables verbose console logging for troubleshooting
  public enableDebugMode = false;
}
