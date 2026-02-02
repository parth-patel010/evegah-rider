import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { apiFetch, apiUrl } from "../../config/api";
import { downloadRiderReceiptPdf } from "../../utils/riderReceiptPdf";
import { formatDateDDMMYYYY, formatDateTimeDDMMYYYY } from "../../utils/dateFormat";
import { Download } from "lucide-react";

export default function RiderProfileModal({ rider, close }) {
  const [rides, setRides] = useState([]);
  const [docs, setDocs] = useState([]);
  const [swapRows, setSwapRows] = useState([]);
  const [selectedRentalId, setSelectedRentalId] = useState("");
  const [rentalDocs, setRentalDocs] = useState([]);
  const [rentalDocsLoading, setRentalDocsLoading] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [imagePreview, setImagePreview] = useState(null);
  const [activeTab, setActiveTab] = useState("details");
  const [downloadingReceipt, setDownloadingReceipt] = useState(false);
  const [receiptError, setReceiptError] = useState("");
  const modalScrollRef = useRef(null);

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

  const normalizeZone = (value) => {
    const raw = String(value || "").trim().toLowerCase();
    if (!raw) return "";
    const cleaned = raw.replace(/\bzone\b/g, "").replace(/\s+/g, " ").trim();
    if (cleaned.includes("gotri")) return "Gotri";
    if (cleaned.includes("manjalpur")) return "Manjalpur";
    if (cleaned.includes("karelibaug")) return "Karelibaug";
    if (cleaned.includes("daman")) return "Daman";
    if (cleaned.includes("aatapi") || cleaned.includes("atapi")) return "Aatapi";
    return "";
  };

  const parseMaybeJson = (value) => {
    if (!value) return null;
    if (typeof value === "object") return value;
    if (typeof value !== "string") return null;
    try {
      return JSON.parse(value);
    } catch {
      return null;
    }
  };

  const safeText = (value, fallback = "N/A") => {
    const s = String(value ?? "").trim();
    return s ? s : fallback;
  };

  const maskAadhaar = (value) => {
    const digits = String(value || "").replace(/\D/g, "");
    if (digits.length < 4) return safeText(value, "N/A");
    return `**** **** ${digits.slice(-4)}`;
  };

  const fmtDate = (value) => {
    return formatDateDDMMYYYY(value, "N/A");
  };

  const fmtDateTime = (value) => {
    return formatDateTimeDDMMYYYY(value, "N/A");
  };

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [rideRows, docRows, swapRows] = await Promise.all([
        apiFetch(`/api/riders/${encodeURIComponent(rider.id)}/rentals`),
        apiFetch(`/api/riders/${encodeURIComponent(rider.id)}/documents`),
        apiFetch(`/api/riders/${encodeURIComponent(rider.id)}/battery-swaps`).catch(() => []),
      ]);
      setRides(Array.isArray(rideRows) ? rideRows : []);
      setDocs(Array.isArray(docRows) ? docRows : []);
      setSwapRows(Array.isArray(swapRows) ? swapRows : []);
    } catch (e) {
      setError(String(e?.message || e || "Unable to load rider details"));
      setRides([]);
      setDocs([]);
      setSwapRows([]);
    } finally {
      setLoading(false);
    }
  }, [rider.id]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const latestRide = useMemo(() => {
    if (!Array.isArray(rides) || rides.length === 0) return null;
    return rides[0];
  }, [rides]);

  const selectedRide = useMemo(() => {
    if (!Array.isArray(rides) || rides.length === 0) return null;
    const id = String(selectedRentalId || "");
    if (!id) return null;
    return rides.find((r) => String(r?.id || "") === id) || null;
  }, [rides, selectedRentalId]);

  const currentRide = selectedRide || latestRide;

  useEffect(() => {
    if (!selectedRentalId && latestRide?.id) {
      setSelectedRentalId(String(latestRide.id));
    }
  }, [latestRide?.id, selectedRentalId]);

  const loadRentalDocs = useCallback(async (rentalId) => {
    if (!rentalId) {
      setRentalDocs([]);
      return;
    }
    setRentalDocsLoading(true);
    try {
      const rows = await apiFetch(`/api/rentals/${encodeURIComponent(rentalId)}/documents`);
      setRentalDocs(Array.isArray(rows) ? rows : []);
    } catch {
      setRentalDocs([]);
    } finally {
      setRentalDocsLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!selectedRentalId) return;
    loadRentalDocs(selectedRentalId);
  }, [selectedRentalId, loadRentalDocs]);

  const rideMeta = useMemo(() => parseMaybeJson(currentRide?.meta) || {}, [currentRide?.meta]);
  const riderMeta = useMemo(() => parseMaybeJson(rider?.meta) || {}, [rider?.meta]);

  const fallbackZone = useMemo(() => {
    const candidates = [];
    if (rideMeta?.zone) candidates.push(rideMeta.zone);
    if (riderMeta?.zone) candidates.push(riderMeta.zone);

    // If selected ride has no zone (common for older retain rentals), scan other rides.
    (Array.isArray(rides) ? rides : []).forEach((row) => {
      const meta = parseMaybeJson(row?.meta) || {};
      if (meta?.zone) candidates.push(meta.zone);
    });

    for (const c of candidates) {
      const z = normalizeZone(c);
      if (z) return z;
    }
    return "";
  }, [rideMeta?.zone, riderMeta?.zone, rides, normalizeZone, parseMaybeJson]);

  const riderCode = useMemo(() => {
    const direct = String(rider?.rider_code || "").trim();
    if (direct) return direct;
    const fromMeta = String(riderMeta?.rider_code || "").trim();
    return fromMeta;
  }, [rider?.rider_code, riderMeta?.rider_code]);

  const handleDownloadReceipt = useCallback(async (rentalOverride) => {
    if (downloadingReceipt) return;
    setReceiptError("");

    // When used directly as an onClick handler, React passes the click event.
    // Guard against treating the event object as a rental.
    const rentalOverrideValue =
      rentalOverride && typeof rentalOverride?.preventDefault === "function"
        ? null
        : rentalOverride;

    const rental = rentalOverrideValue || currentRide || latestRide;
    if (!rider?.id) {
      setReceiptError("Rider information is missing.");
      return;
    }

    if (!rental?.id) {
      setReceiptError("Ride information is missing.");
      return;
    }

    setDownloadingReceipt(true);
    try {
      const rentalMeta = parseMaybeJson(rental?.meta) || {};

      const receiptFormData = {
        // Rider
        name: rider?.full_name,
        phone: rider?.mobile,
        aadhaar: rider?.aadhaar,
        dob: rider?.dob,
        gender: rider?.gender,
        operationalZone: normalizeZone(rentalMeta?.zone) || fallbackZone || "",
        reference: rider?.reference,
        permanentAddress: rider?.permanent_address,
        temporaryAddress: rider?.temporary_address,

        // Rental
        rentalStart: rental?.start_time,
        rentalEnd: rental?.end_time,
        rentalPackage: rental?.rental_package,
        bikeModel: rental?.bike_model,
        bikeId: rental?.bike_id,
        batteryId: rental?.battery_id,
        vehicleNumber: rental?.vehicle_number,
        accessories: Array.isArray(rental?.accessories) ? rental.accessories : [],
        otherAccessories: rental?.other_accessories,

        // Payment
        paymentMode: rental?.payment_mode,
        rentalAmount: rental?.rental_amount,
        securityDeposit: rental?.deposit_amount,
        totalAmount: rental?.total_amount,
        amountPaid: rental?.total_amount,

        // Agreement
        agreementAccepted: Boolean(rentalMeta?.agreement_accepted),
        agreementDate: rentalMeta?.agreement_date,
        issuedByName: rentalMeta?.issued_by_name,
      };

      await downloadRiderReceiptPdf({
        formData: receiptFormData,
        registration: {
          riderId: rider?.id,
          rentalId: rental?.id,
          riderCode,
        },
      });
    } catch (e) {
      setReceiptError(String(e?.message || e || "Unable to generate receipt"));
    } finally {
      setDownloadingReceipt(false);
    }
  }, [
    downloadingReceipt,
    rider,
    currentRide,
    latestRide,
    riderCode,
    riderMeta,
    normalizeZone,
    parseMaybeJson,
  ]);

  const submissionCode = useMemo(() => {
    const base = String(currentRide?.id || rider?.id || "").split("-")[0] || "";
    return base ? `EVEGAH-${base.toUpperCase()}` : "EVEGAH";
  }, [currentRide?.id, rider?.id]);

  const riderType = useMemo(() => {
    if (!Array.isArray(rides)) return "New";
    return rides.length > 1 ? "Retain" : "New";
  }, [rides]);

  const zoneLabel = useMemo(() => {
    return fallbackZone || "N/A";
  }, [fallbackZone]);

  const docsByKind = useMemo(() => {
    const grouped = {};
    (docs || []).forEach((d) => {
      const kind = String(d?.kind || "").trim();
      if (!kind) return;
      if (!grouped[kind]) grouped[kind] = [];
      grouped[kind].push(d);
    });
    return grouped;
  }, [docs]);

  const rentalDocsByKind = useMemo(() => {
    const grouped = {};
    (rentalDocs || []).forEach((d) => {
      const kind = String(d?.kind || "").trim();
      if (!kind) return;
      if (!grouped[kind]) grouped[kind] = [];
      grouped[kind].push(d);
    });
    return grouped;
  }, [rentalDocs]);

  const pickLatest = (kind) => (docsByKind[kind] && docsByKind[kind][0]) || null;

  const riderPhoto = pickLatest("rider_photo");
  const govId = pickLatest("government_id");
  const signature = pickLatest("rider_signature");
  const preRidePhotos = rentalDocsByKind["pre_ride_photo"] || [];
  const returnPhotos = rentalDocsByKind["return_photo"] || [];

  const filteredSwapRows = useMemo(() => {
    const all = Array.isArray(swapRows) ? swapRows : [];
    if (!selectedRentalId) return all;
    return all.filter((s) => String(s?.rental_id || "") === String(selectedRentalId));
  }, [swapRows, selectedRentalId]);

  const Badge = ({ children, tone = "neutral" }) => {
    const cls =
      tone === "primary"
        ? "bg-blue-50 text-blue-700 border-blue-200"
        : tone === "success"
          ? "bg-green-50 text-green-700 border-green-200"
          : tone === "danger"
            ? "bg-red-50 text-red-700 border-red-200"
            : "bg-gray-50 text-gray-700 border-gray-200";
    return (
      <span className={`inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold ${cls}`}>
        {children}
      </span>
    );
  };

  const Field = ({ label, value, className = "" }) => {
    const valueType = typeof value;
    const isPrimitive = valueType === "string" || valueType === "number";
    return (
      <div className={`space-y-1 min-w-0 ${className}`}>
        <div className="text-xs font-semibold text-gray-500">{label}</div>
        {isPrimitive ? (
          <div className="text-sm font-medium text-evegah-text truncate">{value}</div>
        ) : (
          <div className="text-sm font-medium text-evegah-text">{value}</div>
        )}
      </div>
    );
  };

  const ImageCard = ({ title, doc, emptyText }) => {
    const href = doc?.url ? apiUrl(doc.url) : "";
    const hasImage = Boolean(href);
    return (
      <div className="rounded-2xl border border-evegah-border bg-white p-4">
        <div className="text-sm font-semibold text-evegah-text mb-3">{title}</div>
        {hasImage ? (
          <button
            type="button"
            onClick={() => setImagePreview({ src: href, title })}
            className="block w-full overflow-hidden rounded-xl border border-evegah-border bg-gray-50"
            title="Open preview"
          >
            <img
              src={href}
              alt={title}
              className="h-40 w-full object-cover transition-transform hover:scale-[1.02]"
              loading="lazy"
            />
          </button>
        ) : (
          <div className="h-40 rounded-xl border border-dashed border-evegah-border bg-gray-50 flex items-center justify-center text-sm text-gray-500">
            {emptyText || "Not Provided"}
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      ref={modalScrollRef}
      className="fixed inset-0 z-50 bg-black/30 backdrop-blur-sm flex items-start justify-center p-4 sm:p-8 overflow-y-auto"
    >
      <div className="w-full max-w-5xl">
        <div className="rounded-2xl border border-evegah-border bg-white shadow-card overflow-hidden">
          {/* Header */}
          <div className="sticky top-0 z-10 border-b border-evegah-border bg-white/90 backdrop-blur px-5 py-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="text-xs font-semibold text-gray-500">Submission Details: {submissionCode}</div>
              <div className="mt-1 text-lg font-semibold text-evegah-text truncate">
                {safeText(rider?.full_name, "Rider")}
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge tone="primary">{zoneLabel}</Badge>
                <Badge tone={riderType === "Retain" ? "success" : "neutral"}>{riderType}</Badge>
                <Badge tone={String(rider?.status || "").toLowerCase() === "suspended" ? "danger" : "success"}>
                  {String(rider?.status || "active").toUpperCase()}
                </Badge>
              </div>
            </div>

            <div className="flex items-center gap-3">
              <div className="text-right hidden sm:block">
                <div className="text-xs text-gray-500">Submitted on</div>
                <div className="text-sm font-semibold text-evegah-text">
                  {fmtDateTime(latestRide?.start_time || rider?.created_at)}
                </div>
              </div>

              <button
                type="button"
                onClick={close}
                className="h-10 w-10 rounded-xl border border-evegah-border bg-white text-gray-600 hover:bg-gray-50"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="sticky top-[72px] z-10 border-b border-evegah-border bg-white/90 backdrop-blur px-5 py-2">
            <div className="flex flex-wrap gap-2">
              {[
                { key: "details", label: "Details" },
                { key: "photos", label: "Photos" },
                { key: "history", label: "History" },
              ].map((t) => {
                const active = activeTab === t.key;
                return (
                  <button
                    key={t.key}
                    type="button"
                    onClick={() => {
                      setActiveTab(t.key);
                      // Keep the content start visible when switching.
                      if (modalScrollRef.current) modalScrollRef.current.scrollTop = 0;
                    }}
                    className={
                      "h-9 rounded-xl border px-4 text-sm font-semibold transition " +
                      (active
                        ? "border-evegah-primary bg-evegah-primary text-white"
                        : "border-evegah-border bg-white text-gray-700 hover:bg-gray-50")
                    }
                    aria-current={active ? "page" : undefined}
                  >
                    {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-5 space-y-8">
            {receiptError ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {receiptError}
              </div>
            ) : null}

            {error ? (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                {error}
              </div>
            ) : null}

            {activeTab === "details" ? (
              <>
                {/* Rider Details */}
                <section>
                  <h3 className="text-base font-semibold text-evegah-text">Rider Details</h3>
                  <div className="mt-4 rounded-2xl border border-evegah-border bg-gray-50 p-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-5">
                      <Field label="Full Name" value={safeText(rider?.full_name)} />
                      <Field label="Rider Unique ID" value={safeText(riderCode)} />
                      <Field label="Mobile Number" value={safeText(rider?.mobile)} />
                      <Field label="Date of Birth" value={fmtDate(rider?.dob)} />

                      <Field label="Gender" value={safeText(rider?.gender)} />
                      <Field label="Zone" value={<Badge tone="primary">{zoneLabel}</Badge>} />
                      <Field label="Rider Status" value={<Badge>{riderType}</Badge>} />

                      <Field label="Aadhaar" value={maskAadhaar(rider?.aadhaar)} />
                      <Field
                        label="Aadhaar Verified"
                        value={
                          riderMeta?.aadhaar_verified ? (
                            <Badge tone="success">Yes (OTP)</Badge>
                          ) : (
                            <Badge>Not Verified</Badge>
                          )
                        }
                      />
                      <Field label="Reference" value={safeText(rider?.reference)} />

                      <Field
                        label="Permanent Address"
                        value={safeText(rider?.permanent_address)}
                        className="lg:col-span-3"
                      />
                      <Field
                        label="Temporary Address"
                        value={safeText(rider?.temporary_address)}
                        className="lg:col-span-3"
                      />
                    </div>
                  </div>
                </section>

                {/* Rental & Payment */}
                <section>
                  <h3 className="text-base font-semibold text-evegah-text">Rental &amp; Payment</h3>
                  <div className="mt-4 rounded-2xl border border-evegah-border bg-gray-50 p-4">
                    {Array.isArray(rides) && rides.length > 0 ? (
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
                        <div className="text-sm font-semibold text-evegah-text">Ride Details</div>
                        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row sm:items-center sm:gap-2">
                          <label className="text-xs font-semibold text-gray-500 sm:whitespace-nowrap">
                            Select Ride
                          </label>
                          <select
                            className="input h-9 py-0 w-full sm:w-64"
                            value={selectedRentalId}
                            onChange={(e) => setSelectedRentalId(e.target.value)}
                          >
                            {rides.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.start_time ? formatDateTimeDDMMYYYY(r.start_time, "-") : r.id}
                              </option>
                            ))}
                          </select>

                          <button
                            type="button"
                            onClick={handleDownloadReceipt}
                            disabled={downloadingReceipt}
                            className="shrink-0 p-2 bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-60"
                            title="Download receipt for selected ride"
                          >
                            <Download size={16} />
                          </button>
                        </div>
                      </div>
                    ) : null}

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <Field label="Rental Start" value={fmtDateTime(currentRide?.start_time)} />
                      <Field
                        label="Expected Return"
                        value={fmtDateTime(rideMeta?.expected_end_time || currentRide?.end_time)}
                      />
                      <Field label="Package" value={safeText(currentRide?.rental_package)} right />

                      <Field label="Package Amount" value={`₹${Number(currentRide?.rental_amount || 0)}`} />
                      <Field label="Security Deposit" value={`₹${Number(currentRide?.deposit_amount || 0)}`} />
                      <Field label="Total Amount" value={`₹${Number(currentRide?.total_amount || 0)}`} right />

                      <Field label="Payment Mode" value={safeText(currentRide?.payment_mode)} />
                      <Field label="E-Bike Model" value={safeText(currentRide?.bike_model)} />
                      <Field label="E-Bike ID" value={safeText(currentRide?.bike_id)} right />

                      <Field label="Battery ID" value={safeText(currentRide?.battery_id)} />
                      <Field label="Accessories Issued" value={safeText(currentRide?.other_accessories)} />
                    </div>
                  </div>
                </section>

                {/* Acknowledgment */}
                <section>
                  <h3 className="text-base font-semibold text-evegah-text">Acknowledgment</h3>
                  <div className="mt-4 rounded-2xl border border-evegah-border bg-gray-50 p-4">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <Field
                        label="Information Confirmed"
                        value={
                          rideMeta?.agreement_confirm_info ? (
                            <Badge tone="success">Yes</Badge>
                          ) : (
                            <Badge>No</Badge>
                          )
                        }
                      />
                      <Field
                        label="Terms Agreed"
                        value={
                          rideMeta?.agreement_accept_terms ? (
                            <Badge tone="success">Yes</Badge>
                          ) : (
                            <Badge>No</Badge>
                          )
                        }
                      />
                      <Field label="Issued By" value={safeText(rideMeta?.issued_by_name, "N/A")} right />
                    </div>
                  </div>
                </section>
              </>
            ) : null}

            {activeTab === "photos" ? (
              <>
                {/* Photos & Signature */}
                <section>
                  <h3 className="text-base font-semibold text-evegah-text">Photos &amp; Signature</h3>
                  <div className="mt-4 grid grid-cols-1 md:grid-cols-3 gap-4">
                    <ImageCard title="Rider Photo" doc={riderPhoto} />
                    <ImageCard title="ID Card Photo" doc={govId} emptyText="Not Provided" />
                    <ImageCard title="Signature" doc={signature} emptyText="Not Provided" />
                  </div>
                </section>

                {/* Pre-Ride Photos */}
                <section>
                  <h3 className="text-base font-semibold text-evegah-text">Pre-Ride Photos</h3>
                  <div className="mt-4 rounded-2xl border border-evegah-border bg-white p-4">
                    {rentalDocsLoading ? (
                      <div className="text-sm text-gray-500">Loading ride photos…</div>
                    ) : null}
                    {preRidePhotos.length === 0 ? (
                      <div className="text-sm text-gray-500">No pre-ride photos uploaded.</div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {preRidePhotos.map((p) => {
                          const href = p?.url ? apiUrl(p.url) : "";
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => setImagePreview({ src: href, title: "Pre-ride photo" })}
                              className="block overflow-hidden rounded-xl border border-evegah-border bg-gray-50"
                            >
                              <img
                                src={href}
                                alt="Pre-ride"
                                className="h-40 w-full object-cover transition-transform hover:scale-[1.02]"
                                loading="lazy"
                              />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>

                {/* Return Photos */}
                <section>
                  <h3 className="text-base font-semibold text-evegah-text">Return Photos</h3>
                  <div className="mt-4 rounded-2xl border border-evegah-border bg-white p-4">
                    {rentalDocsLoading ? (
                      <div className="text-sm text-gray-500">Loading return photos…</div>
                    ) : null}
                    {returnPhotos.length === 0 ? (
                      <div className="text-sm text-gray-500">No return photos uploaded.</div>
                    ) : (
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {returnPhotos.map((p) => {
                          const href = p?.url ? apiUrl(p.url) : "";
                          return (
                            <button
                              key={p.id}
                              type="button"
                              onClick={() => setImagePreview({ src: href, title: "Return photo" })}
                              className="block overflow-hidden rounded-xl border border-evegah-border bg-gray-50"
                            >
                              <img
                                src={href}
                                alt="Return"
                                className="h-40 w-full object-cover transition-transform hover:scale-[1.02]"
                                loading="lazy"
                              />
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                </section>
              </>
            ) : null}

            {activeTab === "history" ? (
              <>
                {/* Ride History (compact) */}
                <section>
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="text-base font-semibold text-evegah-text">Ride History</h3>
                    {loading ? <div className="text-xs text-gray-500">Loading…</div> : null}
                  </div>
                  <div className="mt-4 rounded-2xl border border-evegah-border bg-white">
                    {rides.length === 0 ? (
                      <div className="p-4 text-sm text-gray-500">No ride history found.</div>
                    ) : (
                      <div className="divide-y divide-evegah-border">
                        {rides.map((ride) => (
                          <div
                            key={ride.id}
                            className="p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
                          >
                            <div>
                              <div className="text-sm font-semibold text-evegah-text">
                                {fmtDateTime(ride.start_time)}
                                <span className="text-gray-400"> → </span>
                                {ride.end_time ? fmtDateTime(ride.end_time) : "Ongoing"}
                              </div>
                              <div className="text-xs text-gray-500 mt-1">
                                Battery: {safeText(ride.battery_id)} · Bike: {safeText(ride.bike_id)}
                              </div>
                            </div>
                            <div className="text-sm font-semibold text-evegah-text">₹{Number(ride.total_amount || 0)}</div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </section>

                {/* Battery Swaps (per rider) */}
                <section>
                  <div className="flex items-center justify-between gap-4">
                    <h3 className="text-base font-semibold text-evegah-text">Battery Swaps</h3>
                    {loading ? <div className="text-xs text-gray-500">Loading…</div> : null}
                  </div>
                  <div className="mt-4 rounded-2xl border border-evegah-border bg-white overflow-x-auto">
                    {filteredSwapRows.length === 0 ? (
                      <div className="p-4 text-sm text-gray-500">No battery swaps found for this rider.</div>
                    ) : (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-left text-gray-500 border-b border-evegah-border">
                            <th className="py-2 px-4 font-medium whitespace-nowrap">Swapped At</th>
                            <th className="py-2 px-4 font-medium">Vehicle</th>
                            <th className="py-2 px-4 font-medium">Battery OUT</th>
                            <th className="py-2 px-4 font-medium">Battery IN</th>
                            <th className="py-2 px-4 font-medium">Notes</th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredSwapRows.map((s) => (
                            <tr key={s.id} className="border-b last:border-b-0">
                              <td className="py-3 px-4 whitespace-nowrap text-gray-600">
                                {s.swapped_at ? formatDateTimeDDMMYYYY(s.swapped_at, "-") : "-"}
                              </td>
                              <td className="py-3 px-4">{safeText(s.vehicle_number)}</td>
                              <td className="py-3 px-4">{safeText(s.battery_out)}</td>
                              <td className="py-3 px-4">{safeText(s.battery_in)}</td>
                              <td className="py-3 px-4 max-w-[360px]">
                                <span className="line-clamp-2">{safeText(s.notes, "-")}</span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                  <p className="mt-2 text-xs text-gray-500">
                    Swaps are linked to this rider by matching vehicle number and swap time within the rental window.
                  </p>
                </section>
              </>
            ) : null}
          </div>
        </div>
      </div>

      {imagePreview?.src ? (
        <div
          className="fixed inset-0 z-[60] bg-black/60 flex items-center justify-center p-4"
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
