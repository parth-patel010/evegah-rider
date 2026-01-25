import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, Upload, RotateCcw } from "lucide-react";
import { useRiderForm } from "../useRiderForm";
import {
  getImageDataUrl,
  uploadCompressedImage,
  buildUploadedPhotoEntry,
  validateImageFile,
} from "./photoHelpers";

const bannerStyles = {
  info: "bg-blue-50 border-blue-200 text-blue-700",
  success: "bg-green-50 border-green-200 text-green-700",
  warning: "bg-yellow-50 border-yellow-200 text-yellow-700",
  error: "bg-red-50 border-red-200 text-red-700",
};

const describeCameraError = (error) => {
  const name = error?.name;
  if (name === "NotAllowedError" || name === "PermissionDeniedError") {
    return "Camera permission was denied. Please allow camera access in your browser settings and try again.";
  }
  if (name === "NotFoundError" || name === "DevicesNotFoundError") {
    return "No camera device was found. If you're on a PC without a webcam (or using Remote Desktop), upload a photo instead.";
  }
  if (name === "NotReadableError" || name === "TrackStartError") {
    return "Camera is already in use by another app/tab. Close other apps using the camera and try again.";
  }
  if (name === "OverconstrainedError") {
    return "Your camera doesn't support the requested settings. Trying a compatible mode may help.";
  }
  if (name === "SecurityError") {
    return "Camera access is blocked due to browser security settings.";
  }
  return error?.message || "Unable to access camera. Please allow permission.";
};

