import { useEffect, useMemo, useRef, useState } from "react";

import EmployeeLayout from "../../components/layouts/EmployeeLayout";
import { apiFetch } from "../../config/api";
import { formatRentalId } from "../../utils/entityId";
import { formatDateTimeDDMMYYYY } from "../../utils/dateFormat";

const sanitizeNumericInput = (value, maxLength) =>
  String(value || "")
    .replace(/\D/g, "")
    .slice(0, maxLength);

export default function ReturnVehicle() {
  const [mobile, setMobile] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [riderName, setRiderName] = useState("");
  const [conditionNotes, setConditionNotes] = useState("");
  const [feedback, setFeedback] = useState("");
  const [photos, setPhotos] = useState([]);
  const [photoInputKey, setPhotoInputKey] = useState(0);
  const [photoError, setPhotoError] = useState("");
  const fileInputRef = useRef(null);

  const [searching, setSearching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [submitError, setSubmitError] = useState("");
  const [depositReturnedSelection, setDepositReturnedSelection] = useState(null);
  const [depositSelectionError, setDepositSelectionError] = useState("");
  const [rental, setRental] = useState(null);
  const [overdueCharge, setOverdueCharge] = useState(0);
  const [overdueMinutes, setOverdueMinutes] = useState(0);
  const [extraPayment, setExtraPayment] = useState(0);
  const [finalDepositRefund, setFinalDepositRefund] = useState(0);

  useEffect(() => {
    setDepositReturnedSelection(
      rental ? Boolean(rental.deposit_returned) : null
    );
    setDepositSelectionError("");
    // Reset extra payment and refund when new rental is loaded
    setExtraPayment(0);
    setFinalDepositRefund(0);
  }, [rental]);

  // Calculate final deposit refund whenever deposit, overdue, or extra payment changes
  useEffect(() => {
    if (!rental) {
      setFinalDepositRefund(0);
      return;
    }
    const deposit = Number(rental.deposit_amount ?? 0);
    const totalDeductions = Number(overdueCharge) + Number(extraPayment);
    const refund = Math.max(0, deposit - totalDeductions);
    setFinalDepositRefund(refund);
  }, [rental, overdueCharge, extraPayment]);

  const mobileDigits = useMemo(() => sanitizeNumericInput(mobile, 10), [mobile]);
  const vehicleText = String(vehicleId || "").trim();
  const riderNameText = String(riderName || "").trim();

  const formatCurrency = (amount) => `₹${Number(amount || 0).toLocaleString("en-IN")}`;

  const formatDateTime = (value) => {
    if (!value) return null;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return null;
    return parsed.toLocaleString();
  };

  const depositAmountValue = rental?.deposit_amount ?? 0;
  const depositReturned = Boolean(rental?.deposit_returned);
  const depositReturnedAmount = Number(rental?.deposit_returned_amount ?? 0);
  const depositReturnedAtLabel = formatDateTime(rental?.deposit_returned_at);
  const depositStatusLine = depositReturned
    ? `Refunded ${formatCurrency(depositReturnedAmount || depositAmountValue)}${depositReturnedAtLabel ? ` on ${depositReturnedAtLabel}` : ""}`
    : "Pending refund";
  const depositStatusClass = depositReturned ? "text-green-600" : "text-yellow-600";

  const handleSearch = async () => {
    setSearchError("");
    setSubmitError("");
    setRental(null);

    if (!mobileDigits && !vehicleText && !riderNameText) {
      setSearchError("Enter rider mobile number, vehicle id, or rider name.");
      return;
    }

    setSearching(true);
    try {
      const params = new URLSearchParams();
      if (mobileDigits) params.set("mobile", mobileDigits);
      if (vehicleText) params.set("vehicle", vehicleText);
      if (riderNameText) params.set("name", riderNameText);
      const found = await apiFetch(`/api/rentals/active?${params.toString()}`);
      if (!found) {
        setSearchError("No active rental found for the given details.");
        return;
      }
      setRental(found);

      // Overdue charge logic
      const now = new Date();
      const rentalEnd = found.rental_end ? new Date(found.rental_end) : null;
      let overdue = 0;
      let overdueMins = 0;
      if (rentalEnd && now > rentalEnd) {
        overdueMins = Math.ceil((now - rentalEnd) / (1000 * 60));
        // ₹10 per 10 minutes overdue, minimum ₹10
        overdue = Math.max(10, Math.ceil(overdueMins / 10) * 10);
      }
      setOverdueMinutes(overdueMins);
      setOverdueCharge(overdue);
    } catch (e) {
      setSearchError(String(e?.message || e || "Unable to search active rental"));
    } finally {
      setSearching(false);
    }
  };

  const handleSubmitReturn = async () => {
    setSubmitError("");
    setDepositSelectionError("");

    if (!rental?.id) {
      setSubmitError("Search and select an active rental first.");
      return;
    }
    if (!String(conditionNotes || "").trim()) {
      setSubmitError("Vehicle condition is required.");
      return;
    }
    if (!Array.isArray(photos) || photos.length === 0) {
      setSubmitError("Upload at least one return photo.");
      return;
    }
    if (depositReturnedSelection === null) {
      setDepositSelectionError("Mark whether the deposit was returned or not.");
      return;
    }

    setSubmitting(true);
    try {
      const form = new FormData();
      form.set("rentalId", rental.id);
      form.set("conditionNotes", String(conditionNotes).trim());
      if (String(feedback || "").trim()) {
        form.set("feedback", String(feedback).trim());
      }
      form.set("depositReturned", depositReturnedSelection ? "true" : "false");
      form.set("overdueCharge", String(overdueCharge));
      form.set("extraPayment", String(extraPayment));
      form.set("finalDepositRefund", String(finalDepositRefund));
      (Array.isArray(photos) ? photos : []).forEach((file) => {
        form.append("photos", file);
      });

      const result = await apiFetch("/api/returns/submit", {
        method: "POST",
        body: form,
      });

      const refund = Number(result?.depositReturnedAmount ?? finalDepositRefund);
      let msg = `Vehicle returned successfully.`;
      if (overdueCharge > 0) {
        msg += ` Overdue charge applied: ₹${overdueCharge}.`;
      }
      if (extraPayment > 0) {
        msg += ` Extra payment charged: ₹${extraPayment}.`;
      }
      msg += refund > 0 ? ` Deposit returned: ₹${refund}` : " Deposit fully adjusted.";
      alert(msg);

      // Reset
      setRental(null);
      setConditionNotes("");
      setFeedback("");
      setPhotos([]);
      setPhotoInputKey((k) => k + 1);
      setMobile("");
      setVehicleId("");
      setRiderName("");
    } catch (e) {
      setSubmitError(String(e?.message || e || "Unable to submit return"));
    } finally {
      setSubmitting(false);
    }
  };

  const removePhotoAt = (index) => {
    setPhotos((prev) => prev.filter((_, i) => i !== index));
    setPhotoInputKey((k) => k + 1);
  };

  const clearAllPhotos = () => {
    setPhotos([]);
    setPhotoInputKey((k) => k + 1);
  };

  return (
    <EmployeeLayout>
      <div className="mx-auto w-full max-w-5xl space-y-6">
        <div className="rounded-3xl border border-evegah-border bg-white p-6 shadow-card">
          <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">
            Rentals
          </p>
          <div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-evegah-text">Return Vehicle</h1>
              <p className="text-sm text-gray-600">
                Search an active rental and record the vehicle return.
              </p>
            </div>
            <div className="text-xs text-gray-500">Operational workflow</div>
          </div>
        </div>

        <div className="card space-y-4">
          <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
            
            <div>
              <label className="label">Rider Name</label>
              <input
                className="input"
                placeholder="Enter rider name"
                value={riderName}
                onChange={(e) => setRiderName(e.target.value)}
              />
            </div>
            
            <div>
              <label className="label">Rider Mobile Number</label>
              <input
                className="input"
                placeholder="Enter mobile number"
                value={mobile}
                inputMode="numeric"
                maxLength={10}
                onChange={(e) => setMobile(sanitizeNumericInput(e.target.value, 10))}
              />
            </div>

            <div>
              <label className="label">Vehicle ID</label>
              <input
                className="input"
                placeholder="Enter vehicle id"
                value={vehicleId}
                onChange={(e) => setVehicleId(e.target.value)}
              />
            </div>

            

            <div className="flex items-end">
              <button
                type="button"
                className="btn-primary w-full disabled:opacity-60"
                onClick={handleSearch}
                disabled={searching}
              >
                {searching ? "Searching..." : "Search Active Rental"}
              </button>
            </div>
          </div>

          {searchError ? <p className="error">{searchError}</p> : null}

          {rental ? (
            <div className="rounded-xl border border-evegah-border bg-gray-50 p-4">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-5">
                <div>
                  <p className="text-xs text-gray-500">Rider</p>
                  <p className="text-sm text-evegah-text font-medium">{rental.rider_full_name || "-"}</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    Rental: {formatRentalId(rental.id)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Vehicle ID</p>
                  <p className="text-sm text-evegah-text font-medium">{rental.vehicle_number || rental.vehicle_id || "-"}</p>
                  <p className="text-xs text-gray-500 mt-1">Battery: {rental.current_battery_id || rental.battery_id || "-"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Start</p>
                  <p className="text-sm text-evegah-text font-medium">
                    {formatDateTimeDDMMYYYY(rental.start_time, "-")}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">Scheduled End: {formatDateTimeDDMMYYYY(rental.rental_end, "-")}</p>
                  <p className="text-xs text-gray-500 mt-1">Actual Return: {formatDateTimeDDMMYYYY(new Date(), "-")}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Total</p>
                  <p className="text-sm text-evegah-text font-medium">{rental.total_amount ?? "-"}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Deposit</p>
                  <p className="text-sm text-evegah-text font-medium">{formatCurrency(depositAmountValue)}</p>
                  <p className={`text-xs ${depositStatusClass}`}>{depositStatusLine}</p>
                  {overdueCharge > 0 ? (
                    <p className="text-xs text-red-600 mt-2">Overdue: {overdueMinutes} min<br/>Charge: ₹{overdueCharge}</p>
                  ) : null}
                  {extraPayment > 0 ? (
                    <p className="text-xs text-red-600 mt-1">Extra Payment: ₹{extraPayment}</p>
                  ) : null}
                  {(overdueCharge > 0 || extraPayment > 0) ? (
                    <p className="text-xs text-blue-700 mt-1 font-semibold">Deposit Refund: ₹{finalDepositRefund}</p>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="card space-y-4">
          <div>
            <h3 className="text-base font-semibold text-evegah-text">Return Details</h3>
            <p className="text-sm text-gray-500">
              Add condition notes and photos for proof.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="label">Return Vehicle Photos</label>
              <div className="flex gap-2 mb-2">
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => {
                    // Live capture: open file input with capture
                    if (fileInputRef.current) {
                      fileInputRef.current.setAttribute('capture', 'environment');
                      fileInputRef.current.click();
                    }
                  }}
                >
                  Capture Live Photo
                </button>
                <button
                  type="button"
                  className="btn-outline"
                  onClick={() => {
                    // Upload: open file input without capture
                    if (fileInputRef.current) {
                      fileInputRef.current.removeAttribute('capture');
                      fileInputRef.current.click();
                    }
                  }}
                >
                  Upload Image(s)
                </button>
                <input
                  ref={fileInputRef}
                  key={photoInputKey}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    setPhotoError("");
                    const files = Array.from(e.target.files || []);
                    // 10MB = 10 * 1024 * 1024
                    const tooLarge = files.find(f => f.size > 10 * 1024 * 1024);
                    if (tooLarge) {
                      setPhotoError("Each image must be 10MB or less.");
                      setPhotos([]);
                      return;
                    }
                    setPhotos(files);
                  }}
                />
              </div>
              {photos.length ? (
                <div className="mt-2 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-gray-500">{photos.length} file(s) selected</p>
                    <button type="button" className="btn-muted" onClick={clearAllPhotos}>
                      Clear Photos
                    </button>
                  </div>

                  <div className="rounded-xl border border-evegah-border bg-white">
                    <ul className="divide-y divide-evegah-border">
                      {photos.map((file, idx) => (
                        <li key={`${file.name}-${idx}`} className="flex items-center justify-between gap-3 px-4 py-3">
                          <div className="min-w-0">
                            <p className="text-sm text-evegah-text truncate">{file.name}</p>
                            <p className="text-xs text-gray-500">{Math.round(file.size / 1024)} KB</p>
                          </div>
                          <button type="button" className="btn-outline" onClick={() => removePhotoAt(idx)}>
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ) : null}
              <p className="mt-1 text-xs text-gray-500">
                Photos will be uploaded on submit. Max size: 10MB per image.
              </p>
              {photoError && <p className="error">{photoError}</p>}
            </div>

            <div className="space-y-2">
              <label className="label">
                Vehicle Condition <span className="text-red-500">*</span>
              </label>
              <textarea
                className="textarea"
                rows={4}
                placeholder="Describe scratches, damages, or issues..."
                value={conditionNotes}
                onChange={(e) => setConditionNotes(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <label className="label">Deposit Returned?</label>
              <select
                className="input"
                value={depositReturnedSelection === null ? "" : depositReturnedSelection ? "returned" : "not-returned"}
                onChange={(e) => {
                  const val = e.target.value === "returned" ? true : e.target.value === "not-returned" ? false : null;
                  setDepositReturnedSelection(val);
                  setDepositSelectionError("");
                }}
              >
                <option value="">Choose an option</option>
                <option value="returned">Yes, deposit returned</option>
                <option value="not-returned">No, deposit not returned</option>
              </select>
              {depositSelectionError ? <p className="error">{depositSelectionError}</p> : null}
            </div>

            <div className="space-y-2">
              <label className="label">Extra Payment (damage/other)</label>
              <input
                type="number"
                className="input"
                min={0}
                step={1}
                value={extraPayment}
                onChange={e => setExtraPayment(Number(e.target.value))}
                placeholder="Enter extra charge (₹)"
              />
              <p className="text-xs text-gray-500">Charge for damage, overdue, or any extra payment.</p>
            </div>

            <div className="md:col-span-2">
              <label className="label">Feedback (optional)</label>
              <textarea
                className="textarea"
                rows={3}
                placeholder="Any rider feedback or notes..."
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
              />
            </div>
          </div>

          {submitError ? <p className="error">{submitError}</p> : null}

          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-end border-t border-evegah-border pt-4">
            <button
              type="button"
              className="btn-primary disabled:opacity-60"
              onClick={handleSubmitReturn}
              disabled={submitting}
            >
              {submitting ? "Submitting..." : "Submit Return"}
            </button>
          </div>
        </div>
      </div>
    </EmployeeLayout>
  );
}
