import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useRiderForm } from "../useRiderForm";
import { BATTERY_ID_OPTIONS } from "../../../utils/batteryIds";
import { VEHICLE_ID_OPTIONS } from "../../../utils/vehicleIds";
import { apiFetch } from "../../../config/api";

const toDateTimeLocal = (date = new Date()) => {
  const pad = (value) => String(value).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const mi = pad(date.getMinutes());
  return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
};

const toDisplayDateTime = (value) => {
  if (!value) return "--";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return "--";
  const pad = (v) => String(v).padStart(2, "0");
  const dd = pad(parsed.getDate());
  const mm = pad(parsed.getMonth() + 1);
  const yy = pad(parsed.getFullYear() % 100);
  const hh = pad(parsed.getHours());
  const mi = pad(parsed.getMinutes());
  return `${dd}:${mm}:${yy} ${hh}:${mi}`;
};

export default function Step2Identity() {
  const { formData, updateForm, setFormData } = useRiderForm();
  const navigate = useNavigate();
  const vehicleDropdownRef = useRef(null);
  const vehicleQueryRef = useRef(null);
  const batteryDropdownRef = useRef(null);
  const batteryQueryRef = useRef(null);

  const [attempted, setAttempted] = useState(false);
  const [vehicleDropdownOpen, setVehicleDropdownOpen] = useState(false);
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [batteryDropdownOpen, setBatteryDropdownOpen] = useState(false);
  const [batteryQuery, setBatteryQuery] = useState("");

  const [unavailableVehicleIds, setUnavailableVehicleIds] = useState([]);
  const [unavailableBatteryIds, setUnavailableBatteryIds] = useState([]);

  const PACKAGE_OPTIONS = ["hourly", "daily", "weekly", "monthly"];
  const PAYMENT_OPTIONS = ["cash", "online", "split"];
  const BIKE_MODEL_OPTIONS = ["MINK", "CITY", "KING"];
  const ACCESSORY_OPTIONS = [
    { key: "mobile_holder", label: "Mobile holder" },
    { key: "mirror", label: "Mirror" },
    { key: "helmet", label: "Helmet" },
    { key: "extra_battery", label: "Extra battery" },
  ];

  const toggleAccessory = (key) => {
    const current = Array.isArray(formData.accessories) ? formData.accessories : [];
    if (current.includes(key)) {
      updateForm({ accessories: current.filter((x) => x !== key) });
    } else {
      updateForm({ accessories: [...current, key] });
    }
  };

  const handlePaymentModeChange = (value) => {
    const total = Number(formData.totalAmount || 0);
    const next = { paymentMode: value };
    if (value === "cash") {
      next.cashAmount = total;
      next.onlineAmount = 0;
    } else if (value === "online") {
      next.cashAmount = 0;
      next.onlineAmount = total;
    } else if (value === "split") {
      const cashShare = Math.round(total / 2);
      next.cashAmount = cashShare;
      next.onlineAmount = total - cashShare;
    }
    updateForm(next);
  };

  const clampSplitValue = (value) => {
    const next = Number(value);
    if (Number.isNaN(next)) return 0;
    return Math.max(0, next);
  };

  const handleSplitCashChange = (value) => {
    const total = Number(formData.totalAmount || 0);
    const nextCash = clampSplitValue(value);
    const nextOnline = Math.max(total - nextCash, 0);
    updateForm({ cashAmount: nextCash, onlineAmount: nextOnline });
  };

  const handleSplitOnlineChange = (value) => {
    const total = Number(formData.totalAmount || 0);
    const nextOnline = clampSplitValue(value);
    const nextCash = Math.max(total - nextOnline, 0);
    updateForm({ cashAmount: nextCash, onlineAmount: nextOnline });
  };

  const isNonEmpty = (v) => Boolean(String(v ?? "").trim());

  const normalizeIdForCompare = (value) =>
    String(value || "")
      .replace(/[^a-z0-9]+/gi, "")
      .toUpperCase();

  const unavailableVehicleSet = useMemo(
    () => new Set((Array.isArray(unavailableVehicleIds) ? unavailableVehicleIds : []).map(normalizeIdForCompare).filter(Boolean)),
    [unavailableVehicleIds]
  );
  const unavailableBatterySet = useMemo(
    () => new Set((Array.isArray(unavailableBatteryIds) ? unavailableBatteryIds : []).map(normalizeIdForCompare).filter(Boolean)),
    [unavailableBatteryIds]
  );

  useEffect(() => {
    if (!formData.rentalPackage) return;
    const now = toDateTimeLocal(new Date());
    setFormData((prev) => ({ ...prev, rentalStart: now }));
  }, [formData.rentalPackage]);

  useEffect(() => {
    let mounted = true;
    apiFetch("/api/availability")
      .then((data) => {
        if (!mounted) return;
        setUnavailableVehicleIds(Array.isArray(data?.unavailableVehicleIds) ? data.unavailableVehicleIds : []);
        setUnavailableBatteryIds(Array.isArray(data?.unavailableBatteryIds) ? data.unavailableBatteryIds : []);
      })
      .catch(() => {
        if (!mounted) return;
        setUnavailableVehicleIds([]);
        setUnavailableBatteryIds([]);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const filteredVehicleIds = useMemo(() => {
    const q = String(vehicleQuery || "").trim().toUpperCase();
    if (!q) return VEHICLE_ID_OPTIONS;
    return VEHICLE_ID_OPTIONS.filter((id) => id.includes(q));
  }, [vehicleQuery]);

  const filteredBatteryIds = useMemo(() => {
    const q = String(batteryQuery || "").trim().toUpperCase();
    if (!q) return BATTERY_ID_OPTIONS;
    return BATTERY_ID_OPTIONS.filter((id) => id.includes(q));
  }, [batteryQuery]);

  useEffect(() => {
    if (!vehicleDropdownOpen && !batteryDropdownOpen) return;

    const onMouseDown = (e) => {
      const vehicleRoot = vehicleDropdownRef.current;
      const batteryRoot = batteryDropdownRef.current;

      if (vehicleDropdownOpen && vehicleRoot && !vehicleRoot.contains(e.target)) {
        setVehicleDropdownOpen(false);
      }
      if (batteryDropdownOpen && batteryRoot && !batteryRoot.contains(e.target)) {
        setBatteryDropdownOpen(false);
      }
    };

    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [vehicleDropdownOpen, batteryDropdownOpen]);

  const selectVehicleId = (id) => {
    updateForm({ bikeId: id });
    setVehicleDropdownOpen(false);
    setVehicleQuery("");
  };

  const selectBatteryId = (id) => {
    updateForm({ batteryId: id });
    setBatteryDropdownOpen(false);
    setBatteryQuery("");
  };

  const totalAmount = Number(formData.totalAmount || 0);
  const cashAmount = Number(formData.cashAmount || 0);
  const onlineAmount = Number(formData.onlineAmount || 0);
  const paymentMismatch = cashAmount + onlineAmount !== totalAmount;
  const paymentSplitValid =
    formData.paymentMode !== "split" ||
    (cashAmount >= 0 && onlineAmount >= 0 && !paymentMismatch);

  const isValid =
    isNonEmpty(formData.rentalStart) &&
    isNonEmpty(formData.rentalPackage) &&
    isNonEmpty(formData.paymentMode) &&
    Number(formData.rentalAmount || 0) > 0 &&
    Number(formData.securityDeposit ?? 0) >= 0 &&
    isNonEmpty(formData.bikeModel) &&
    isNonEmpty(formData.bikeId) &&
    isNonEmpty(formData.batteryId) &&
    !unavailableVehicleSet.has(normalizeIdForCompare(formData.bikeId)) &&
    !unavailableBatterySet.has(normalizeIdForCompare(formData.batteryId)) &&
    paymentSplitValid;

  const handleNext = () => {
    setAttempted(true);
    if (!isValid) return;
    navigate("../step-3");
  };

  return (
    <div className="space-y-5">
      <div className="card space-y-6 mx-auto w-full max-w-5xl">
        <div>
          <h3 className="text-base font-semibold text-evegah-text">Rental Details</h3>
          <p className="text-sm text-gray-500">
            Fill rental plan, vehicle details, and accessories issued.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="label">Rental Package</label>
            <select
              className="select"
              value={formData.rentalPackage || "daily"}
              onChange={(e) => updateForm({ rentalPackage: e.target.value })}
            >
              <option value="hourly">Hourly</option>
              <option value="daily">Daily</option>
              <option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option>
            </select>
            {attempted && !isNonEmpty(formData.rentalPackage) ? (
              <p className="error">Select a rental package.</p>
            ) : null}
          </div>

          <div>
            <label className="label">Rental Start Date &amp; Time</label>
            <input
              type="datetime-local"
              className="input"
              value={formData.rentalStart || ""}
              onChange={(e) => updateForm({ rentalStart: e.target.value })}
            />
            
            {attempted && !isNonEmpty(formData.rentalStart) ? (
              <p className="error">Rental start date &amp; time is required.</p>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="label">Return Date</label>
            <input
              type="datetime-local"
              className="input"
              value={formData.rentalEnd || ""}
              onChange={(e) => updateForm({ rentalEnd: e.target.value })}
            />
            
          </div>

          <div>
            <label className="label">Payment Mode</label>
            <select
              className="select"
              value={formData.paymentMode || "cash"}
              onChange={(e) => handlePaymentModeChange(e.target.value)}
            >
              {PAYMENT_OPTIONS.map((p) => (
                <option key={p} value={p}>
                  {p === "online"
                    ? "Online"
                    : p === "split"
                    ? "Split (cash + online)"
                    : "Cash"}
                </option>
              ))}
            </select>
            {attempted && !isNonEmpty(formData.paymentMode) ? (
              <p className="error">Select a payment mode.</p>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
          <div>
            <label className="label">Rental Package Amount</label>
            <input
              type="number"
              min="0"
              className="input"
              value={formData.rentalAmount ?? ""}
              onChange={(e) => updateForm({ rentalAmount: e.target.value })}
            />
            {attempted && !(Number(formData.rentalAmount || 0) > 0) ? (
              <p className="error">Enter rental amount (greater than 0).</p>
            ) : null}
          </div>

          <div>
            <label className="label">Security Deposit</label>
            <input
              type="number"
              min="0"
              className="input"
              value={formData.securityDeposit ?? ""}
              onChange={(e) => updateForm({ securityDeposit: e.target.value })}
            />
            {attempted && Number(formData.securityDeposit ?? 0) < 0 ? (
              <p className="error">Security deposit cannot be negative.</p>
            ) : null}
          </div>

          <div>
            <label className="label">Total Rental Amount</label>
            <input
              type="number"
              min="0"
              className="input"
              value={formData.totalAmount ?? 0}
              readOnly
            />
            
          </div>
        </div>

        {formData.paymentMode === "split" ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div>
              <label className="label">Cash Paid</label>
              <input
                type="number"
                min="0"
                className="input"
                value={formData.cashAmount ?? 0}
                onChange={(e) => handleSplitCashChange(e.target.value)}
              />
            </div>

            <div>
              <label className="label">Online Paid</label>
              <input
                type="number"
                min="0"
                className="input"
                value={formData.onlineAmount ?? 0}
                onChange={(e) => handleSplitOnlineChange(e.target.value)}
              />
            </div>
          </div>
        ) : null}

        {formData.paymentMode === "split" && attempted && paymentMismatch ? (
          <p className="error">
            Cash + online totals must equal the total amount ({totalAmount}).
          </p>
        ) : null}


        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="label">E-bike Model</label>
            <select
              className="select"
              value={formData.bikeModel || "MINK"}
              onChange={(e) => updateForm({ bikeModel: e.target.value })}
            >
              {BIKE_MODEL_OPTIONS.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            {attempted && !isNonEmpty(formData.bikeModel) ? (
              <p className="error">E-bike model is required.</p>
            ) : null}
          </div>

          <div>
            <label className="label">E-Bike ID No </label>
            <div ref={vehicleDropdownRef} className="relative">
              <button
                type="button"
                className="select flex items-center justify-between gap-3"
                aria-haspopup="listbox"
                aria-expanded={vehicleDropdownOpen}
                onClick={() => {
                  setVehicleDropdownOpen((v) => {
                    const next = !v;
                    if (!v && next) {
                      setTimeout(() => vehicleQueryRef.current?.focus(), 0);
                    }
                    return next;
                  });
                }}
              >
                <span className={formData.bikeId ? "text-evegah-text" : "text-gray-500"}>
                  {formData.bikeId || "Select E-Bike ID"}
                </span>
                <span className="text-gray-400">▾</span>
              </button>

              {vehicleDropdownOpen ? (
                <div className="absolute z-20 mt-2 w-full rounded-xl border border-evegah-border bg-white shadow-card p-2">
                  <input
                    ref={vehicleQueryRef}
                    className="input"
                    placeholder="Search vehicle id..."
                    value={vehicleQuery}
                    onChange={(e) => setVehicleQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setVehicleDropdownOpen(false);
                      }
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (filteredVehicleIds.length === 1) {
                          selectVehicleId(filteredVehicleIds[0]);
                        }
                      }
                    }}
                  />

                  <div className="mt-2 max-h-48 overflow-y-auto" role="listbox">
                    {filteredVehicleIds.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500">No matching vehicle id.</div>
                    ) : (
                      filteredVehicleIds.map((id) => (
                        (() => {
                          const unavailable = unavailableVehicleSet.has(normalizeIdForCompare(id));
                          return (
                        <button
                          key={id}
                          type="button"
                          disabled={unavailable}
                          aria-disabled={unavailable}
                          className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                            unavailable
                              ? "cursor-not-allowed text-gray-400"
                              : "hover:bg-gray-50"
                          } ${id === formData.bikeId ? "bg-gray-100" : ""}`}
                          onClick={() => {
                            if (unavailable) return;
                            selectVehicleId(id);
                          }}
                        >
                          {id}
                          {unavailable ? " (Unavailable)" : ""}
                        </button>
                          );
                        })()
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            {attempted && !isNonEmpty(formData.bikeId) ? (
              <p className="error">E-bike ID is required.</p>
            ) : attempted && unavailableVehicleSet.has(normalizeIdForCompare(formData.bikeId)) ? (
              <p className="error">Selected vehicle is unavailable.</p>
            ) : null}
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div>
            <label className="label">Battery ID </label>
            <div ref={batteryDropdownRef} className="relative">
              <button
                type="button"
                className="select flex items-center justify-between gap-3"
                aria-haspopup="listbox"
                aria-expanded={batteryDropdownOpen}
                onClick={() => {
                  setBatteryDropdownOpen((v) => {
                    const next = !v;
                    if (!v && next) {
                      setTimeout(() => batteryQueryRef.current?.focus(), 0);
                    }
                    return next;
                  });
                }}
              >
                <span className={formData.batteryId ? "text-evegah-text" : "text-gray-500"}>
                  {formData.batteryId || "Select Battery ID"}
                </span>
                <span className="text-gray-400">▾</span>
              </button>

              {batteryDropdownOpen ? (
                <div className="absolute z-20 mt-2 w-full rounded-xl border border-evegah-border bg-white shadow-card p-2">
                  <input
                    ref={batteryQueryRef}
                    className="input"
                    placeholder="Search battery id..."
                    value={batteryQuery}
                    onChange={(e) => setBatteryQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Escape") {
                        e.preventDefault();
                        setBatteryDropdownOpen(false);
                      }
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (filteredBatteryIds.length === 1) {
                          selectBatteryId(filteredBatteryIds[0]);
                        }
                      }
                    }}
                  />

                  <div className="mt-2 max-h-48 overflow-y-auto" role="listbox">
                    {filteredBatteryIds.length === 0 ? (
                      <div className="px-3 py-2 text-sm text-gray-500">No matching battery id.</div>
                    ) : (
                      filteredBatteryIds.map((id) => (
                        (() => {
                          const unavailable = unavailableBatterySet.has(normalizeIdForCompare(id));
                          return (
                        <button
                          key={id}
                          type="button"
                          disabled={unavailable}
                          aria-disabled={unavailable}
                          className={`w-full rounded-lg px-3 py-2 text-left text-sm ${
                            unavailable
                              ? "cursor-not-allowed text-gray-400"
                              : "hover:bg-gray-50"
                          } ${id === formData.batteryId ? "bg-gray-100" : ""}`}
                          onClick={() => {
                            if (unavailable) return;
                            selectBatteryId(id);
                          }}
                        >
                          {id}
                          {unavailable ? " (Unavailable)" : ""}
                        </button>
                          );
                        })()
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>
            {attempted && !isNonEmpty(formData.batteryId) ? (
              <p className="error">Battery ID is required.</p>
            ) : attempted && unavailableBatterySet.has(normalizeIdForCompare(formData.batteryId)) ? (
              <p className="error">Selected battery is unavailable.</p>
            ) : null}
          </div>

          <div>
            <label className="label">Accessories Issued</label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {ACCESSORY_OPTIONS.map((a) => (
                <label key={a.key} className="flex items-center gap-2 text-sm text-evegah-text">
                  <input
                    type="checkbox"
                    className="checkbox"
                    checked={(Array.isArray(formData.accessories) ? formData.accessories : []).includes(a.key)}
                    onChange={() => toggleAccessory(a.key)}
                  />
                  {a.label}
                </label>
              ))}
            </div>
          </div>
        </div>

        <div>
          <label className="label">Other Accessories</label>
          <textarea
            className="textarea"
            rows={3}
            placeholder="Optional"
            value={formData.otherAccessories || ""}
            onChange={(e) => updateForm({ otherAccessories: e.target.value })}
          />
        </div>

        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between border-t border-evegah-border pt-4">
          <button
            type="button"
            className="btn-outline"
            onClick={() => navigate("../step-1")}
          >
            ← Back
          </button>

          <button
            type="button"
            className="btn-primary disabled:opacity-50"
            onClick={handleNext}
            disabled={!isValid}
          >
            Next →
          </button>
        </div>
      </div>
    </div>
  );
}
