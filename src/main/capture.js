const { desktopCapturer, screen } = require('electron');

/**
 * Screen Capture Module
 * Responsible for acquiring screenshots for vision context.
 */
class CaptureModule {
  /**
   * Captures the primary display or crops it to the active window coordinates.
   * @returns {Promise<string>} base64 png string (or null)
   */
  async captureFullScreen() {
    const detailed = await this.captureFullScreenDetailed();
    return detailed ? detailed.dataURL : null;
  }

  /**
   * Like captureFullScreen() but also returns the DELIVERED image dimensions
   * and the index of the display that was captured. The dimensions are read
   * back from the produced nativeImage (getSize) so that coordinate mapping for
   * the [POINT:x,y] guider stays correct regardless of display DPI/scaling.
   * @returns {Promise<{dataURL:string, width:number, height:number, displayIndex:number}|null>}
   */
  async captureFullScreenDetailed() {
    try {
      // 1. Get active context window bounds if available
      const contextDetector = require('./context-detector');
      const activeCtx = contextDetector.getCurrentContext();
      
      let boundsToUse = null;
      if (activeCtx && activeCtx.bounds) {
        const { left, top, right, bottom } = activeCtx.bounds;
        const w = right - left;
        const h = bottom - top;
        // Check for minimized windows (bounds at -32000 on Windows)
        if (w > 10 && h > 10 && left > -10000 && top > -10000) {
          boundsToUse = { left, top, width: w, height: h };
        }
      }

      // 2. Determine display to capture
      const displays = screen.getAllDisplays();
      let targetDisplayIndex = 0;
      let targetDisplay = displays[0];

      if (boundsToUse) {
        const cx = boundsToUse.left + boundsToUse.width / 2;
        const cy = boundsToUse.top + boundsToUse.height / 2;
        for (let i = 0; i < displays.length; i++) {
          const d = displays[i];
          if (cx >= d.bounds.x && cx <= d.bounds.x + d.bounds.width &&
              cy >= d.bounds.y && cy <= d.bounds.y + d.bounds.height) {
            targetDisplayIndex = i;
            targetDisplay = d;
            break;
          }
        }
      }

      // 3. Fetch sources for screens
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: targetDisplay.bounds.width, height: targetDisplay.bounds.height }
      });

      if (!sources || sources.length === 0) {
        return null;
      }

      // Find best source (fallback to targetDisplayIndex)
      const source = sources[targetDisplayIndex] || sources[0];
      const thumbnail = source.thumbnail;

      // 4. Crop image if bounds are valid (disabled to always return full display screenshot)
      /*
      if (boundsToUse) {
        const localX = boundsToUse.left - targetDisplay.bounds.x;
        const localY = boundsToUse.top - targetDisplay.bounds.y;
        
        const cropRect = {
          x: Math.max(0, Math.round(localX)),
          y: Math.max(0, Math.round(localY)),
          width: Math.min(Math.round(boundsToUse.width), targetDisplay.bounds.width - Math.max(0, Math.round(localX))),
          height: Math.min(Math.round(boundsToUse.height), targetDisplay.bounds.height - Math.max(0, Math.round(localY)))
        };

        if (cropRect.width > 10 && cropRect.height > 10) {
          console.log(`[Capture] Cropping monitor ${targetDisplayIndex} to active window bounds:`, cropRect);
          try {
            const cropped = thumbnail.crop(cropRect);
            return cropped.toDataURL();
          } catch (cropError) {
            console.error('[Capture] Crop operation failed, falling back to full monitor capture:', cropError);
          }
        }
      }
      */

      console.log(`[Capture] Capturing full monitor screen index: ${targetDisplayIndex}`);
      const size = thumbnail.getSize();
      return {
        dataURL: thumbnail.toDataURL(),
        width: size.width,
        height: size.height,
        displayIndex: targetDisplayIndex,
      };
    } catch (error) {
      console.error('Error capturing screen:', error);
      return null;
    }
  }

  /**
   * Captures the active window. Relies on bounds detection.
   * @returns {Promise<string>} base64 png string
   */
  async captureActiveWindow() {
    // Rely on smart bounds detection in captureFullScreen
    return this.captureFullScreen();
  }
}

module.exports = new CaptureModule();