export default function Step4Photos() {
  const { formData, updateForm } = useRiderForm();
  const navigate = useNavigate();
  const riderPhotoInputRef = useRef(null);
  const preRidePhotosInputRef = useRef(null);
  const riderVideoRef = useRef(null);
  const riderStreamRef = useRef(null);
  const bannerTimeoutRef = useRef(null);

  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState("");
  const [facingMode, setFacingMode] = useState("user");
  const [banner, setBanner] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [attemptedNext, setAttemptedNext] = useState(false);

  useEffect(() => {
    if (!imagePreview?.src) return;
    const prevOverflow = document.body.style.overflow;
    const scrollY = window.scrollY;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevOverflow;
      window.scrollTo(0, scrollY);
    };
  }, [imagePreview?.src]);

  useEffect(() => {
    return () => {
      if (bannerTimeoutRef.current) {
        clearTimeout(bannerTimeoutRef.current);
      }
      if (riderStreamRef.current) {
        riderStreamRef.current.getTracks().forEach((t) => t.stop());
        riderStreamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!cameraActive) return;
    const video = riderVideoRef.current;
    const stream = riderStreamRef.current;
    if (!video || !stream) return;

    video.srcObject = stream;

    const handleLoadedMetadata = async () => {
      try {
        await video.play();
      } catch {
        // Some browsers might block play despite autoplay/muted restrictions.
      }
    };

    video.addEventListener("loadedmetadata", handleLoadedMetadata);
    return () => video.removeEventListener("loadedmetadata", handleLoadedMetadata);
  }, [cameraActive]);

  const showBanner = (type, message) => {
    if (bannerTimeoutRef.current) {
      clearTimeout(bannerTimeoutRef.current);
    }
    setBanner({ type, message });
    bannerTimeoutRef.current = setTimeout(() => setBanner(null), 4000);
  };

  const handleImagePick = async (kind, file) => {
    const validation = validateImageFile(file);
    if (validation) {
      showBanner("error", validation);
      return;
    }

    try {
      const { dataUrl, upload } = await uploadCompressedImage(file);
      const payload = buildUploadedPhotoEntry(file, dataUrl, upload);
      if (kind === "riderPhoto") {
        updateForm({ riderPhoto: payload });
        showBanner("success", "Rider photo uploaded.");
      }
    } catch (e) {
      showBanner("error", e?.message || "Unable to upload image");
    }
  };

  const handlePreRidePhotosPick = async (files) => {
    const list = Array.from(files || []);
    if (list.length === 0) return;

    const current = Array.isArray(formData.preRidePhotos)
      ? formData.preRidePhotos
      : [];
    const remainingSlots = Math.max(0, 8 - current.length);

    if (remainingSlots === 0) {
      showBanner("warning", "You can upload up to 8 pre-ride photos.");
      return;
    }

    const picked = list.slice(0, remainingSlots);

    try {
      const uploads = await Promise.all(
        picked.map(async (file) => {
          const validation = validateImageFile(file);
          if (validation) throw new Error(validation);
          const { dataUrl, upload } = await uploadCompressedImage(file);
          return buildUploadedPhotoEntry(file, dataUrl, upload);
        })
      );

      updateForm({ preRidePhotos: [...current, ...uploads] });
      showBanner("success", "Pre-ride photos uploaded.");
    } catch (e) {
      showBanner("error", e?.message || "Unable to upload pre-ride photos");
    }
  };

  const stopRiderCamera = () => {
    if (riderStreamRef.current) {
      riderStreamRef.current.getTracks().forEach((t) => t.stop());
      riderStreamRef.current = null;
    }
    if (riderVideoRef.current) {
      riderVideoRef.current.srcObject = null;
    }
    setCameraActive(false);
  };

  const startRiderCamera = async (targetFacingMode) => {
    setCameraError("");
    const host =
      typeof window !== "undefined" ? String(window.location?.hostname || "") : "";
    const isLoopbackHost =
      host === "localhost" || host === "127.0.0.1" || host === "::1";
    if (
      typeof window !== "undefined" &&
      window.isSecureContext === false &&
      !isLoopbackHost
    ) {
      setCameraError(
        "Camera requires HTTPS. Please open this site using https:// (or use localhost during development)."
      );
      return;
    }

    if (!navigator?.mediaDevices?.getUserMedia) {
      setCameraError("Camera is not supported in this browser.");
      return;
    }

    const desiredFacingMode = targetFacingMode || facingMode;
    setFacingMode(desiredFacingMode);

    try {
      stopRiderCamera();
      const tryGetStream = async (constraints) => navigator.mediaDevices.getUserMedia(constraints);
      const fallbackFacingMode = desiredFacingMode === "user" ? "environment" : "user";

      let stream;
      try {
        stream = await tryGetStream({ video: { facingMode: { ideal: desiredFacingMode } }, audio: false });
      } catch (firstError) {
        try {
          stream = await tryGetStream({ video: { facingMode: { ideal: fallbackFacingMode } }, audio: false });
        } catch (secondError) {
          try {
            stream = await tryGetStream({ video: true, audio: false });
          } catch (thirdError) {
            throw thirdError || secondError || firstError;
          }
        }
      }

      riderStreamRef.current = stream;
      setCameraActive(true);
      const trackFacingMode =
        stream?.getVideoTracks?.()?.[0]?.getSettings?.()?.facingMode;
      if (trackFacingMode) {
        setFacingMode(trackFacingMode);
      }
    } catch (e) {
      setCameraActive(false);
      setCameraError(describeCameraError(e));
    }
  };

  const handleFlipCamera = () => {
    const nextFacingMode = facingMode === "user" ? "environment" : "user";
    startRiderCamera(nextFacingMode);
  };

  const captureRiderPhoto = () => {
    const video = riderVideoRef.current;
    if (!video) return;

    const width = video.videoWidth || 640;
    const height = video.videoHeight || 480;
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, width, height);

    const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
    updateForm({
      riderPhoto: {
        name: `rider-photo-${Date.now()}.jpg`,
        type: "image/jpeg",
        size: null,
        dataUrl,
        updatedAt: new Date().toISOString(),
      },
    });
    showBanner("success", "Rider photo captured.");
    stopRiderCamera();
  };

  const nextFacingLabel = facingMode === "user" ? "rear-facing" : "front-facing";
  const videoStyle = cameraActive && facingMode === "user" ? { transform: "scaleX(-1)" } : undefined;
  const preRidePhotos = Array.isArray(formData.preRidePhotos) ? formData.preRidePhotos : [];

  const handleNext = () => {
    setAttemptedNext(true);
    if (!formData.riderPhoto) {
      showBanner("error", "Capture or upload the rider photo before continuing.");
      return;
    }
    navigate("../step-5");
  };

  return (
    <div className="space-y-5">
      {banner && (
        <div
          className={`rounded-xl border px-4 py-3 text-sm ${
            bannerStyles[banner.type] || bannerStyles.info
          }`}
        >
          {banner.message}
        </div>
      )}

      <div className="card space-y-6 mx-auto w-full max-w-5xl">
        <div>
          <h3 className="text-base font-semibold text-evegah-text">4. Rider + Vehicle Photos</h3>
          <p className="text-sm text-gray-500">
            Capture the rider and vehicle condition before handover.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-evegah-border bg-gray-50 p-4 space-y-2">
            <h3 className="font-medium text-evegah-text">Rider Photo</h3>
            <p className="text-sm text-gray-500">Take or upload a clear rider photo.</p>

            {getImageDataUrl(formData.riderPhoto) ? (
              <div className="mt-3 space-y-3">
                <div className="rounded-xl border border-evegah-border bg-white p-3">
                  <button
                    type="button"
                    className="block w-full"
                    onClick={() =>
                      setImagePreview({
                        src: getImageDataUrl(formData.riderPhoto),
                        title: "Rider Photo",
                      })
                    }
                    title="Open preview"
                  >
                    <img
                      src={getImageDataUrl(formData.riderPhoto)}
                      alt="Rider"
                      className="h-44 w-full rounded-lg object-cover"
                    />
                  </button>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className="btn-outline"
                    onClick={async () => {
                      updateForm({ riderPhoto: null });
                      await startRiderCamera();
                    }}
                  >
                    <Camera size={16} />
                    <span className="ml-2">Retake Photo</span>
                  </button>
                  <button
                    type="button"
                    className="btn-muted"
                    onClick={() => updateForm({ riderPhoto: null })}
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-evegah-border bg-white p-4">
                <input
                  ref={riderPhotoInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleImagePick("riderPhoto", file);
                    e.target.value = "";
                  }}
                />

                {cameraActive ? (
                  <div className="space-y-3">
                    <div className="relative">
                      <video
                        ref={riderVideoRef}
                        className="w-full rounded-lg border border-evegah-border bg-black/90"
                        style={videoStyle}
                        playsInline
                        muted
                        autoPlay
                      />
                      <button
                        type="button"
                        aria-label={`Flip to ${nextFacingLabel} camera`}
                        className="absolute top-3 right-3 h-10 w-10 rounded-full border border-white bg-white/90 shadow text-evegah-text flex items-center justify-center"
                        onClick={handleFlipCamera}
                      >
                        <RotateCcw size={18} />
                      </button>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <button type="button" className="btn-primary" onClick={captureRiderPhoto}>
                        <Camera size={16} />
                        <span className="ml-2">Capture Photo</span>
                      </button>
                      <button type="button" className="btn-muted" onClick={stopRiderCamera}>
                        Stop Camera
                      </button>
                    </div>
                  </div>
                ) : (
                  <div>
                    <div className="flex items-center gap-2 text-sm text-gray-600">
                      <Camera size={16} />
                      Take a live photo using the camera.
                    </div>

                    {cameraError ? (
                      <p className="text-xs text-red-600 mt-2">{cameraError}</p>
                    ) : null}

                    <div className="mt-3 flex flex-wrap gap-2">
                      <button type="button" className="btn-primary" onClick={startRiderCamera}>
                        <span className="ml-2">Start Camera</span>
                      </button>

                      <button
                        type="button"
                        className="btn-outline"
                        onClick={() => riderPhotoInputRef.current?.click()}
                      >
                        <Upload size={16} />
                        <span className="ml-2">Upload Photo</span>
                      </button>
                    </div>
                    <p className="text-xs text-gray-500">Allow camera permission when prompted.</p>
                  </div>
                )}
              </div>
            )}
            {attemptedNext && !formData.riderPhoto ? (
              <p className="text-xs text-red-600">Rider photo is required to proceed.</p>
            ) : null}
          </div>

          <div className="rounded-xl border border-evegah-border bg-gray-50 p-4 space-y-3">
            <h3 className="font-medium text-evegah-text">Pre-ride Photos (Upload)</h3>
            <p className="text-sm text-gray-500">
              Upload photos of the vehicle before handing over to the rider.
            </p>

            <input
              ref={preRidePhotosInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => {
                handlePreRidePhotosPick(e.target.files);
                e.target.value = "";
              }}
            />

            <button
              type="button"
              className="w-full border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-sm text-gray-500 p-5 hover:bg-gray-50 transition"
              onClick={() => preRidePhotosInputRef.current?.click()}
            >
              <Upload size={20} />
              <p className="mt-2 font-medium">
                {preRidePhotos.length > 0 ? "Add more photos" : "Click to upload photos"}
              </p>
              <p className="text-xs">PNG, JPG, WEBP (max 5MB each, up to 8)</p>
            </button>

            {preRidePhotos.length > 0 ? (
              <div className="grid grid-cols-4 gap-2">
                {preRidePhotos.slice(0, 8).map((p, idx) => (
                  <div
                    key={`${p?.name || "photo"}-${idx}`}
                    className="relative rounded-lg overflow-hidden border border-evegah-border bg-white"
                  >
                    <button
                      type="button"
                      className="block w-full"
                      onClick={() =>
                        setImagePreview({
                          src: getImageDataUrl(p),
                          title: "Pre-ride Photo",
                        })
                      }
                      title="Open preview"
                    >
                      <img
                        src={getImageDataUrl(p)}
                        alt="Pre-ride"
                        className="h-16 w-full object-cover"
                      />
                    </button>
                    <button
                      type="button"
                      className="absolute top-1 right-1 h-6 w-6 rounded-full border border-evegah-border bg-white/90 text-gray-700 hover:bg-white"
                      onClick={(e) => {
                        e.stopPropagation();
                        const next = [...preRidePhotos];
                        next.splice(idx, 1);
                        updateForm({ preRidePhotos: next });
                      }}
                      title="Remove"
                      aria-label="Remove photo"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-gray-500">No pre-ride photos uploaded yet.</p>
            )}
          </div>
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end border-t border-evegah-border pt-4">
          <button type="button" className="btn-outline" onClick={() => navigate("../step-3")}
          >
            ← Back
          </button>
          <button
            type="button"
            className="btn-primary"
            onClick={handleNext}
            disabled={!formData.riderPhoto}
          >
            Next →
          </button>
        </div>
      </div>

      {imagePreview?.src ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4"
          role="dialog"
          aria-modal="true"
          onClick={() => setImagePreview(null)}
        >
          <div
            className="w-full max-w-3xl overflow-hidden rounded-2xl border border-evegah-border bg-white shadow-card"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between gap-4 border-b border-evegah-border px-4 py-3">
              <div className="text-sm font-semibold text-evegah-text truncate">
                {imagePreview.title || "Preview"}
              </div>
              <button
                type="button"
                className="h-9 w-9 rounded-xl border border-evegah-border bg-white text-gray-600 hover:bg-gray-50"
                onClick={() => setImagePreview(null)}
                aria-label="Close preview"
              >
                ✕
              </button>
            </div>
            <div className="bg-black/5 p-3">
              <img
                src={imagePreview.src}
                alt={imagePreview.title || "Preview"}
                className="max-h-[75vh] w-full object-contain rounded-xl bg-white"
              />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
