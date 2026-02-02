// Helper to calculate age from DOB
function calculateAge(dob) {
  if (!dob) return "";
  const birthDate = new Date(dob);
  if (isNaN(birthDate)) return "";
  const today = new Date();
  let age = today.getFullYear() - birthDate.getFullYear();
  const m = today.getMonth() - birthDate.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < birthDate.getDate())) {
    age--;
  }
  return age;
}
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Upload } from "lucide-react";
import { lookupRider } from "../../../utils/riderLookup";
import { useRiderForm } from "../useRiderForm";
import { apiFetch, apiFetchBlob } from "../../../config/api";
import {
  getImageDataUrl,
  uploadCompressedImage,
  buildUploadedPhotoEntry,
  validateImageFile,
} from "./photoHelpers";

const sanitizeNumericInput = (value, maxLength) =>
  String(value || "").replace(/\D/g, "").slice(0, maxLength);

const isValidPhoneNumber = (value) => String(value || "").length === 10;

const isValidAadhaarNumber = (value) => String(value || "").length === 12;

const formatAadhaarDisplay = (value) => {
  const digits = sanitizeNumericInput(value, 12);
  if (!digits) return "";
  return digits.replace(/(\d{4})(?=\d)/g, "$1-");
};

const bannerStyles = {
  info: "bg-blue-50 border-blue-200 text-blue-700",
  success: "bg-green-50 border-green-200 text-green-700",
  warning: "bg-yellow-50 border-yellow-200 text-yellow-700",
  error: "bg-red-50 border-red-200 text-red-700",
};

