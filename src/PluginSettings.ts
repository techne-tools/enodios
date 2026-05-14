export class PluginSettings {
  /* eslint-disable no-magic-numbers -- In plugin settings magic numbers are allowed. */
  // Hermes Agent API Configuration
  public hermesApiUrl = 'http://localhost:8642';
  public hermesApiKey = '';
  public hermesAgentName = 'hermes-agent';
  
  // Context Selection
  public contextMode: 'editor' | 'selection' = 'editor';
  public contextAutoSelect = true;
  
  // Chat UI Settings
  public chatShowTitle = false;
  public chatShowTopic = true;
  public chatAutoScroll = true;
  public chatMarkdownRender = true;
  public chatAgentName = 'Hermes';

  /* eslint-enable no-magic-numbers -- In plugin settings magic numbers are allowed. */
}
