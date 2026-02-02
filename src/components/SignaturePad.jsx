import SignatureCanvas from "react-signature-canvas";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export default function SignaturePad({ value, onChange, height = 180 }) {
  const sigRef = useRef(null);
  const containerRef = useRef(null);
  const canvasWrapRef = useRef(null);
  const [width, setWidth] = useState(700);
  const [saveError, setSaveError] = useState("");
  const [savedNote, setSavedNote] = useState("");
  const lastValueRef = useRef(undefined);

  useLayoutEffect(() => {
    const el = canvasWrapRef.current;
    if (!el) return;

    const measure = () => {
      const next = Math.max(260, Math.floor(el.clientWidth));
      setWidth(next);
    };

    measure();

    const ro = new ResizeObserver(() => measure());
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (!sigRef.current) return;
    if (lastValueRef.current === value) return;
    lastValueRef.current = value;

    if (!value) {
      // Only clear when parent explicitly sets value to null/empty after previously having a value.
      sigRef.current.clear();
      return;
    }

    try {
      sigRef.current.fromDataURL(value);
    } catch {
      // ignore invalid data urls
    }
  }, [value]);

  const handleClear = () => {
    sigRef.current?.clear();
    setSaveError("");
    setSavedNote("");
    onChange?.(null);
  };

  const handleSave = () => {
    if (!sigRef.current) return;
    if (sigRef.current.isEmpty()) {
      setSaveError("Please provide a signature first.");
      setSavedNote("");
      return;
    }
    setSaveError("");
    const dataUrl = sigRef.current.toDataURL("image/png");
    onChange?.(dataUrl);
    setSavedNote("Signature saved.");
  };

  const handleBegin = () => {
    if (savedNote) {
      setSavedNote("");
    }
    setSaveError("");
  };

  return (
    <div ref={containerRef} className="w-full">
      <div
        ref={canvasWrapRef}
        className="w-full overflow-hidden rounded-xl border border-evegah-border bg-gray-50"
      >
        <SignatureCanvas
          ref={sigRef}
          penColor="black"
          canvasProps={
            {
              width,
              height,
              className: "block bg-gray-50",
            }
          }
          onBegin={handleBegin}
        />
      </div>

      {saveError ? <p className="error mt-2">{saveError}</p> : null}
      {savedNote ? <p className="text-sm text-emerald-600 mt-2">{savedNote}</p> : null}

      <div className="mt-3 flex items-center gap-3">
        <button type="button" onClick={handleSave} className="btn-outline">
          Save
        </button>
        <button type="button" onClick={handleClear} className="btn-muted text-red-600">
          Clear
        </button>
      </div>
    </div>
  );
}
