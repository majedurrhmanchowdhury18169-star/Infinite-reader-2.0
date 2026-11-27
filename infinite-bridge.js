// infinite-bridge.js - Native Entry, Auto-Open & Lifecycle Auto-Save Bridge
(function () {
  const getPlugin = () => window.Capacitor?.Plugins?.InfiniteReader || null;

  const InfiniteNative = {
    indexedFiles: [],
    isModified: false,
    currentEditingFile: null,

    // ১. এন্ট্রি ও ডিসকভারি: পারমিশন + MediaStore ইনডেক্সিং
    async initDiscovery() {
      const plugin = getPlugin();
      if (!plugin) return [];

      try {
        const perm = await plugin.checkStoragePermission();
        if (!perm.granted) {
          await plugin.requestStoragePermission();
        }
        const res = await plugin.queryMediaStoreDocuments();
        this.indexedFiles = res.files || [];
        window.dispatchEvent(
          new CustomEvent("infinite:mediastore-loaded", { detail: this.indexedFiles })
        );
        return this.indexedFiles;
      } catch (err) {
        console.error("MediaStore discovery error:", err);
        return [];
      }
    },

    // ১.২ বাহ্যিক পথ (Intent Filter): WhatsApp / File Manager থেকে আসা ফাইল ওপেন করা
    async checkIncomingIntent() {
      const plugin = getPlugin();
      if (!plugin) return;

      const handleIntentPayload = async (payload) => {
        if (!payload || !payload.uri) return;
        try {
          const fileData = await plugin.readContentUri({ uri: payload.uri });
          window.dispatchEvent(
            new CustomEvent("infinite:open-external-file", { detail: fileData })
          );
          if (typeof window.openFileInViewer === "function") {
            window.openFileInViewer(fileData);
          }
        } catch (err) {
          console.error("Failed to read intent URI:", err);
        }
      };

      try {
        const pending = await plugin.getPendingIntentFile();
        if (pending && pending.uri) {
          await handleIntentPayload(pending);
        }
        plugin.addListener("onExternalFileIntent", handleIntentPayload);
      } catch (err) {
        console.error("Intent listener error:", err);
      }
    },

    // ২. প্রসেসিং ও অটো-ওপেন লেয়ার: ব্যাকগ্রাউন্ড সেভ + onComplete(fileUri) + ইনস্ট্যান্ট নেভিগেশন
    async saveAndAutoOpen({ fileName, base64Data, mimeType, onCompleteOpen }) {
      const plugin = getPlugin();
      if (!plugin) {
        console.warn("Native plugin unavailable; running web fallback.");
        return null;
      }

      try {
        const result = await plugin.saveFileWithCallback({
          fileName,
          base64Data,
          mimeType: mimeType || "application/octet-stream"
        });

        // স্টোরেজ রাইট শেষ হলে onComplete(fileUri) কলব্যাক ও ইনস্ট্যান্ট ভিউয়ার ওপেন
        if (result && result.uri) {
          window.dispatchEvent(
            new CustomEvent("infinite:file-ready", { detail: result })
          );
          await this.initDiscovery();

          if (typeof onCompleteOpen === "function") {
            onCompleteOpen(result.uri, result);
          } else if (typeof window.openFileInViewer === "function") {
            window.openFileInViewer(result);
          }
        }
        return result;
      } catch (err) {
        console.error("Background save error:", err);
        throw err;
      }
    },

    // ৩. এডিটিং ও অটো-সেভ লেয়ার: Dirty Flag (isModified = true) সেট করা
    async markModified({ fileName, path, base64Data, mimeType }) {
      this.isModified = true;
      this.currentEditingFile = { fileName, path, base64Data, mimeType };

      const plugin = getPlugin();
      if (plugin) {
        await plugin.markModified({
          fileName,
          path: path || "",
          base64Data,
          mimeType: mimeType || "application/octet-stream"
        });
      }
    },

    async clearModified() {
      this.isModified = false;
      this.currentEditingFile = null;
      const plugin = getPlugin();
      if (plugin) {
        await plugin.clearModified();
      }
    }
  };

  window.InfiniteNative = InfiniteNative;

  document.addEventListener("DOMContentLoaded", async () => {
    const plugin = getPlugin();
    if (plugin) {
      plugin.addListener("onAutoSaveComplete", async (info) => {
        InfiniteNative.isModified = false;
        await InfiniteNative.initDiscovery();
        window.dispatchEvent(
          new CustomEvent("infinite:autosave-complete", { detail: info })
        );
      });
    }

    await InfiniteNative.initDiscovery();
    await InfiniteNative.checkIncomingIntent();
  });

  // Web fallback (যদি ব্রাউজারে টেস্ট করা হয়)
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && InfiniteNative.isModified) {
      const plugin = getPlugin();
      if (plugin) plugin.forceAutoSave();
    }
  });
})();
