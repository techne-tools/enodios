export class PluginSettings {
  public chatAgentName = 'Hermes';
  public chatAutoScroll = true;
  public chatMarkdownRender = true;

  // Chat UI Settings
  public chatShowTitle = false;
  public chatShowTopic = true;

  public contextAutoSelect = true;
  // Context Selection
  public contextEntireNote = false; // Auto-add current note when it changes
  public hermesAgentName = 'hermes-agent';
  public hermesApiKey = '';
  // Hermes Agent API Configuration
  public hermesApiUrl = 'http://localhost:8642';
}
