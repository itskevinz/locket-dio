const { instanceStorage } = require("../../libs");
const r2Storage = require("./r2Storage");

const deleteFileFromStorageR2 = async (filePath) => {
  try {
    if (!filePath) {
      return { success: true, skipped: true };
    }

    if (r2Storage.isConfigured()) {
      const result = await r2Storage.deleteObject(filePath);
      console.log(`✅ Deleted from own R2: ${filePath}`);
      return result;
    }

    // Backward-compatible fallback for installations that still use the old
    // locket-dio storage service and have not configured their own R2 yet.
    const body = {
      key: filePath,
    };

    const res = await instanceStorage.post("/api/delete", body);
    const data = res.data;

    if (data.success) {
      console.log(`✅ Deleted from legacy storage: ${filePath} | Message: ${data.message}`);
      return { success: true, message: data.message };
    }

    console.error(
      `❌ Delete failed (legacy storage): ${filePath}`,
      data.error || "Unknown error",
    );
    return { success: false, error: data.error || "Delete failed" };
  } catch (error) {
    console.error(`❌ Failed to delete media: ${filePath}`, error.message);
    return { success: false, error: error.message };
  }
};

module.exports = {
  deleteFileFromStorageR2,
};
