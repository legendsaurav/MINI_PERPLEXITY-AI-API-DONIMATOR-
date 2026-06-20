const { desktopCapturer } = require('electron');

/**
 * Screen Capture Module
 * Responsible for acquiring screenshots for vision context.
 */
class CaptureModule {
  /**
   * Captures the primary display
   * @returns {Promise<string>} base64 png string
   */
  async captureFullScreen() {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 1920, height: 1080 }
      });
      if (sources && sources.length > 0) {
        return sources[0].thumbnail.toDataURL();
      }
      return null;
    } catch (error) {
      console.error('Error capturing full screen:', error);
      return null;
    }
  }

  /**
   * Captures the active window
   * In MVP, we often just grab the full screen to ensure we don't miss context,
   * but this method allows for window-specific capture if needed.
   * @returns {Promise<string>} base64 png string
   */
  async captureActiveWindow() {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window'],
        thumbnailSize: { width: 1920, height: 1080 }
      });
      
      // Filter out our own overlay/input windows if needed
      const filteredSources = sources.filter(s => 
        !s.name.includes('Universal AI Copilot') && 
        !s.name.includes('desktop-ai-copilot')
      );

      if (filteredSources && filteredSources.length > 0) {
        // Just take the first window for now, or fall back to full screen
        // Native Win32 active window detection would be better here for post-MVP.
        return filteredSources[0].thumbnail.toDataURL();
      }
      
      // Fallback
      return this.captureFullScreen();
    } catch (error) {
      console.error('Error capturing active window:', error);
      return null;
    }
  }
}

module.exports = new CaptureModule();