// Add helper to format dob to dd-mm-yyyy
function formatDobToDDMMYYYY(dob) {
  if (!dob) return "";
  const d = new Date(dob);
  if (isNaN(d)) return dob;
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

export default function Step1RiderDetails() {
  const { formData, updateForm, errors, setErrors, saveDraft } =
    useRiderForm();
  const navigate = useNavigate();

  const governmentIdInputRef = useRef(null);

  const [aadhaarStatus, setAadhaarStatus] = useState(
    formData.aadhaarVerified ? "verified" : "idle"
  );
  const [aadhaarMessage, setAadhaarMessage] = useState(
    formData.aadhaarVerified ? "Aadhaar already verified." : ""
  );
  const [pendingAadhaar, setPendingAadhaar] = useState("");
  const [banner, setBanner] = useState(null);
  const [existingRiderMatch, setExistingRiderMatch] = useState(null);
  const [imagePreview, setImagePreview] = useState(null);
  const [digilocker, setDigilocker] = useState({
    enabled: false,
    loading: true,
    error: "",
    verifying: false,
  });
  const [digilockerDoc, setDigilockerDoc] = useState(null);
  const digilockerFlowRef = useRef({ completed: false });
  const bannerTimeoutRef = useRef(null);
  const tempAddressCache = useRef(
    formData.sameAddress ? "" : formData.temporaryAddress || ""
  );

  useEffect(() => {
    let mounted = true;
    apiFetch("/api/digilocker/status")
      .then((data) => {
        if (!mounted) return;
        setDigilocker((prev) => ({
          ...prev,
          enabled: Boolean(data?.enabled),
          loading: false,
          error: "",
        }));
      })
      .catch((e) => {
        if (!mounted) return;
        setDigilocker((prev) => ({
          ...prev,
          enabled: false,
          loading: false,
          error: String(e?.message || ""),
        }));
      });
    return () => {
      mounted = false;
    };
  }, []);

  useEffect(() => {
    const onMessage = (event) => {
      // Callback page runs on the API origin (often different from the web origin in dev).
      const apiBase = String(
        import.meta.env.VITE_API_BASE_URL || import.meta.env.VITE_API_URL || ""
      ).trim();

      let apiOrigin = "";
      try {
        if (apiBase) apiOrigin = new URL(apiBase, window.location.origin).origin;
      } catch {
        apiOrigin = "";
      }

      const allowedOrigins = new Set([window.location.origin, apiOrigin].filter(Boolean));
      if (!allowedOrigins.has(event.origin)) return;
      const payload = event.data;
      if (!payload || payload.type !== "DIGILOCKER_RESULT") return;

      digilockerFlowRef.current.completed = true;

      setDigilocker((prev) => ({ ...prev, verifying: false }));

      if (!payload.ok) {
        updateForm({ aadhaarVerified: false });
        setAadhaarStatus("idle");
        setAadhaarMessage("");
        setDigilockerDoc(null);
        showBanner("error", payload.error || "DigiLocker verification failed.");
        return;
      }

      const data = payload.data || {};
      const docId = String(data.document_id || "").trim();
      setDigilockerDoc(
        docId
          ? {
              id: docId,
              name: String(data.document_name || "digilocker_document"),
              mime: String(data.document_mime || ""),
            }
          : null
      );
      const aadhaarDigits = String(data.aadhaar || "").replace(/\D/g, "");
      const aadhaarLast4 = String(data.aadhaar_last4 || "").replace(/\D/g, "").slice(-4);

      const currentAadhaarDigits = sanitizeNumericInput(formData.aadhaar, 12);
      const digilockerFields = {
        ...(formData.name ? {} : data.name ? { name: String(data.name) } : {}),
        ...(formData.phone ? {} : data.mobile ? { phone: sanitizeNumericInput(data.mobile, 10) } : {}),
        ...(formData.dob ? {} : data.dob ? { dob: formatDobToDDMMYYYY(data.dob) } : {}),
        ...(formData.gender ? {} : data.gender ? { gender: String(data.gender) } : {}),
        ...(formData.permanentAddress
          ? {}
          : data.permanent_address
            ? { permanentAddress: String(data.permanent_address) }
            : {}),
        ...(formData.sameAddress && !formData.temporaryAddress && data.permanent_address
          ? { temporaryAddress: String(data.permanent_address) }
          : {}),
        // If you want to store the raw image, set governmentId here if present
        ...(data.document_image ? { governmentId: data.document_image } : {}),
      };
      if (aadhaarDigits && aadhaarDigits.length === 12) {
        updateForm({
          aadhaar: aadhaarDigits,
          aadhaarVerified: true,
          ...digilockerFields,
        });
      } else {
        if (currentAadhaarDigits && aadhaarLast4 && currentAadhaarDigits.slice(-4) !== aadhaarLast4) {
          updateForm({ aadhaarVerified: false });
          showBanner("error", "DigiLocker Aadhaar does not match the entered number (last 4 digits mismatch).");
          return;
        }
        updateForm({
          aadhaarVerified: true,
          ...digilockerFields,
        });
      }

      clearFieldError("aadhaar");
      setAadhaarStatus("verified");
      setAadhaarMessage("Aadhaar verified successfully via DigiLocker.");
      showBanner("success", "Aadhaar verified via DigiLocker.");
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [
    formData.aadhaar,
    formData.name,
    formData.dob,
    formData.gender,
    updateForm,
    clearFieldError,
    showBanner,
  ]);

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
    };
  }, []);

  function showBanner(type, message) {
    if (bannerTimeoutRef.current) {
      clearTimeout(bannerTimeoutRef.current);
    }

    setBanner({ type, message });
    bannerTimeoutRef.current = setTimeout(() => setBanner(null), 4000);
  }

  function clearFieldError(field) {
    if (!errors[field]) return;
    setErrors((prev) => {
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  const handleImagePick = async (file) => {
    const validation = validateImageFile(file);
    if (validation) {
      showBanner("error", validation);
      return;
    }

    try {
      const { dataUrl, upload } = await uploadCompressedImage(file);
      const payload = buildUploadedPhotoEntry(file, dataUrl, upload);

      updateForm({ governmentId: payload });
      clearFieldError("aadhaar");
      showBanner("success", "ID photo saved.");
    } catch (e) {
      showBanner("error", e?.message || "Unable to upload image");
    }
  };

  const handleRetainLookup = async ({ phone, aadhaar } = {}) => {
    const lookupPhone = phone ?? formData.phone;
    const lookupAadhaar = aadhaar ?? formData.aadhaar;

    if (!lookupPhone && !lookupAadhaar) {
      setExistingRiderMatch(null);
      return;
    }

    try {
      const rider = await lookupRider({
        phone: lookupPhone,
        aadhaar: lookupAadhaar,
      });

      if (rider) {
        setExistingRiderMatch(rider);
        setErrors((prev) => ({
          ...prev,
          phone: "Rider already registered. Use Retain Rider form.",
          aadhaar: "Rider already registered. Use Retain Rider form.",
        }));
        showBanner(
          "error",
          "Rider already registered. New Rider form is blocked."
        );
        return;
      }

      setExistingRiderMatch(null);
    } catch (e) {
      setExistingRiderMatch(null);
    }
  };

  const handleDigiLockerVerify = async () => {
    setDigilocker((prev) => ({ ...prev, verifying: true }));
    digilockerFlowRef.current.completed = false;
    setDigilockerDoc(null);
    try {
      const aadhaarDigits = sanitizeNumericInput(formData.aadhaar, 12);
      const resp = await apiFetch("/api/digilocker/auth-url", {
        method: "POST",
        body: { aadhaar: aadhaarDigits },
      });

      const url = String(resp?.url || "");
      if (!url) throw new Error("DigiLocker auth URL not returned");

      const w = 520;
      const h = 720;
      const left = Math.max(0, Math.floor(window.screenX + (window.outerWidth - w) / 2));
      const top = Math.max(0, Math.floor(window.screenY + (window.outerHeight - h) / 2));
      const features = `popup=yes,width=${w},height=${h},left=${left},top=${top}`;

      const popup = window.open(url, "digilocker_oauth", features);
      if (!popup) {
        throw new Error("Popup blocked. Please allow popups and try again.");
      }

      // We are now waiting for the callback to postMessage.
      setDigilocker((prev) => ({ ...prev, verifying: false }));
      setAadhaarStatus("awaiting-otp");
      setAadhaarMessage("Complete DigiLocker login in the popup to verify Aadhaar.");
      clearFieldError("aadhaar");

      const startedAt = Date.now();
      const timer = window.setInterval(() => {
        // Give it a reasonable window; OAuth can take time.
        const elapsed = Date.now() - startedAt;
        if (elapsed > 5 * 60 * 1000) {
          window.clearInterval(timer);
          if (!digilockerFlowRef.current.completed) {
            setAadhaarStatus("idle");
            setAadhaarMessage("");
          }
          return;
        }
        if (popup.closed) {
          window.clearInterval(timer);
          if (!digilockerFlowRef.current.completed) {
            setAadhaarStatus("idle");
            setAadhaarMessage("DigiLocker verification cancelled.");
          }
        }
      }, 500);
    } catch (e) {
      setDigilocker((prev) => ({ ...prev, verifying: false }));
      const message = String(e?.message || e || "Unable to start DigiLocker verification");
      showBanner("error", message);
    }
  };

  const handleDownloadDigiLockerDocument = async () => {
    if (!digilockerDoc?.id) return;
    try {
      const { blob, contentType } = await apiFetchBlob(
        `/api/digilocker/document/${encodeURIComponent(digilockerDoc.id)}`,
        { method: "GET" }
      );

      const inferExt = () => {
        const mime = String(digilockerDoc.mime || contentType || "").toLowerCase();
        if (mime.includes("pdf")) return ".pdf";
        if (mime.includes("xml")) return ".xml";
        if (mime.includes("json")) return ".json";
        if (mime.includes("text")) return ".txt";
        return "";
      };

      let filename = String(digilockerDoc.name || "digilocker_document").trim() || "digilocker_document";
      if (!/\.[a-z0-9]{2,6}$/i.test(filename)) filename += inferExt();

      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(url), 1000);

      // Endpoint is one-time; clear after success.
      setDigilockerDoc(null);
      showBanner("success", "Downloaded DigiLocker document.");
    } catch (e) {
      const msg = String(e?.message || e || "Failed to download DigiLocker document");
      showBanner("error", msg);
    }
  };

  const handleSaveDraft = async () => {
    if (!formData.name && !formData.phone && !formData.aadhaar) {
      showBanner("warning", "Add rider details before saving a draft.");
      return;
    }

    try {
      await saveDraft({ stepLabel: "Rider Details", stepPath: "step-1" });
      showBanner(
        "success",
        "Draft saved. You can resume anytime from the dashboard."
      );
    } catch (error) {
      const detail = String(error?.message || "").trim();
      showBanner(
        "error",
        detail
          ? `Unable to save draft: ${detail}`
          : "Unable to save draft. Check local API/Postgres connection."
      );
    }
  };

  const handleNext = () => {
    if (existingRiderMatch) {
      setErrors((prev) => ({
        ...prev,
        phone: "Rider already registered. Use Retain Rider form.",
        aadhaar: "Rider already registered. Use Retain Rider form.",
      }));
      showBanner("error", "Rider already registered. Please use Retain Rider form.");
      return;
    }

    const nextErrors = {};

    const trimmedName = formData.name.trim();
    const phoneDigits = sanitizeNumericInput(formData.phone, 10);
    const aadhaarDigits = sanitizeNumericInput(formData.aadhaar, 12);
    const hasGovernmentId = Boolean(formData.governmentId);
    const permanentAddress = formData.permanentAddress.trim();
    const temporaryAddress = formData.temporaryAddress.trim();

    if (!trimmedName) {
      nextErrors.name = "Full name is required";
    }

    if (!phoneDigits) {
      nextErrors.phone = "Mobile number is required";
    } else if (!isValidPhoneNumber(phoneDigits)) {
      nextErrors.phone = "Enter a valid 10-digit mobile number";
    }

    // Aadhaar is required only when an ID photo is NOT provided.
    if (!hasGovernmentId) {
      if (!aadhaarDigits) {
        nextErrors.aadhaar = "Aadhaar number is required";
      } else if (!isValidAadhaarNumber(aadhaarDigits)) {
        nextErrors.aadhaar = "Enter a valid 12-digit Aadhaar number";
      } else if (!formData.aadhaarVerified) {
        nextErrors.aadhaar = "Verify via DigiLocker or capture an ID photo before continuing";
      }
    } else if (aadhaarDigits && !isValidAadhaarNumber(aadhaarDigits)) {
      // If Aadhaar is optionally entered, still validate format.
      nextErrors.aadhaar = "Enter a valid 12-digit Aadhaar number";
    }

    if (!permanentAddress) {
      nextErrors.permanentAddress = "Permanent address is required";
    }

    if (!formData.sameAddress && !temporaryAddress) {
      nextErrors.temporaryAddress = "Temporary address is required";
    }

    if (!formData.dob) {
      nextErrors.dob = "Date of birth is required";
    } else {
      const age = calculateAge(formData.dob);
      if (age !== "" && age < 16) {
        nextErrors.dob = "Rider must be at least 16 years old.";
      }
    }

    if (!formData.gender) {
      nextErrors.gender = "Please select a gender";
    }

    setErrors(nextErrors);

    if (Object.keys(nextErrors).length === 0) {
      updateForm({
        name: trimmedName,
        phone: phoneDigits,
        ...(aadhaarDigits ? { aadhaar: aadhaarDigits } : {}),
        permanentAddress,
        ...(formData.sameAddress
          ? { temporaryAddress: permanentAddress }
          : { temporaryAddress }),
      });

      navigate("../step-2");
    }
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

      {existingRiderMatch && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="font-medium">Rider already registered.</p>
            <p className="text-xs text-red-700/80">
              New Rider form is blocked for this mobile/Aadhaar. Use Retain Rider instead.
            </p>
          </div>
          <button
            type="button"
            className="btn-outline"
            onClick={() => navigate("/employee/retain-rider")}
          >
            Go to Retain Rider
          </button>
        </div>
      )}

      <div className="card space-y-8">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <h3 className="text-base font-semibold text-evegah-text">
              Rider Information
            </h3>
            <p className="text-sm text-gray-500">
              Personal and contact details for the rider.
            </p>
          </div>

          <div className="w-full md:w-auto">
            <label className="label mb-1 md:text-right">Operational Zone</label>
            <select
              className="select md:min-w-[200px]"
              value={formData.operationalZone || ""}
              onChange={(e) => updateForm({ operationalZone: e.target.value })}
            >
              <option>Gotri Zone</option>
              <option>Manjalpur</option>
              <option>Karelibaug</option>
                <option>Daman</option>
                <option>Aatapi</option>
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="label">Full Name *</label>
            <input
              className="input"
              placeholder="As per your government ID"
              value={formData.name}
              onChange={(e) => {
                updateForm({ name: e.target.value });
                clearFieldError("name");
              }}
            />
            {errors.name && <p className="error">{errors.name}</p>}
          </div>

          <div>
            <label className="label">Mobile Number *</label>
            <input
              className="input"
              type="tel"
              value={formData.phone}
              inputMode="numeric"
              maxLength={10}
              onChange={(e) => {
                const digits = sanitizeNumericInput(e.target.value, 10);
                setExistingRiderMatch(null);
                updateForm({ phone: digits });
                clearFieldError("phone");
              }}
              onBlur={(e) =>
                handleRetainLookup({
                  phone: sanitizeNumericInput(e.target.value, 10),
                })
              }
            />
            {errors.phone && <p className="error">{errors.phone}</p>}
          </div>
        </div>

        <div className={`grid grid-cols-1 gap-4 ${formData.sameAddress ? "md:grid-cols-1" : "md:grid-cols-2"}`}>
          <div>
            <label className="label">Resident Address *</label>
            <textarea
              className="textarea"
              rows={3}
              placeholder="House no, Street, Area, City, Pincode"
              value={formData.permanentAddress}
              onChange={(e) => {
                const value = e.target.value;
                updateForm({
                  permanentAddress: value,
                  ...(formData.sameAddress ? { temporaryAddress: value } : {}),
                });
                clearFieldError("permanentAddress");
                if (formData.sameAddress) clearFieldError("temporaryAddress");
              }}
            />
            {errors.permanentAddress && (
              <p className="error">{errors.permanentAddress}</p>
            )}
          </div>

          {!formData.sameAddress && (
            <div>
              <label className="label">Permanent Address *</label>
              <textarea
                className="textarea"
                rows={3}
                placeholder="House no, Street, Area, City, Pincode"
                value={formData.temporaryAddress}
                onChange={(e) => {
                  updateForm({ temporaryAddress: e.target.value });
                  clearFieldError("temporaryAddress");
                }}
              />
              {errors.temporaryAddress && (
                <p className="error">{errors.temporaryAddress}</p>
              )}
            </div>
          )}
        </div>

        <div className="pt-1">
          <label className="flex items-center gap-2 text-sm text-evegah-text font-medium">
            <input
              type="checkbox"
              className="checkbox"
              checked={formData.sameAddress}
              onChange={(e) => {
                const checked = e.target.checked;
                if (checked) {
                  tempAddressCache.current = formData.temporaryAddress;
                  updateForm({
                    sameAddress: true,
                    temporaryAddress: formData.permanentAddress,
                  });
                  clearFieldError("temporaryAddress");
                } else {
                  updateForm({
                    sameAddress: false,
                    temporaryAddress: tempAddressCache.current || "",
                  });
                }
              }}
            />
            My Resident address is the same as my permanent address.
          </label>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="label">Reference Name / Number</label>
            <input
              className="input"
              value={formData.reference}
              onChange={(e) => {
                updateForm({ reference: e.target.value });
              }}
            />
          </div>

          <div>
            <label className="label">Date of Birth *</label>
            <input
              type="date"
              className="input"
              value={formData.dob ? (() => { try { return new Date(formData.dob).toISOString().split('T')[0]; } catch { return ''; } })() : ''}
              onChange={(e) => {
                updateForm({ dob: e.target.value });
                clearFieldError("dob");
              }}
              max={new Date().toISOString().split("T")[0]}
              inputMode="numeric"
              pattern="[0-9]{4}-[0-9]{2}-[0-9]{2}"
              placeholder="YYYY-MM-DD"
            />
            {errors.dob && <p className="error">{errors.dob}</p>}
          </div>

          <div>
            <label className="label">Gender *</label>
            <div className="flex gap-4 mt-2">
              {["Male", "Female", "Other"].map((g) => (
                <label key={g} className="flex items-center gap-1 text-sm">
                  <input
                    type="radio"
                    className="radio"
                    name="gender"
                    value={g}
                    checked={formData.gender === g}
                    onChange={() => {
                      updateForm({ gender: g });
                      clearFieldError("gender");
                    }}
                  />
                  {g}
                </label>
              ))}
            </div>
            {errors.gender && <p className="error">{errors.gender}</p>}
          </div>
        </div>

        <div className="rounded-xl border border-evegah-border bg-white p-4 space-y-4">
          <h3 className="font-medium text-evegah-text">Identity Verification</h3>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="label">
                Aadhaar Card Number {!formData.governmentId ? "*" : ""}
              </label>
              <div className="flex gap-2">
                <input
                  className="input flex-1"
                  placeholder="XXXX-XXXX-XXXX"
                  value={formatAadhaarDisplay(formData.aadhaar)}
                  inputMode="numeric"
                  maxLength={14}
                  onChange={(e) => {
                    const digits = sanitizeNumericInput(e.target.value, 12);
                    setExistingRiderMatch(null);
                    updateForm({ aadhaar: digits, aadhaarVerified: false });
                    setAadhaarStatus("idle");
                    setAadhaarMessage("");
                    clearFieldError("aadhaar");
                  }}
                  onBlur={(e) =>
                    handleRetainLookup({
                      aadhaar: sanitizeNumericInput(e.target.value, 12),
                    })
                  }
                />
                <button
                  type="button"
                  className="btn-primary whitespace-nowrap disabled:opacity-60"
                  onClick={handleDigiLockerVerify}
                  disabled={
                    digilocker.verifying ||
                    formData.aadhaarVerified ||
                    sanitizeNumericInput(formData.aadhaar, 12).length !== 12
                  }
                >
                  {formData.aadhaarVerified
                    ? "Verified"
                    : digilocker.verifying
                      ? "Opening..."
                      : "Verify via DigiLocker"}
                </button>
              </div>
              <p className="text-xs text-gray-500 mt-1">
                {digilocker.loading
                  ? "Checking DigiLocker configuration..."
                  : "Verification will open DigiLocker login."}
              </p>
              {errors.aadhaar && <p className="error">{errors.aadhaar}</p>}
              {aadhaarMessage && (
                <p
                  className={`text-xs mt-1 ${
                    aadhaarStatus === "verified"
                      ? "text-green-600"
                      : aadhaarStatus === "awaiting-otp"
                      ? "text-blue-600"
                      : "text-gray-500"
                  }`}
                >
                  {aadhaarMessage}
                </p>
              )}
              {digilockerDoc?.id && (
                <div className="mt-2">
                  <button
                    type="button"
                    className="text-xs text-blue-600 hover:underline"
                    onClick={handleDownloadDigiLockerDocument}
                  >
                    Download DigiLocker document
                  </button>
                </div>
              )}
            </div>

            <div>
                <input
                  ref={governmentIdInputRef}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    handleImagePick(file);
                    e.target.value = "";
                  }}
                />

              <button
                type="button"
                className="w-full border-2 border-dashed rounded-xl flex flex-col items-center justify-center text-sm text-gray-500 p-5 hover:bg-gray-50 transition text-left"
                onClick={() => governmentIdInputRef.current?.click()}
              >
                <Upload size={20} />
                <p className="mt-2">
                  {getImageDataUrl(formData.governmentId)
                    ? "Retake ID photo"
                    : "Capture ID photo"}
                </p>
                <p className="text-xs">PNG, JPG, WEBP (max 5MB)</p>
              </button>
            </div>
          </div>

          {getImageDataUrl(formData.governmentId) ? (
            <div className="mt-1 rounded-xl border border-evegah-border bg-gray-50 p-3">
              <p className="text-xs font-medium text-gray-600 mb-2">
                Captured ID Preview
              </p>
              <button
                type="button"
                className="block w-full"
                onClick={() =>
                  setImagePreview({
                    src: getImageDataUrl(formData.governmentId),
                    title: "ID Card Photo",
                  })
                }
                title="Open preview"
              >
                <img
                  src={getImageDataUrl(formData.governmentId)}
                  alt="Government ID"
                  className="h-40 w-full rounded-lg object-cover bg-white"
                />
              </button>
              <div className="mt-3">
                <button
                  type="button"
                  className="btn-muted"
                  onClick={() => updateForm({ governmentId: null })}
                >
                  Remove ID
                </button>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end border-t border-evegah-border pt-4">
          <div className="flex gap-2">
            <button
              type="button"
              className="btn-outline"
              onClick={handleSaveDraft}
            >
              Save Draft
            </button>

            <button
              onClick={handleNext}
              type="button"
              disabled={Boolean(existingRiderMatch)}
              className="btn-primary flex items-center gap-2 disabled:opacity-60"
            >
              Next →
            </button>
          </div>
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
