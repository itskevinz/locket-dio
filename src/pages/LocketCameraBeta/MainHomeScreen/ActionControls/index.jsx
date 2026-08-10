import React from "react";
import "./styles.css";
import UploadFile from "./CameraControls/UploadFile";
import CameraButton from "./CameraControls/CameraButton";
import CameraToggle from "./CameraControls/CameraToggle";

import SendButton from "./MediaControls/SendButton";
import DelButton from "./MediaControls/DelButton";
import OverlayButton from "./MediaControls/OverlayButton";
import DraftButton from "./MediaControls/DraftButton";
import SaveDraftActions from "@/components/MomentDraft/SaveDraftActions";
import { useMomentDraftStore, usePostStore } from "@/stores";

/**
 * Floating control pill — 3-column grid (1fr | auto | 1fr).
 * Center column is always true horizontal center of the bar.
 * Post-capture: SaveDraftActions only (no camera logic).
 */
const ActionControls = () => {
  const selectedFile = usePostStore((s) => s.selectedFile);
  const preview = usePostStore((s) => s.preview);
  const hasDraft = useMomentDraftStore((s) => s.hasDraft);
  const draftCount = useMomentDraftStore((s) => s.draftCount);

  const hasFile = !!(selectedFile || preview);
  const capturePending = Boolean(preview?.capturePending && !selectedFile);
  // Badge only — never blocked by restore modal (modal removed)
  const showDraftChip = !hasFile && (hasDraft || draftCount > 0);
  const pendingClass = capturePending ? "pointer-events-none opacity-55" : "";

  return (
    <div
      className="w-full flex flex-col items-center"
      data-action-controls="true"
      data-capture-pending={capturePending ? "true" : undefined}
    >
      {hasFile && !capturePending ? <SaveDraftActions /> : null}
      <div className="w-full flex justify-center px-2">
      <div
        className="cameraControlPill"
        data-camera-control-pill="true"
        data-action-bar="true"
        data-has-media={hasFile ? "true" : "false"}
      >
        {/* Left: library (+ draft)  |  delete after capture */}
        <div className="actionBarCol actionBarColLeft" data-action-left="true">
          <div
            className={`actionBarSlot ${!hasFile ? "is-active" : "is-idle"}`}
            aria-hidden={hasFile}
          >
            <UploadFile />
            {showDraftChip ? <DraftButton /> : null}
          </div>
          <div
            className={`actionBarSlot ${hasFile ? "is-active" : "is-idle"} ${pendingClass}`}
            aria-hidden={!hasFile}
          >
            <DelButton />
          </div>
        </div>

        {/* Center: shutter  |  send — grid auto column keeps true center */}
        <div
          className="actionBarCol actionBarColCenter"
          data-capture-center="true"
        >
          <div
            className={`actionBarSlot ${!hasFile ? "is-active" : "is-idle"}`}
            aria-hidden={hasFile}
          >
            <CameraButton />
          </div>
          <div
            className={`actionBarSlot ${hasFile ? "is-active" : "is-idle"}`}
            aria-hidden={!hasFile}
          >
            <SendButton />
          </div>
        </div>

        {/* Right: flip  |  effects after capture */}
        <div className="actionBarCol actionBarColRight" data-action-right="true">
          <div
            className={`actionBarSlot ${!hasFile ? "is-active" : "is-idle"}`}
            aria-hidden={hasFile}
          >
            <CameraToggle />
          </div>
          <div
            className={`actionBarSlot ${hasFile ? "is-active" : "is-idle"} ${pendingClass}`}
            aria-hidden={!hasFile}
          >
            <OverlayButton />
          </div>
        </div>
      </div>
      </div>
    </div>
  );
};

export default ActionControls;
