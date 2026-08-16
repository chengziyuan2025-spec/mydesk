import { platform } from "../services/platform";

// Rust owns actual window lifetime. This map avoids duplicate open requests in one renderer.
const openedContainerWindows = new Map<string, true>();

export const appWindowStore = {
  async showContainerWindow(containerId: string): Promise<void> {
    openedContainerWindows.set(containerId, true);
    try {
      await platform.createContainerWindow(containerId);
    } catch (error) {
      openedContainerWindows.delete(containerId);
      throw error;
    }
  },

  async hideContainerWindow(containerId: string): Promise<void> {
    await platform.hideContainerWindow(containerId);
  },

  forgetContainerWindow(containerId: string): void {
    openedContainerWindows.delete(containerId);
  },
};
