export class PluginSettings {
  public chatAgentName = 'Hermes';
  public chatAutoScroll = true;
  public chatMarkdownRender = true;

  // Chat UI Settings
  public chatShowTitle = false;
  public chatShowTopic = true;

  public connectionMode: 'acp' | 'api' = 'acp';
  public contextAutoSelect = true;
  // Context Selection
  public contextEntireNote = false; // Auto-add current note when it changes

  // Conversation Persistence
  public chatSaveFolder = 'hermes'; // Folder to save conversations to

  public hermesAgentName = 'hermes-agent';
  // Hermes Agent API Configuration
  public hermesApiUrl = 'http://localhost:8642';

  // ACP Configuration
  public hermesBinaryPath = '';

  // Visibility Toggles
  public showReasoning = false;
  public showToolUse = false;

  // Security
  public allowTerminal = false; // Terminal allows file edits that bypass diff approval
}
