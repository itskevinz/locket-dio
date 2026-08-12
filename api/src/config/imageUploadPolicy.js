const BYTES_PER_MB = 1024 * 1024;

// Users may select source photos up to 10 MB, but the normalized object sent
// to Locket/Firebase must stay inside this proven reliable output budget.
const LOCKET_IMAGE_OUTPUT_MAX_MB = 1;
const LOCKET_IMAGE_OUTPUT_MAX_BYTES =
  LOCKET_IMAGE_OUTPUT_MAX_MB * BYTES_PER_MB;

const assertLocketImageOutput = (buffer) => {
  const size = Buffer.isBuffer(buffer) ? buffer.length : 0;
  if (!size || size > LOCKET_IMAGE_OUTPUT_MAX_BYTES) {
    const error = new Error(
      `Normalized image is outside the safe Locket upload budget (${(
        size /
        BYTES_PER_MB
      ).toFixed(2)} MB > ${LOCKET_IMAGE_OUTPUT_MAX_MB} MB)`,
    );
    error.status = 422;
    error.code = "IMAGE_OUTPUT_BUDGET_EXCEEDED";
    error.fileSize = size;
    throw error;
  }
  return buffer;
};

module.exports = {
  LOCKET_IMAGE_OUTPUT_MAX_MB,
  LOCKET_IMAGE_OUTPUT_MAX_BYTES,
  assertLocketImageOutput,
};
